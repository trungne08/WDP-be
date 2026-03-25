const axios = require('axios');
const mongoose = require('mongoose');
const models = require('../models');
const GithubService = require('./GithubService');

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

/**
 * Tool: lấy diff commit + chấm/review bằng Gemini (không gọi Python).
 * @param {import('@google/generative-ai').GoogleGenerativeAI} genAI
 * @param {string} modelName
 */
async function reviewGithubCommitWithGemini(projectId, commitHash, user, genAI, modelName) {
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

  const reviewer = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction:
      'Bạn là reviewer code chuyên nghiệp. Phân tích diff, nêu ưu/điểm cần cải thiện. Cho điểm tổng thể thang 0–10 (ghi rõ số điểm). Trả lời tiếng Việt, Markdown ngắn gọn.'
  });

  const prompt = `Commit message:\n${commitMessage}\n\nDiff (patch):\n${diffTruncated}`;
  const result = await reviewer.generateContent(prompt);
  const reviewText = (result?.response?.text?.() || '').trim();

  if (!reviewText) {
    return { ok: false, error: 'Gemini không trả về nội dung review.' };
  }

  return {
    ok: true,
    commitHash: sha,
    commitMessage,
    review: reviewText
  };
}

/**
 * Gom Jira + GitHub + thành viên nhóm thành context JSON (string) cho RAG / Project Assistant.
 * @param {string} projectId
 * @returns {Promise<string|null>} JSON.stringify gọn hoặc null nếu không có project
 */
async function gatherProjectContext(projectId) {
  const project = await models.Project.findById(projectId).lean();
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
    jira_account_id: tm.jira_account_id || null,
    student_code: tm.student_id?.student_code || null,
    email: tm.student_id?.email || null,
    full_name: tm.student_id?.full_name || null
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
      account_id: t.assignee_account_id || null
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
    const key =
      (t.assignee_name && String(t.assignee_name).trim()) ||
      (t.assignee_account_id && `account:${t.assignee_account_id}`) ||
      'Unassigned';
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
      id: String(project._id),
      name: project.name,
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
    class_id: String(classId),
    total_projects: normalized.length,
    projects: normalized
  });
}

module.exports = {
  gatherProjectContext,
  gatherClassContext,
  reviewGithubCommitWithGemini
};
