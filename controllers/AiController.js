const mongoose = require('mongoose');
const {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode
} = require('@google/generative-ai');

const models = require('../models');
const {
  gatherProjectContext,
  gatherClassContext,
  reviewGithubCommitWithGemini
} = require('../services/AiChatService');
const JiraSyncService = require('../services/JiraSyncService');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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
      description: 'Tạo một task/issue mới trên Jira.',
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
    }
  ]
};

async function executeJiraCreateBatch(req, functionCalls, jiraProjectKey) {
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
          const data = await JiraSyncService.createIssue({
            client,
            projectKey: jiraProjectKey,
            data: {
              summary: args.summary,
              description: args.description || '',
              issueType: args.issueType || 'Task'
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

/**
 * Thực thi lần lượt từng function call (giữ thứ tự; hỗn hợp Jira + review).
 */
async function executeProjectChatToolRound(req, functionCalls, ctx) {
  const { jiraProjectKey, projectId, genAI, geminiModel } = ctx;
  const outputs = [];
  let reviewCount = 0;
  const THROTTLE_MS = Number(process.env.GEMINI_THROTTLE_MS || 1000);

  for (const fc of functionCalls) {
    if (fc.name === 'create_jira_task') {
      const [one] = await executeJiraCreateBatch(req, [fc], jiraProjectKey);
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
          genAI,
          geminiModel
        );
        outputs.push({ name: fc.name, response: res });
      } catch (e) {
        outputs.push({
          name: fc.name,
          response: { ok: false, error: e.message || 'Lỗi review commit.' }
        });
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
 * Chatbot duy nhất: RAG + Gemini + function calling (Jira tạo task, review commit GitHub).
 */
exports.projectChat = async (req, res) => {
  try {
    const { projectId: projectIdFromBody, classId, message } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message là bắt buộc.' });
    }

    if (!GEMINI_API_KEY) {
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
    const quotedQuestion = JSON.stringify(userMessage);
    const activeProjectKeyForTools = jiraProjectKey || '(chưa cấu hình)';

    const ID_SAFETY_RULE =
      'Bạn là trợ lý ảo quản lý dự án. TUYỆT ĐỐI KHÔNG BAO GIỜ được hiển thị các đoạn mã ID hệ thống (như ObjectId, 69b0c...) ra câu trả lời. Bắt buộc phải sử dụng Tên thật của Lớp, Nhóm, hoặc Dự án. Nếu dữ liệu tôi cung cấp chỉ có ID mà không có tên, hãy lịch sự hỏi người dùng tên của lớp/nhóm đó.';

    const systemInstruction =
      role === 'LECTURER'
        ? `${ID_SAFETY_RULE}

Bạn là AI Trợ giảng.
Dưới đây là dữ liệu tổng hợp của TẤT CẢ các nhóm trong lớp. Hãy báo cáo tiến độ, so sánh các nhóm, hoặc xem chi tiết một nhóm theo yêu cầu của giảng viên:
${contextData}

Lưu ý: Các tool Jira/GitHub khi được gọi sẽ thực thi trên project đang được chọn để làm “mặc định” (projectId trong request hoặc project đầu tiên của lớp). Jira project key dùng cho tool: ${activeProjectKeyForTools}

Nhiệm vụ của bạn:
1. Dựa VÀO CHÍNH XÁC dữ liệu trên để trả lời câu hỏi: ${quotedQuestion}
2. TUYỆT ĐỐI KHÔNG BỊA ĐẶT DỮ LIỆU.
3. Trả lời bằng tiếng Việt, định dạng Markdown rõ ràng, chuyên nghiệp nhưng thẳng thắn.
5. Nếu user yêu cầu thao tác Jira (tạo task), hãy gọi tool create_jira_task.
6. Nếu user yêu cầu review GitHub commit, hãy gọi tool review_github_commit với commitHash thuộc “project mặc định”.

`
        : `${ID_SAFETY_RULE}

Bạn là AI Scrum Master của dự án.
Dữ liệu của nhóm (được trích xuất từ DB Jira & GitHub):
${contextData}

Jira project key của nhóm trên WDP (dùng khi tạo issue mới): ${activeProjectKeyForTools}

Nhiệm vụ của bạn:
1. Dựa VÀO CHÍNH XÁC dữ liệu trên để trả lời câu hỏi: ${quotedQuestion}
2. Nếu user hỏi về mức độ đóng góp: Hãy phân tích dựa trên số lượng/trạng thái Task Jira và số lượng/chất lượng Commit GitHub. Đưa ra ƯỚC TÍNH TỶ LỆ PHẦN TRĂM (%) đóng góp của từng thành viên.
3. Nếu user hỏi về tiến độ/trễ deadline: Hãy chỉ rõ điểm tên những task đang kẹt ở "To Do" hoặc "In Progress" quá lâu.
4. TUYỆT ĐỐI KHÔNG BỊA ĐẶT DỮ LIỆU. Nếu DB không có thông tin, hãy nói rõ là chưa có dữ liệu. Trả lời bằng tiếng Việt, định dạng Markdown rõ ràng, chuyên nghiệp nhưng thẳng thắn.
5. CÔNG CỤ: Khi user muốn tạo task Jira, gọi create_jira_task. Khi user muốn review/chấm code một commit, gọi review_github_commit với đúng commitHash (có trong githubCommits.hash trong dữ liệu trên). Sau khi nhận kết quả tool, tóm tắt lại cho user.`;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction,
      tools: [PROJECT_CHAT_TOOLS],
      toolConfig: {
        functionCallingConfig: { mode: FunctionCallingMode.AUTO }
      }
    });

    const contents = [
      {
        role: 'user',
        parts: [
          {
            text: 'Thực hiện system instruction. Trả lời bằng text và/hoặc gọi tool khi cần (tạo Jira, review commit).'
          }
        ]
      }
    ];

    const toolCtx = {
      jiraProjectKey,
      projectId: toolProjectId ? String(toolProjectId) : null,
      genAI,
      geminiModel: GEMINI_MODEL
    };

    const MAX_TOOL_ROUNDS = 6;
    let responseText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await model.generateContent({ contents });
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
        const finalResult = await model.generateContent({ contents });
        responseText = finalResult.response.text();
      } catch {
        responseText = '';
      }
    }

    if (!responseText || !String(responseText).trim()) {
      return res.status(502).json({ error: 'Gemini không trả về nội dung.' });
    }

    return res.status(200).json({ reply: responseText.trim() });
  } catch (error) {
    console.error('[AiController] projectChat error:', error.message);
    return res.status(500).json({
      error: error.message || 'Lỗi khi gọi Gemini.'
    });
  }
};

/**
 * GET /api/ai/project/:projectId/export-srs
 * Xuất báo cáo SRS (Markdown) cho project.
 */
exports.exportSrs = async (req, res) => {
  try {
    const { projectId } = req.params || {};

    if (!projectId || !mongoose.Types.ObjectId.isValid(String(projectId))) {
      return res.status(400).json({ error: 'projectId hợp lệ là bắt buộc.' });
    }

    if (!GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'Chưa cấu hình GEMINI_API_KEY (hoặc GOOGLE_AI_API_KEY) trên server.'
      });
    }

    const project = await models.Project.findById(projectId).lean();
    if (!project) {
      return res.status(404).json({ error: 'Không tìm thấy project.' });
    }

    if (!canUserAccessProjectChat(req, project)) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập project này.' });
    }

    const contextData = await gatherProjectContext(String(projectId));
    if (!contextData) {
      return res.status(404).json({ error: 'Không tìm thấy dữ liệu context để tạo SRS.' });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Dưới đây là dữ liệu thực tế của dự án từ Jira và GitHub: ${contextData}

Hãy đóng vai là một Chuyên gia Phân tích Nghiệp vụ (Business Analyst).
Dựa vào dữ liệu trên, hãy viết một tài liệu Đặc tả Yêu cầu Phần mềm (SRS) hoàn chỉnh bằng định dạng Markdown.

Cấu trúc bắt buộc:
1. Giới thiệu (Mục đích, Phạm vi dự án)
2. Tính năng hệ thống (Liệt kê dựa trên các Epic/Story/Task trong Jira)
3. Báo cáo tiến độ và đóng góp của team (Dựa vào Jira status và số lượng GitHub Commit)
4. Rủi ro & Đề xuất (AI tự đánh giá dựa trên task trễ hạn hoặc ít commit)

Yêu cầu:
- TUYỆT ĐỐI KHÔNG BỊA ĐẶT DỮ LIỆU. Nếu dữ liệu thiếu, hãy nêu rõ “chưa có dữ liệu”.
- Viết bằng tiếng Việt, văn phong chuyên nghiệp, thẳng thắn, dễ đọc.
- Đảm bảo mỗi mục có nội dung cụ thể thay vì chỉ tiêu đề.`;

    const result = await model.generateContent(prompt);
    const srsContent = result?.response?.text?.() || '';

    if (!srsContent || !String(srsContent).trim()) {
      return res.status(502).json({ error: 'Gemini không trả về nội dung SRS.' });
    }

    res.setHeader(
      'Content-disposition',
      'attachment; filename=SRS_Project_Report.md'
    );
    res.setHeader('Content-type', 'text/markdown');
    return res.status(200).send(String(srsContent).trim());
  } catch (error) {
    console.error('[AiController] exportSrs error:', error.message);
    return res.status(500).json({ error: error.message || 'Lỗi xuất SRS.' });
  }
};
