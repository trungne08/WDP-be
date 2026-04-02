const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
const MarkdownIt = require('markdown-it');
const puppeteer = require('puppeteer');
const models = require('../models');
const GithubService = require('./GithubService');
const {
  GEMINI_QUOTA_USER_MESSAGE,
  isGeminiRateLimitError
} = require('../utils/geminiQuota');
const { withGemini429Retry } = require('../utils/geminiRotation');

const PUPPETEER_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu'
];

const JUNK_PATTERNS = [
  'package-lock.json',
  'yarn.lock',
  '.lock',
  '.min.js',
  '.min.css',
  'dist/',
  'build/',
  '.svg',
  '.png'
];

function isJunkFile(filename) {
  if (!filename || typeof filename !== 'string') return true;
  const lower = filename.toLowerCase();
  return JUNK_PATTERNS.some((p) => lower.endsWith(p) || lower.includes(p));
}

function taskLooksDone(t) {
  const cat = (t.status_category || '').toLowerCase();
  if (cat === 'done' || cat === 'completed') return true;
  const name = (t.status_name || '').toLowerCase();
  return /done|closed|complete|resolved|hoàn thành|đã xong|đóng/i.test(name);
}

/**
 * Lấy message từ GitHub API cho một SHA.
 */
async function getGithubCommitMessage(repoUrl, accessToken, sha) {
  const { owner, repo } = GithubService.parseRepoUrl(repoUrl);
  const res = await axios.get(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, {
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      Accept: 'application/vnd.github.v3+json'
    },
    timeout: 30000
  });
  return (res.data?.commit?.message || '').trim() || '(không có message)';
}

const MAX_DIFF_CHARS = 120000;

function stripMarkdownFences(text) {
  return String(text || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function extractFirstJsonObject(text) {
  const cleaned = stripMarkdownFences(text);
  // Nếu model trả đúng 1 object JSON thì parse luôn
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      return JSON.parse(cleaned);
    } catch {
      // fallthrough
    }
  }

  // Nếu có thêm text xung quanh, cắt phần object JSON đầu tiên
  const match = cleaned.match(/{[\s\S]*}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isConventionalCommitMessage(message) {
  const msg = String(message || '').trim();
  // Conventional Commits: type(scope)!: subject
  return /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?(!)?:\s.+/i.test(msg);
}

/**
 * Tool: lấy diff commit + chấm/review bằng Gemini (không gọi Python).
 * Round-robin key + retry 429 nội bộ qua `withGemini429Retry`.
 * @param {string} modelName
 */
async function reviewGithubCommitWithGemini(projectId, commitHash, user, modelName) {
  const sha = (commitHash || '').trim();
  if (!sha) {
    return { ok: false, error: 'Thiếu commitHash.' };
  }

  const project = await models.Project.findById(projectId).lean();
  if (!project?.githubRepoUrl) {
    return { ok: false, error: 'Project chưa gắn GitHub repository.' };
  }

  const token = user?.integrations?.github?.accessToken;
  if (!token) {
    return {
      ok: false,
      error: 'Tài khoản chưa kết nối GitHub OAuth. Không thể lấy diff.'
    };
  }

  const teamId = project.team_id;
  if (!teamId) {
    return { ok: false, error: 'Không tìm thấy team_id để lưu ai_score.' };
  }

  // Merge commit: không chấm AI (tránh tốn quota / diff merge vô nghĩa)
  let commitDocPre = await models.GithubCommit.findOne({ team_id: teamId, hash: sha }).lean();
  if (!commitDocPre && sha.length < 40) {
    const re = new RegExp('^' + escapeRegex(sha));
    commitDocPre = await models.GithubCommit.findOne({ team_id: teamId, hash: re }).lean();
  }
  if (
    commitDocPre?.is_merge_commit ||
    (commitDocPre && models.GithubCommit.isMergeCommitMessage(commitDocPre.message))
  ) {
    return { ok: false, error: 'Merge commit — không chấm điểm' };
  }

  let commitMessage;
  let files;
  try {
    commitMessage = await getGithubCommitMessage(project.githubRepoUrl, token, sha);
    files = await GithubService.getCommitDetails(project.githubRepoUrl, token, sha);
  } catch (e) {
    const status = e.response?.status;
    const msg = e.response?.data?.message || e.message;
    return {
      ok: false,
      error: status === 404 ? 'Không tìm thấy commit hoặc không có quyền truy cập repo.' : msg
    };
  }

  if (models.GithubCommit.isMergeCommitMessage(commitMessage)) {
    return { ok: false, error: 'Merge commit — không chấm điểm' };
  }

  const filtered = (files || []).filter(
    (f) => f && f.filename && !isJunkFile(f.filename)
  );
  const codeDiffString = filtered
    .map((f) => (typeof f.patch === 'string' ? f.patch : ''))
    .filter(Boolean)
    .join('\n\n---\n\n')
    .trim();

  if (!codeDiffString) {
    return {
      ok: false,
      error: 'Không có đoạn diff logic để review (chỉ lock/ảnh/dist?).'
    };
  }

  const diffTruncated =
    codeDiffString.length > MAX_DIFF_CHARS
      ? `${codeDiffString.slice(0, MAX_DIFF_CHARS)}\n\n...[diff bị cắt bớt]`
      : codeDiffString;

  const systemInstruction =
    'BẠT BUỘC CHỈ TRẢ VỀ 1 JSON OBJECT HỢP LỆ (không kèm text khác ngoài JSON).\n' +
    'JSON có cấu trúc chính xác: { "score": <number 0..10>, "review": "<string nhận xét chi tiết>" }.\n' +
    '\n' +
    'Chấm điểm công bằng theo 2 tiêu chí (thang 10):\n' +
    '1) Tiêu chí 1 (20%): Format commit message (ưu tiên Conventional Commits).\n' +
    '- Nếu commit message không rõ ràng / sai chuẩn Conventional Commits => giảm điểm CHỈ ở phần Format.\n' +
    '- Sai tên/format commit message KHÔNG được phép kéo final score về 0 nếu code diff tốt.\n' +
    '2) Tiêu chí 2 (80%): Chất lượng code diff.\n' +
    '- Nếu diff xử lý logic tốt, tối ưu, không có lỗi nghiêm trọng => BẮT BUỘC chấm điểm cao cho tiêu chí 2.\n' +
    '\n' +
    'Quy tắc bắt buộc:\n' +
    '- Tuyệt đối KHÔNG chấm 0 điểm chỉ vì sai format commit message.\n' +
    '- Luôn chấm tiêu chí 2 nếu diff tồn tại (không bỏ qua).\n' +
    '- Final score phải phản ánh đúng trọng số 20%/80%. Nếu code diff tốt thì final score phải cao (không được “quên” tiêu chí 2).\n' +
    '\n' +
    'Không dùng Markdown code fence. Trả lời tiếng Việt trong trường "review", viết rõ ràng, phân tích vừa đủ chi tiết và có đề xuất cải thiện cụ thể.';

  const prompt = `Commit message:\n${commitMessage}\n\nDiff (patch):\n${diffTruncated}`;
  let result;
  try {
    result = await withGemini429Retry(async (genAI) => {
      const reviewer = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction
      });
      return reviewer.generateContent(prompt);
    });
  } catch (err) {
    if (isGeminiRateLimitError(err)) {
      return { ok: false, error: GEMINI_QUOTA_USER_MESSAGE, quotaExceeded: true };
    }
    throw err;
  }
  const rawText = (result?.response?.text?.() || '').trim();
  if (!rawText) {
    return { ok: false, error: 'Gemini không trả về nội dung JSON.' };
  }

  const parsed = extractFirstJsonObject(rawText);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Không parse được JSON từ Gemini response.' };
  }

  const score = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score);
  const review = typeof parsed.review === 'string' ? parsed.review.trim() : '';

  if (Number.isNaN(score) || score < 0 || score > 10 || !review) {
    return { ok: false, error: 'JSON từ Gemini thiếu score/review hợp lệ.' };
  }

  // Tìm commit trong DB theo hash (ưu tiên match exact, fallback match theo prefix nếu ai gửi short SHA)
  let resolvedHash = sha;
  let commitDoc = await models.GithubCommit.findOne({ team_id: teamId, hash: resolvedHash }).lean();
  if (!commitDoc && sha.length < 40) {
    const re = new RegExp('^' + escapeRegex(sha));
    commitDoc = await models.GithubCommit.findOne({ team_id: teamId, hash: re }).lean();
    if (commitDoc?.hash) resolvedHash = commitDoc.hash;
  }

  if (!commitDoc && sha.length < 40) {
    // Nếu ai_score yêu cầu commit đã tồn tại, thiếu commit sẽ báo rõ để debug
    return { ok: false, error: 'Không tìm thấy commit trong DB để lưu điểm.' };
  }

  // Upsert theo hash resolved (nếu có)
  const baseScore = score;
  const conventionalOk = isConventionalCommitMessage(commitMessage);
  // CTO policy: commit message quyết định hệ số trừ điểm, không loại commit.
  const finalScoreRaw = conventionalOk ? baseScore : baseScore * 0.7;
  const finalScore = Math.max(0, Math.min(10, Math.round(finalScoreRaw * 100) / 100));

  const penaltyNote = conventionalOk
    ? ''
    : '\n\n[Hệ số] Tin nhắn commit chưa theo Conventional Commits — áp hệ số 0,7 vào điểm AI (thang 10).';

  await models.GithubCommit.findOneAndUpdate(
    { team_id: teamId, hash: resolvedHash },
    { $set: { ai_score: finalScore, ai_review: `${review}${penaltyNote}` } },
    { new: true }
  );

  return `Đã review xong. Điểm: ${finalScore}/10 (gốc ${baseScore}/10).`;
}

/**
 * Gom Jira + GitHub + thành viên nhóm thành context JSON (string) cho RAG / Project Assistant.
 * @param {string} projectId
 * @returns {Promise<string|null>} JSON.stringify gọn hoặc null nếu không có project
 */
async function gatherProjectContext(projectId) {
  const project = await models.Project.findById(projectId)
    .populate('class_id', 'name')
    .lean();
  if (!project) return null;

  const teamId = project.team_id;

  const teamMembers = await models.TeamMember.find({
    team_id: teamId,
    is_active: true
  })
    .populate('student_id', 'student_code email full_name')
    .lean();

  const members = teamMembers.map((tm) => ({
    role_in_team: tm.role_in_team || null,
    github_username: tm.github_username || null,
    student_code: tm.student_id?.student_code || null,
    email: tm.student_id?.email || null,
    full_name: tm.student_id?.full_name || null,
    git_contribution_ratio:
      typeof tm.git_score === 'number' && !Number.isNaN(tm.git_score) ? tm.git_score : null,
    jira_contribution_ratio:
      typeof tm.jira_score === 'number' && !Number.isNaN(tm.jira_score) ? tm.jira_score : null
  }));

  const sprints = await models.Sprint.find({ team_id: teamId }).select('_id').lean();
  const sprintIds = sprints.map((s) => s._id);

  const jiraTasksRaw = await models.JiraTask.find({
    $or: [{ team_id: teamId }, { sprint_id: { $in: sprintIds } }]
  })
    .sort({ updated_at: -1 })
    .limit(100)
    .lean();

  const jiraTasks = jiraTasksRaw.map((t) => ({
    issue_key: t.issue_key,
    summary: t.summary || '',
    status: t.status_name || '',
    status_category: t.status_category || '',
    assignee: {
      name: t.assignee_name || null,
    },
    story_points: typeof t.story_point === 'number' ? t.story_point : 0,
    due_date: t.due_date || null,
    updated_at: t.updated_at || null
  }));

  const commitsRaw = await models.GithubCommit.find({ team_id: teamId })
    .sort({ commit_date: -1 })
    .limit(100)
    .lean();

  const githubCommits = commitsRaw.map((c) => ({
    commit_message: c.message || '',
    author: {
      name: c.author_name || null,
      email: c.author_email || null
    },
    is_counted: !!c.is_counted,
    ai_score: typeof c.ai_score === 'number' ? c.ai_score : null,
    commit_date: c.commit_date || null,
    hash: c.hash || null
  }));

  const doneTasksByAssignee = {};
  for (const t of jiraTasksRaw) {
    if (!taskLooksDone(t)) continue;
    const key = (t.assignee_name && String(t.assignee_name).trim()) || 'Unassigned';
    doneTasksByAssignee[key] = (doneTasksByAssignee[key] || 0) + 1;
  }

  const countedCommitsByAuthorEmail = {};
  for (const c of commitsRaw) {
    if (!c.is_counted) continue;
    const key = (c.author_email || c.author_name || 'unknown').toLowerCase().trim();
    countedCommitsByAuthorEmail[key] = (countedCommitsByAuthorEmail[key] || 0) + 1;
  }

  const payload = {
    project: {
      name: project.name,
      class_name: project.class_id?.name || null,
      jiraProjectKey: project.jiraProjectKey || '',
      githubRepoUrl: project.githubRepoUrl || ''
    },
    members,
    jiraTasks,
    githubCommits,
    precomputed: {
      doneTasksByAssignee,
      countedCommitsByAuthorEmail
    }
  };

  return JSON.stringify(payload);
}

/**
 * Gom context cho cả lớp (dùng cho LECTURER).
 * Tìm tất cả Project thuộc classId, sau đó Promise.all gọi gatherProjectContext cho từng project.
 * @param {string} classId
 * @returns {Promise<string|null>}
 */
async function gatherClassContext(classId) {
  if (!classId || !mongoose.Types.ObjectId.isValid(String(classId))) return null;

  const classDoc = await models.Class.findById(classId)
    .select('name')
    .lean();

  const projects = await models.Project.find({ class_id: classId })
    .select('_id')
    .lean();

  if (!projects || projects.length === 0) return null;

  const contexts = await Promise.all(
    projects.map(async (p) => {
      try {
        const ctxStr = await gatherProjectContext(p._id);
        if (!ctxStr) return null;
        return JSON.parse(ctxStr);
      } catch {
        return null;
      }
    })
  );

  const normalized = contexts.filter(Boolean);
  return JSON.stringify({
    class_name: classDoc?.name || null,
    total_projects: normalized.length,
    projects: normalized
  });
}

const MAX_EXPORT_REPORT_CHARS = 120000;

/**
 * Sinh Markdown báo cáo (SRS / tiến độ / tổng quan) từ context dự án — dùng cho tool exportReport.
 */
async function generateExportReportMarkdown(contextData, reportType, modelName) {
  const type = String(reportType || 'general').toLowerCase();

  let instruction = '';
  if (type === 'srs') {
    instruction = `Hãy đóng vai Chuyên gia Phân tích Nghiệp vụ (Business Analyst).
Dựa vào dữ liệu JSON sau, viết tài liệu Đặc tả Yêu cầu Phần mềm (SRS) hoàn chỉnh bằng Markdown (tiếng Việt).

Cấu trúc bắt buộc:
1. Giới thiệu (Mục đích, Phạm vi dự án)
2. Tính năng hệ thống (Liệt kê dựa trên các Epic/Story/Task trong Jira)
3. Báo cáo tiến độ và đóng góp của team (Jira + GitHub)
4. Rủi ro & Đề xuất (dựa trên task trễ hoặc ít commit)

TUYỆT ĐỐI KHÔNG BỊA ĐẶT. Nếu thiếu dữ liệu, nêu rõ "chưa có dữ liệu".`;
  } else if (type === 'progress') {
    instruction = `Viết báo cáo tiến độ dự án bằng Markdown (tiếng Việt), súc tích nhưng đủ mục:
- Tóm tắt trạng thái sprint/task (theo dữ liệu Jira)
- Hoạt động commit gần đây (GitHub)
- Điểm nghẽn / rủi ro

Chỉ dựa trên dữ liệu JSON sau, không bịa.`;
  } else {
    instruction = `Viết báo cáo tổng quan dự án bằng Markdown (tiếng Việt): mục tiêu, phạm vi, tiến độ, đóng góp, đề xuất — chỉ từ dữ liệu JSON sau.`;
  }

  const prompt = `Dữ liệu thực tế dự án (JSON):\n${contextData}\n\n${instruction}`;
  const resolvedModel = modelName || 'gemini-2.5-flash';
  let result;
  try {
    result = await withGemini429Retry(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: resolvedModel });
      return model.generateContent(prompt);
    });
  } catch (err) {
    if (isGeminiRateLimitError(err)) {
      return { ok: false, error: GEMINI_QUOTA_USER_MESSAGE, quotaExceeded: true };
    }
    throw err;
  }
  let md = result?.response?.text?.() || '';
  if (!String(md).trim()) {
    return { ok: false, error: 'Model không trả về nội dung báo cáo.' };
  }
  md = String(md).trim();
  if (md.length > MAX_EXPORT_REPORT_CHARS) {
    md =
      md.slice(0, MAX_EXPORT_REPORT_CHARS) +
      '\n\n---\n*(Đã cắt bớt độ dài; vẫn đủ để tóm tắt.)*';
  }
  return { ok: true, reportType: type, markdown: md, charCount: md.length };
}

/**
 * Markdown → HTML (markdown-it) → PDF (puppeteer), lưu `public/exports/`.
 * @param {string} markdown
 * @param {string} projectId
 * @param {import('express').Request} [req] — để build URL tuyệt đối
 * @returns {Promise<{ filename: string, downloadUrl: string, filePath: string }>}
 */
async function saveMarkdownAsPdfFile(markdown, projectId, req) {
  const exportsDir = path.join(__dirname, '..', 'public', 'exports');
  await fs.mkdir(exportsDir, { recursive: true });
  const safeId = String(projectId).replace(/[^a-f0-9]/gi, '').slice(0, 24) || 'proj';
  const filename = `report-${safeId}-${Date.now()}.pdf`;
  const filePath = path.join(exportsDir, filename);

  const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
  const bodyHtml = md.render(String(markdown || ''));

  const fullHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Báo cáo dự án</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11pt; line-height: 1.45; color: #1a1a1a; margin: 24px; }
  h1 { font-size: 18pt; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
  h2 { font-size: 14pt; margin-top: 1.2em; }
  h3 { font-size: 12pt; }
  code, pre { font-family: Consolas, monospace; font-size: 9pt; background: #f4f4f4; }
  pre { padding: 10px; overflow-x: auto; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  blockquote { border-left: 4px solid #ccc; margin-left: 0; padding-left: 12px; color: #555; }
  ul, ol { padding-left: 1.4em; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: PUPPETEER_LAUNCH_ARGS
  });
  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 120000 });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', right: '14mm', bottom: '18mm', left: '14mm' }
    });
    await fs.writeFile(filePath, pdfBuffer);
  } finally {
    await browser.close();
  }

  const base = GithubService.getWebhookBackendBaseUrl(req);
  const downloadUrl = base
    ? `${String(base).replace(/\/$/, '')}/exports/${encodeURIComponent(filename)}`
    : `/exports/${encodeURIComponent(filename)}`;

  return { filename, downloadUrl, filePath };
}

/**
 * Sinh Markdown (Gemini) rồi xuất PDF; trả `downloadUrl` cho tool exportReport.
 * Dùng puppeteer (đã khai báo trong package.json); html-pdf-node giữ trong deps nếu cần mở rộng sau.
 */
async function generateExportReportWithPdf(contextData, reportType, modelName, { projectId, req }) {
  const mdResult = await generateExportReportMarkdown(contextData, reportType, modelName);
  if (!mdResult.ok) return mdResult;
  try {
    const { filename, downloadUrl, filePath } = await saveMarkdownAsPdfFile(
      mdResult.markdown,
      projectId,
      req
    );
    return {
      ...mdResult,
      downloadUrl,
      pdfFilename: filename,
      pdfPath: filePath
    };
  } catch (e) {
    console.error('[AiChatService] generateExportReportWithPdf PDF error:', e.message || e);
    return {
      ...mdResult,
      downloadUrl: null,
      pdfError: e.message || 'Không tạo được file PDF.'
    };
  }
}

module.exports = {
  gatherProjectContext,
  gatherClassContext,
  reviewGithubCommitWithGemini,
  generateExportReportMarkdown,
  saveMarkdownAsPdfFile,
  generateExportReportWithPdf,
  GEMINI_QUOTA_USER_MESSAGE,
  isGeminiRateLimitError
};
