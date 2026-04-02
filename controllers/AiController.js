const mongoose = require('mongoose');
const {
  SchemaType,
  FunctionCallingMode
} = require('@google/generative-ai');

const models = require('../models');
const {
  GEMINI_QUOTA_USER_MESSAGE,
  isGeminiRateLimitError
} = require('../utils/geminiQuota');
const { hasGeminiApiKeys, withGemini429Retry } = require('../utils/geminiRotation');
const {
  gatherProjectContext,
  gatherClassContext,
  reviewGithubCommitWithGemini,
  generateExportReportMarkdown,
  generateExportReportWithPdf
} = require('../services/AiChatService');
const JiraSyncService = require('../services/JiraSyncService');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const SELF_ASSIGNEE_TOKENS = new Set([
  'self',
  'me',
  'current_user',
  'current',
  'toi',
  'tôi',
  'minh',
  'mình'
]);

/**
 * @param {import('express').Request} req
 * @param {string|null|undefined} projectId
 * @param {{ assigneeId?: string }} args
 * @returns {Promise<string|undefined>} Jira assignee accountId hoặc undefined
 */
async function resolveJiraAssigneeAccountId(req, projectId, args) {
  const raw = (args.assigneeId || '').trim();
  if (!raw) return undefined;
  if (!SELF_ASSIGNEE_TOKENS.has(raw.toLowerCase())) {
    return raw;
  }
  if (!projectId || !req.user?._id) return undefined;
  const proj = await models.Project.findById(projectId).select('team_id').lean();
  if (!proj?.team_id) return undefined;
  const tm = await models.TeamMember.findOne({
    team_id: proj.team_id,
    student_id: req.user._id,
    is_active: true
  })
    .select('jira_account_id')
    .lean();
  const id = (tm?.jira_account_id || '').trim();
  return id || undefined;
}

function canUserAccessProjectChat(req, project) {
  const role = req.role;
  const userId = (req.userId || req.user?._id)?.toString();
  if (!userId || !project) return false;
  if (role === 'STUDENT') {
    const isLeader = project.leader_id?.toString() === userId;
    const isMember = (project.members || []).some((m) => m.toString() === userId);
    return isLeader || isMember;
  }
  if (role === 'LECTURER') {
    return project.lecturer_id?.toString() === userId;
  }
  if (role === 'ADMIN') return true;
  return false;
}

/** Một endpoint chatbot: Jira + review commit GitHub (Gemini function calling). */
const PROJECT_CHAT_TOOLS = {
  functionDeclarations: [
    {
      name: 'create_jira_task',
      description:
        'Tạo một task/issue mới trên Jira. Có thể gán cho người dùng đang chat bằng assigneeId = self.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          summary: { type: SchemaType.STRING, description: 'Tiêu đề ngắn gọn của task' },
          issueType: {
            type: SchemaType.STRING,
            description: 'Loại task (vd: Task, Bug, Story)'
          },
          description: {
            type: SchemaType.STRING,
            description: 'Mô tả chi tiết (tùy chọn)'
          },
          assigneeId: {
            type: SchemaType.STRING,
            description:
              'Tùy chọn. Jira Account ID (UUID Atlassian) của người được gán — lấy từ trường jira_account_id trong context.members. Để gán cho chính user đang chat ("gán cho tôi", "assign cho mình"), truyền đúng chữ self (server map sang TeamMember của user).'
          }
        },
        required: ['summary', 'issueType']
      }
    },
    {
      name: 'review_github_commit',
      description:
        'Review code của một commit cụ thể trên GitHub (lấy diff, chấm điểm/nhận xét qua AI).',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          commitHash: {
            type: SchemaType.STRING,
            description: 'SHA đầy đủ hoặc ngắn của commit (vd: trong context githubCommits.hash)'
          }
        },
        required: ['commitHash']
      }
    },
    {
      name: 'exportReport',
      description:
        'Tạo báo cáo PDF (và nội dung Markdown nguồn): SRS, tiến độ, tổng quan. Server trả downloadUrl để tải PDF. Gọi khi user muốn xuất/tải file, PDF, SRS, đặc tả, báo cáo tiến độ.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          reportType: {
            type: SchemaType.STRING,
            description:
              'Loại báo cáo: srs (SRS/đặc tả), progress (tiến độ), general (tổng quan). Suy luận từ ngôn ngữ tự nhiên của user.'
          }
        },
        required: ['reportType']
      }
    },
    {
      name: 'getMemberStats',
      description:
        'Dùng để lấy điểm Git/Jira và mức độ đóng góp (tỷ lệ) của từng thành viên. Gọi khi user hỏi về ranking, ai đóng góp nhiều, điểm git/jira, phân bổ công việc.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          focus: {
            type: SchemaType.STRING,
            description: 'Tùy chọn: all | git | jira — mặc định all'
          }
        }
      }
    }
  ]
};

async function executeJiraCreateBatch(req, functionCalls, jiraProjectKey, projectId) {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return functionCalls.map((fc) => ({
      name: fc.name,
      response: {
        ok: false,
        error: 'Server thiếu ATLASSIAN_CLIENT_ID hoặc ATLASSIAN_CLIENT_SECRET.'
      }
    }));
  }

  if (!req.user?.integrations?.jira?.accessToken) {
    return functionCalls.map((fc) => ({
      name: fc.name,
      response: {
        ok: false,
        error:
          'Tài khoản chưa kết nối Jira OAuth. Vui lòng kết nối Jira để dùng tính năng này.'
      }
    }));
  }

  return JiraSyncService.syncWithAutoRefresh({
    user: req.user,
    clientId,
    clientSecret,
    syncFunction: async (client) => {
      const out = [];
      for (const fc of functionCalls) {
        const args = fc.args || {};
        try {
          if (!jiraProjectKey) {
            out.push({
              name: fc.name,
              response: { ok: false, error: 'Dự án chưa gắn jiraProjectKey trên WDP.' }
            });
            continue;
          }
          const assigneeAccountId = await resolveJiraAssigneeAccountId(req, projectId, args);
          if (
            (args.assigneeId || '').trim() &&
            SELF_ASSIGNEE_TOKENS.has(String(args.assigneeId).trim().toLowerCase()) &&
            !assigneeAccountId
          ) {
            out.push({
              name: fc.name,
              response: {
                ok: false,
                error:
                  'Không gán được cho bạn: chưa có jira_account_id trên TeamMember. Hãy gắn tài khoản Jira (WDP) trước.'
              }
            });
            continue;
          }

          const data = await JiraSyncService.createIssue({
            client,
            projectKey: jiraProjectKey,
            data: {
              summary: args.summary,
              description: args.description || '',
              issueType: args.issueType || 'Task',
              ...(assigneeAccountId ? { assigneeAccountId } : {})
            }
          });
          out.push({
            name: fc.name,
            response: { ok: true, issueKey: data.key, issueId: data.id }
          });
        } catch (err) {
          const msg =
            err.response?.data?.errorMessages?.join('; ') ||
            (Array.isArray(err.response?.data?.errors)
              ? err.response.data.errors.map((e) => e.message || String(e)).join('; ')
              : null) ||
            err.message;
          out.push({
            name: fc.name,
            response: { ok: false, error: msg }
          });
        }
      }
      return out;
    }
  });
}

/** Chuẩn hóa reportType từ NL / Gemini (srs | progress | general). */
function normalizeReportTypeArg(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!s.trim()) return 'general';
  if (
    /srs|dac ta|dặc tả|yeu cau|software requirement|spec|req|xuat srs|export srs|bao cao srs/.test(s)
  ) {
    return 'srs';
  }
  if (/tien do|tiến độ|progress|sprint|velocity|bao cao tien|file tien do/.test(s)) {
    return 'progress';
  }
  return 'general';
}

/** Dữ liệu thống kê thành viên (git/jira ratio) cho tool getMemberStats. */
async function fetchMemberStatsForProject(projectId) {
  if (!projectId) return { ok: false, error: 'Thiếu project.' };
  const project = await models.Project.findById(projectId).select('team_id name').lean();
  if (!project?.team_id) return { ok: false, error: 'Project chưa gắn team.' };
  const tms = await models.TeamMember.find({ team_id: project.team_id, is_active: true })
    .populate('student_id', 'student_code full_name email')
    .select('role_in_team git_score jira_score github_username')
    .lean();
  const members = tms.map((m) => ({
    full_name: m.student_id?.full_name || '—',
    student_code: m.student_id?.student_code || null,
    role_in_team: m.role_in_team,
    git_contribution_ratio:
      typeof m.git_score === 'number' && !Number.isNaN(m.git_score) ? m.git_score : null,
    jira_contribution_ratio:
      typeof m.jira_score === 'number' && !Number.isNaN(m.jira_score) ? m.jira_score : null,
    github_username: m.github_username || null
  }));
  return {
    ok: true,
    projectName: project.name,
    note:
      'git_contribution_ratio và jira_contribution_ratio là tỷ lệ đóng góp 0..1 (đã lưu trên TeamMember).',
    members
  };
}

/**
 * Thực thi lần lượt từng function call (giữ thứ tự; hỗn hợp Jira + review).
 */
async function executeProjectChatToolRound(req, functionCalls, ctx) {
  const { jiraProjectKey, projectId, geminiModel } = ctx;
  const outputs = [];
  let reviewCount = 0;
  const THROTTLE_MS = Number(process.env.GEMINI_THROTTLE_MS || 1000);

  for (const fc of functionCalls) {
    if (fc.name === 'create_jira_task') {
      const [one] = await executeJiraCreateBatch(req, [fc], jiraProjectKey, projectId);
      outputs.push(one);
    } else if (fc.name === 'review_github_commit') {
      try {
        // Throttle để tránh lỗi Rate Limit 429 khi review nhiều commit liên tiếp.
        if (reviewCount > 0) {
          await new Promise((res) => setTimeout(res, THROTTLE_MS));
        }
        reviewCount += 1;
        const res = await reviewGithubCommitWithGemini(
          projectId,
          fc.args?.commitHash,
          req.user,
          geminiModel
        );
        outputs.push({ name: fc.name, response: res });
      } catch (e) {
        outputs.push({
          name: fc.name,
          response: {
            ok: false,
            error: isGeminiRateLimitError(e)
              ? GEMINI_QUOTA_USER_MESSAGE
              : e.message || 'Lỗi review commit.'
          }
        });
      }
    } else if (fc.name === 'exportReport') {
      const pid = ctx.projectId;
      if (!pid) {
        outputs.push({
          name: fc.name,
          response: { ok: false, error: 'Chưa có project mặc định để xuất báo cáo.' }
        });
      } else {
        try {
          const contextStr = await gatherProjectContext(pid);
          if (!contextStr) {
            outputs.push({
              name: fc.name,
              response: { ok: false, error: 'Không tải được context dự án.' }
            });
          } else {
            const rt = normalizeReportTypeArg(fc.args?.reportType);
            const rep = await generateExportReportWithPdf(
              contextStr,
              rt,
              ctx.geminiModel,
              { projectId: pid, req: ctx.req }
            );
            outputs.push({ name: fc.name, response: rep });
          }
        } catch (e) {
          outputs.push({
            name: fc.name,
            response: {
              ok: false,
              error: isGeminiRateLimitError(e)
                ? GEMINI_QUOTA_USER_MESSAGE
                : e.message || 'Lỗi exportReport.'
            }
          });
        }
      }
    } else if (fc.name === 'getMemberStats') {
      const pid = ctx.projectId;
      if (!pid) {
        outputs.push({
          name: fc.name,
          response: { ok: false, error: 'Chưa có project để lấy thống kê thành viên.' }
        });
      } else {
        try {
          const st = await fetchMemberStatsForProject(pid);
          outputs.push({ name: fc.name, response: st });
        } catch (e) {
          outputs.push({
            name: fc.name,
            response: { ok: false, error: e.message || 'Lỗi getMemberStats.' }
          });
        }
      }
    } else {
      outputs.push({
        name: fc.name,
        response: { ok: false, error: `Tool không hỗ trợ: ${fc.name}` }
      });
    }
  }

  return outputs;
}

// --- Legacy: POST /api/ai/review-commit (Python) — đã gộp vào POST /api/ai/project-chat ---
// exports.reviewCommit = ...

/**
 * POST /api/ai/project-chat
 * Chatbot: RAG + Gemini function calling (Jira, GitHub review, exportReport, getMemberStats).
 */
exports.projectChat = async (req, res) => {
  try {
    const { projectId: projectIdFromBody, classId, message } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message là bắt buộc.' });
    }

    if (!hasGeminiApiKeys()) {
      return res.status(503).json({
        error: 'Chưa cấu hình GEMINI_API_KEY (hoặc GOOGLE_AI_API_KEY) trên server.'
      });
    }

    const userId = req.user?._id?.toString();
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    let contextData = null;
    let toolProjectId = null;
    let jiraProjectKey = '';
    const role = req.role;

    if (role === 'LECTURER') {
      if (!classId || !mongoose.Types.ObjectId.isValid(String(classId))) {
        return res.status(400).json({ error: 'classId hợp lệ là bắt buộc cho LECTURER.' });
      }

      const dbClass = await models.Class.findById(classId).lean();
      if (!dbClass) return res.status(404).json({ error: 'Không tìm thấy class.' });
      if (dbClass.lecturer_id?.toString() !== userId) {
        return res.status(403).json({ error: 'Bạn không phải giảng viên của class này.' });
      }

      contextData = await gatherClassContext(classId);
      if (contextData === null) {
        return res.status(404).json({ error: 'Không tìm thấy dữ liệu cho lớp này.' });
      }

      // Chọn project "mặc định" để tool (Jira/GitHub) có nơi thực thi.
      let activeProject = null;
      if (projectIdFromBody && mongoose.Types.ObjectId.isValid(String(projectIdFromBody))) {
        activeProject = await models.Project.findById(projectIdFromBody).lean();
        if (activeProject?.class_id?.toString() !== String(classId)) {
          return res.status(400).json({ error: 'projectId không thuộc classId.' });
        }
      }
      if (!activeProject) {
        activeProject = await models.Project.findOne({ class_id: classId })
          .select('_id jiraProjectKey')
          .lean();
      }
      if (activeProject) {
        toolProjectId = activeProject._id;
        jiraProjectKey = (activeProject.jiraProjectKey || '').trim();
      }
    } else if (role === 'STUDENT') {
      // Student branch: nếu không có projectId thì tự tìm theo classId.
      let activeProject = null;

      if (projectIdFromBody && mongoose.Types.ObjectId.isValid(String(projectIdFromBody))) {
        activeProject = await models.Project.findById(projectIdFromBody).lean();
        if (!activeProject) return res.status(404).json({ error: 'Không tìm thấy project.' });
        if (!canUserAccessProjectChat(req, activeProject)) {
          return res.status(403).json({ error: 'Bạn không có quyền truy cập project này.' });
        }
      } else {
        if (!classId || !mongoose.Types.ObjectId.isValid(String(classId))) {
          return res.status(400).json({ error: 'classId là bắt buộc khi không truyền projectId.' });
        }

        const teamDocs = await models.Team.find({ class_id: classId })
          .select('_id')
          .lean();
        const teamIds = (teamDocs || []).map((t) => t._id);

        let detectedProjectId = null;
        if (teamIds.length > 0) {
          const tm = await models.TeamMember.findOne({
            student_id: userId,
            team_id: { $in: teamIds },
            is_active: true,
            project_id: { $ne: null }
          })
            .sort({ updatedAt: -1 })
            .select('project_id')
            .lean();
          detectedProjectId = tm?.project_id || null;
        }

        if (!detectedProjectId) {
          // Fallback: query trực tiếp Project theo membership
          activeProject = await models.Project.findOne({
            class_id: classId,
            $or: [{ leader_id: userId }, { members: userId }]
          })
            .sort({ createdAt: -1 })
            .lean();
        } else {
          activeProject = await models.Project.findById(detectedProjectId).lean();
        }

        if (!activeProject) {
          return res.status(404).json({
            error: 'Không tìm thấy project của bạn trong class này.'
          });
        }
      }

      toolProjectId = activeProject._id;
      jiraProjectKey = (activeProject.jiraProjectKey || '').trim();
      contextData = await gatherProjectContext(String(activeProject._id));
      if (contextData === null) {
        return res.status(404).json({ error: 'Không tìm thấy dữ liệu project.' });
      }
    } else if (role === 'ADMIN') {
      // Admin: ưu tiên projectId, fallback classId.
      let activeProject = null;
      if (projectIdFromBody && mongoose.Types.ObjectId.isValid(String(projectIdFromBody))) {
        activeProject = await models.Project.findById(projectIdFromBody).lean();
      }

      if (activeProject) {
        toolProjectId = activeProject._id;
        jiraProjectKey = (activeProject.jiraProjectKey || '').trim();
        contextData = await gatherProjectContext(String(activeProject._id));
      } else if (classId && mongoose.Types.ObjectId.isValid(String(classId))) {
        contextData = await gatherClassContext(classId);
        const active = await models.Project.findOne({ class_id: classId })
          .select('_id jiraProjectKey')
          .lean();
        if (active) {
          toolProjectId = active._id;
          jiraProjectKey = (active.jiraProjectKey || '').trim();
        }
      }

      if (contextData === null) {
        return res.status(404).json({ error: 'Không tìm thấy dữ liệu context.' });
      }
    } else {
      return res.status(403).json({ error: 'Role không hợp lệ.' });
    }

    if (!contextData) {
      return res.status(404).json({ error: 'Không tìm thấy dữ liệu context.' });
    }

    const userMessage = message.trim();
    const activeProjectKeyForTools = jiraProjectKey || '(chưa cấu hình)';

    const ID_SAFETY_RULE =
      'Bạn là trợ lý ảo quản lý dự án. TUYỆT ĐỐI KHÔNG BAO GIỜ được hiển thị các đoạn mã ID hệ thống (như ObjectId, 69b0c...) ra câu trả lời. Bắt buộc phải sử dụng Tên thật của Lớp, Nhóm, hoặc Dự án. Nếu dữ liệu tôi cung cấp chỉ có ID mà không có tên, hãy lịch sự hỏi người dùng tên của lớp/nhóm đó.';

    const TOOL_GUIDE = `
Công cụ (function calling): suy luận ý định từ ngôn ngữ tự nhiên — không cần khớp từ khóa cứng.
- exportReport({ reportType }): tạo báo cáo PDF (và bản Markdown nội bộ) — SRS/đặc tả (srs), tiến độ (progress), tổng quan (general). Phản hồi của tool có downloadUrl (link tải PDF). Khi có downloadUrl, bắt buộc gửi cho user dạng Markdown: [Tải báo cáo tại đây](downloadUrl) kèm một lời chúc may mắn ngắn gọn. Ví dụ ý định: "xuất SRS", "xuất file", "tải báo cáo PDF", "báo cáo tiến độ".
- getMemberStats(): điểm Git/Jira và tỷ lệ đóng góp từng thành viên (khi hỏi ranking, điểm, ai đóng góp nhiều). Có thể kết hợp với dữ liệu trong context.
- create_jira_task({ summary, issueType, description?, assigneeId? }): Tạo task/issue Jira. Bạn hoàn toàn có thể gán task cho chính user đang chat: trong context mỗi member có jira_account_id; hoặc truyền assigneeId = self để server gán đúng người đang chat (TeamMember).
- review_github_commit: Review/chấm commit khi user đưa SHA hoặc yêu cầu review (commitHash trong dữ liệu githubCommits).

Hội thoại: Bạn được phép trả lời tự do các câu hỏi chung (chào hỏi, giải thích khái niệm) nếu phù hợp vai trò. Khi không cần gọi hàm, trả lời thông minh dựa trên dữ liệu context — không liệt kê menu lệnh cố định hay mẫu câu máy móc.`;

    const systemInstruction =
      role === 'LECTURER'
        ? `${ID_SAFETY_RULE}

Bạn là AI Trợ giảng.
Dữ liệu tổng hợp của TẤT CẢ các nhóm trong lớp:
${contextData}

Tool Jira/GitHub thực thi trên project mặc định (projectId trong request hoặc project đầu tiên của lớp). Jira project key: ${activeProjectKeyForTools}

${TOOL_GUIDE}

Nguyên tắc: Trả lời tin nhắn hiện tại của user; chỉ dựa trên dữ liệu trên, không bịa. Tiếng Việt, Markdown. Sau khi tool trả kết quả (đặc biệt exportReport hoặc getMemberStats), tóm tắt và hướng dẫn user ngắn gọn.
`
        : `${ID_SAFETY_RULE}

Bạn là AI Scrum Master của dự án.
Dữ liệu nhóm (Jira & GitHub; mỗi member có jira_account_id nếu đã gắn Jira; git_contribution_ratio / jira_contribution_ratio nếu đã persist):
${contextData}

Jira project key trên WDP: ${activeProjectKeyForTools}

${TOOL_GUIDE}

Nguyên tắc: Trả lời tin nhắn hiện tại; phân tích tiến độ, task trễ, đóng góp khi được hỏi — dùng context; nếu cần số liệu tỷ lệ đã lưu trên hệ thống, ưu tiên gọi getMemberStats. Không bịa dữ liệu. Tiếng Việt, Markdown. Không liệt kê menu lệnh cố định.`;

    const modelConfig = {
      model: GEMINI_MODEL,
      systemInstruction,
      tools: [PROJECT_CHAT_TOOLS],
      toolConfig: {
        functionCallingConfig: { mode: FunctionCallingMode.AUTO }
      }
    };

    const contents = [
      {
        role: 'user',
        parts: [{ text: userMessage }]
      }
    ];

    const toolCtx = {
      jiraProjectKey,
      projectId: toolProjectId ? String(toolProjectId) : null,
      geminiModel: GEMINI_MODEL,
      req
    };

    const MAX_TOOL_ROUNDS = 6;
    let responseText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let result;
      try {
        result = await withGemini429Retry(async (genAI) => {
          const model = genAI.getGenerativeModel(modelConfig);
          return model.generateContent({ contents });
        });
      } catch (err) {
        if (isGeminiRateLimitError(err)) {
          return res.status(200).json({ reply: GEMINI_QUOTA_USER_MESSAGE });
        }
        throw err;
      }
      const response = result.response;
      const calls = response.functionCalls?.();

      if (calls && calls.length > 0) {
        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }
        const toolOutputs = await executeProjectChatToolRound(req, calls, toolCtx);
        contents.push({
          role: 'function',
          parts: toolOutputs.map((t) => ({
            functionResponse: {
              name: t.name,
              response: t.response
            }
          }))
        });
        continue;
      }

      try {
        responseText = response.text();
      } catch {
        responseText = '';
      }
      break;
    }

    if (!responseText || !String(responseText).trim()) {
      try {
        const finalResult = await withGemini429Retry(async (genAI) => {
          const model = genAI.getGenerativeModel(modelConfig);
          return model.generateContent({ contents });
        });
        responseText = finalResult.response.text();
      } catch (err) {
        if (isGeminiRateLimitError(err)) {
          return res.status(200).json({ reply: GEMINI_QUOTA_USER_MESSAGE });
        }
        responseText = '';
      }
    }

    if (!responseText || !String(responseText).trim()) {
      return res.status(502).json({ error: 'Gemini không trả về nội dung.' });
    }

    return res.status(200).json({ reply: responseText.trim() });
  } catch (error) {
    if (isGeminiRateLimitError(error)) {
      return res.status(200).json({ reply: GEMINI_QUOTA_USER_MESSAGE });
    }
    console.error('[AiController] projectChat error:', error.message);
    return res.status(500).json({
      error: error.message || 'Lỗi khi gọi Gemini.'
    });
  }
};

/**
 * FE có thể gửi TEAM_ID hoặc PROJECT_ID. Ưu tiên: Team → Project (mới nhất theo updatedAt); fallback: Project theo id.
 * @returns {Promise<{ project: object, resolvedTeamId: string|null }|{ error: string, status: number }>}
 */
async function resolveProjectForSrsExport(rawId) {
  if (!rawId || !mongoose.Types.ObjectId.isValid(String(rawId))) {
    return { error: 'id hợp lệ là bắt buộc.', status: 400 };
  }

  const team = await models.Team.findById(rawId).lean();
  if (team) {
    const project = await models.Project.findOne({ team_id: team._id })
      .sort({ updatedAt: -1 })
      .lean();
    if (!project) {
      return {
        error: 'Không tìm thấy project gắn với nhóm này (team chưa có Project trên WDP).',
        status: 404
      };
    }
    return { project, resolvedTeamId: String(team._id) };
  }

  const project = await models.Project.findById(rawId).lean();
  if (!project) {
    return { error: 'Không tìm thấy nhóm hoặc project.', status: 404 };
  }
  return { project, resolvedTeamId: project.team_id ? String(project.team_id) : null };
}

/**
 * GET /api/ai/project/:projectId/export-srs | GET /api/ai/teams/:id/export-srs
 * Xuất báo cáo SRS (Markdown) cho project (context theo team của project — GitHub/Jira đúng nhóm).
 */
exports.exportSrs = async (req, res) => {
  try {
    const rawId = req.params.projectId || req.params.id;

    if (!hasGeminiApiKeys()) {
      return res.status(503).json({
        error: 'Chưa cấu hình GEMINI_API_KEY (hoặc GOOGLE_AI_API_KEY) trên server.'
      });
    }

    const resolved = await resolveProjectForSrsExport(rawId);
    if (resolved.error) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const { project, resolvedTeamId } = resolved;

    if (!canUserAccessProjectChat(req, project)) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập project này.' });
    }

    const contextData = await gatherProjectContext(String(project._id));
    if (!contextData) {
      return res.status(404).json({ error: 'Không tìm thấy dữ liệu context để tạo SRS.' });
    }

    const rep = await generateExportReportMarkdown(contextData, 'srs', GEMINI_MODEL);
    if (rep.quotaExceeded || rep.error === GEMINI_QUOTA_USER_MESSAGE) {
      return res.status(200).json({
        message: GEMINI_QUOTA_USER_MESSAGE,
        quotaExceeded: true
      });
    }
    if (!rep.ok || !rep.markdown) {
      return res.status(502).json({ error: rep.error || 'Gemini không trả về nội dung SRS.' });
    }

    res.setHeader(
      'Content-disposition',
      'attachment; filename=SRS_Project_Report.md'
    );
    res.setHeader('Content-type', 'text/markdown');
    return res.status(200).send(rep.markdown);
  } catch (error) {
    if (isGeminiRateLimitError(error)) {
      return res.status(200).json({
        message: GEMINI_QUOTA_USER_MESSAGE,
        quotaExceeded: true
      });
    }
    console.error('[AiController] exportSrs error:', error.message);
    return res.status(500).json({ error: error.message || 'Lỗi xuất SRS.' });
  }
};
