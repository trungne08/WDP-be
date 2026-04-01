const models = require('../models');
const mongoose = require('mongoose');
const { Sprint, JiraTask } = require('../models/JiraData');
const { extractStoryPoint } = require('../services/JiraSyncService');
const GithubService = require('../services/GithubService');
const { commitBelongsToAuthor } = require('../utils/commitUtils');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { reviewGithubCommitWithGemini } = require('../services/AiChatService');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function taskLooksDoneByStatus(statusCategory, statusName) {
  const cat = String(statusCategory || '').toLowerCase();
  if (cat === 'done' || cat === 'completed') return true;
  const name = String(statusName || '').toLowerCase();
  return /done|closed|complete|resolved|hoàn thành|đã xong|đóng/i.test(name);
}

function stripMarkdownFences(text) {
  return String(text || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function tryParseJsonArray(text) {
  const cleaned = stripMarkdownFences(text);
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function gradeTeamMembersWithGemini({ teamId, leaderboard, genAI, modelName }) {
  const list = Array.isArray(leaderboard) ? leaderboard : [];
  if (list.length === 0) return [];

  const grader = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction:
      'BẮT BUỘC CHỈ TRẢ VỀ 1 JSON ARRAY HỢP LỆ (không kèm Markdown, không kèm giải thích).\n' +
      'Mỗi phần tử đúng cấu trúc: {"student_code": "SE...", "grade": 8.5, "review_comment": "..."}\n' +
      'Không được trả về object bao ngoài. Không được thêm text trước/sau JSON.\n' +
      'grade là number 0..10.'
  });

  const input = list.map((r) => ({
    student_code: r.student_code || null,
    full_name: r.full_name || null,
    contribution_percent: typeof r.percent === 'number' ? r.percent : 0,
    jira_done_story_points: typeof r.jira_done_story_points === 'number' ? r.jira_done_story_points : 0,
    github_ai_score: typeof r.github_ai_score === 'number' ? r.github_ai_score : 0
  }));

  const prompt =
    'Dưới đây là dữ liệu đóng góp của các thành viên trong nhóm.\n' +
    'Hãy chấm điểm cá nhân (0..10) và ghi nhận xét ngắn gọn cho từng thành viên.\n' +
    'Trả về JSON ARRAY theo đúng cấu trúc yêu cầu.\n\n' +
    JSON.stringify({ teamId: String(teamId), members: input });

  const result = await grader.generateContent(prompt);
  const raw = (result?.response?.text?.() || '').trim();
  const arr = tryParseJsonArray(raw);
  if (!arr) {
    const err = new Error('Không parse được JSON array từ AI grading output.');
    err.raw = raw;
    throw err;
  }

  return arr;
}

async function calculateTeamContribution(teamId) {
  const teamObjectId = mongoose.Types.ObjectId.isValid(String(teamId))
    ? new mongoose.Types.ObjectId(teamId)
    : teamId;

  // Weights theo cấu hình Class (nếu có)
  let jiraWeight = 0.5;
  let gitWeight = 0.5;
  const teamDoc = await models.Team.findById(teamObjectId).lean();
  const classDoc = teamDoc?.class_id ? await models.Class.findById(teamDoc.class_id).lean() : null;
  const cfg = classDoc?.contributionConfig || null;
  if (cfg) {
    jiraWeight = typeof cfg.jiraWeight === 'number' ? cfg.jiraWeight : jiraWeight;
    gitWeight = typeof cfg.gitWeight === 'number' ? cfg.gitWeight : gitWeight;
  }
  const sumWeights = (jiraWeight + gitWeight) || 1;
  const wJira = jiraWeight / sumWeights;
  const wGit = gitWeight / sumWeights;

  const teamMembers = await models.TeamMember.find({
    team_id: teamObjectId,
    is_active: true
  })
    .populate('student_id', 'student_code email full_name')
    .lean();

  const memberById = new Map(teamMembers.map((m) => [String(m._id), m]));
  const emailToMember = new Map(
    teamMembers.map((m) => [String(m.student_id?.email || '').toLowerCase().trim(), m])
  );

  // 1) Jira done story points aggregate theo assignee_id (TeamMember)
  const jiraAgg = await JiraTask.aggregate([
    {
      $match: {
        team_id: teamObjectId,
        $or: [
          { status_category: { $regex: /^(done|completed)$/i } },
          { status_name: { $regex: /(done|closed|complete|resolved|hoàn thành|đã xong|đóng)/i } }
        ]
      }
    },
    {
      $group: {
        _id: '$assignee_id',
        totalStoryPoints: { $sum: '$story_point' }
      }
    }
  ]);

  const jiraPointsByMemberId = new Map();
  for (const row of jiraAgg || []) {
    if (!row?._id) continue;
    jiraPointsByMemberId.set(String(row._id), Number(row.totalStoryPoints || 0));
  }

  const totalJiraPoints = Array.from(jiraPointsByMemberId.values()).reduce((a, b) => a + b, 0);

  // 2) GitHub ai_score aggregate theo TeamMember (match email trước, fallback github_username)
  // Chỉ commit hợp lệ mới được tính điểm.
  const gitCommits = await models.GithubCommit.find({
    team_id: teamObjectId,
    is_counted: true,
    ai_score: { $ne: null }
  })
    .select('author_email author_name ai_score')
    .lean();

  const normalizeAiScore = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    // AI score hiện tại được review theo thang 0..10
    if (n < 0) return 0;
    if (n > 10) return 10;
    return n;
  };

  const gitScoreByMemberId = new Map();
  for (const c of gitCommits || []) {
    const score = normalizeAiScore(c?.ai_score);
    if (score <= 0) continue;

    let matchedMember = null;
    const emailLc = String(c?.author_email || '').toLowerCase().trim();
    if (emailLc && emailToMember.has(emailLc)) {
      matchedMember = emailToMember.get(emailLc);
    } else {
      // Fallback khi email không match: đối chiếu github_username với author info
      matchedMember = teamMembers.find((m) =>
        commitBelongsToAuthor(
          { author_email: c?.author_email, author_name: c?.author_name },
          [m?.student_id?.email || ''],
          [m?.github_username || '']
        )
      ) || null;
    }

    if (!matchedMember?._id) continue;
    const key = String(matchedMember._id);
    gitScoreByMemberId.set(key, Number(gitScoreByMemberId.get(key) || 0) + score);
  }
  const totalGitScore = Array.from(gitScoreByMemberId.values()).reduce((a, b) => a + b, 0);

  const leaderboard = teamMembers.map((m) => {
    const memberId = String(m._id);
    const donePoints = Number(jiraPointsByMemberId.get(memberId) || 0);
    const aiScoreTotal = Number(gitScoreByMemberId.get(memberId) || 0);

    const jiraPercent = totalJiraPoints > 0 ? donePoints / totalJiraPoints : 0;
    const gitPercent = totalGitScore > 0 ? aiScoreTotal / totalGitScore : 0;

    let percent = 0;
    if (totalJiraPoints > 0 && totalGitScore > 0) {
      // Theo trọng số %Jira + %GitHub (peer tạm 0%)
      percent = (jiraPercent * wJira + gitPercent * wGit) * 100;
    } else if (totalJiraPoints > 0) {
      percent = jiraPercent * 100;
    } else if (totalGitScore > 0) {
      percent = gitPercent * 100;
    }

    return {
      team_member_id: memberId,
      student_code: m.student_id?.student_code || null,
      email: m.student_id?.email || null,
      full_name: m.student_id?.full_name || null,
      percent: Math.round(percent * 100) / 100,
      jira_done_story_points: donePoints,
      github_ai_score: aiScoreTotal
    };
  });

  // Persist leaderboard -> TeamMember để phục vụ tính điểm cuối kỳ
  await Promise.all(
    leaderboard.map(async (row) => {
      try {
        if (!row.team_member_id) return;
        await models.TeamMember.findByIdAndUpdate(
          row.team_member_id,
          {
            $set: {
              contribution_percent: row.percent,
              jira_story_points: row.jira_done_story_points,
              github_ai_score: row.github_ai_score
            }
          }
        );
      } catch (e) {
        console.warn('[calculateTeamContribution] Update TeamMember failed:', e.message || e);
      }
    })
  );

  return { teamId: String(teamId), leaderboard };
}

/**
 * POST /api/webhooks/jira/:webhookCloudId
 * Nhận Jira dynamic webhook (không JWT). Path param = Cloud ID (trùng URL đã đăng ký trên Atlassian).
 * Payload: webhookEvent, issue (fields.summary, status, assignee, story points qua extractStoryPoint).
 */
exports.receiveJiraWebhook = async (req, res) => {
  try {
    const body = req.body || {};
    const eventType = body.webhookEvent;
    const issue = body.issue;
    const project = issue?.fields?.project;

    if (!eventType || !issue || !project) {
      return res.status(200).send('Jira Webhook received');
    }

    const issueId = issue.id;
    const issueKey = issue.key;
    const summary = issue.fields?.summary ?? '';
    const status = issue.fields?.status?.name ?? '';
    const assigneeEmail = issue.fields?.assignee?.emailAddress;
    const storyPoints = extractStoryPoint(issue.fields || {});

    console.log(`📥 [Jira Webhook] ${eventType} — ${issueKey} (${issueId}) | SP=${storyPoints} | assigneeEmail=${assigneeEmail || '—'}`);

    const webhookCloudId = (req.params?.webhookCloudId || '').toString().trim();
    if (!webhookCloudId) {
      console.warn('⚠️ [Jira Webhook] Thiếu webhookCloudId (path param). Skip để tránh cross-talk.');
      return res.status(200).send('Jira Webhook received');
    }

    const projectKey = project.key;
    const dbProject = await models.Project.findOne({
      jiraProjectKey: projectKey,
      jiraCloudId: webhookCloudId
    }).lean();

    if (!dbProject) {
      console.log(`⚠️ [Jira Webhook] Không tìm thấy Project với key: ${projectKey} (cloudId=${webhookCloudId})`);
      return res.status(200).send('Jira Webhook received');
    }

    const teamMember = await models.TeamMember.findOne({
      project_id: dbProject._id,
      is_active: true
    }).lean();

    // team_id: ưu tiên TeamMember; fallback Project.team_id (tránh webhook im lặng khi thiếu bản ghi TeamMember)
    const teamId = teamMember?.team_id || dbProject.team_id || null;
    if (!teamId) {
      console.log(`⚠️ [Jira Webhook] Không có team_id cho project: ${dbProject._id}`);
      return res.status(200).send('Jira Webhook received');
    }
    if (!teamMember && dbProject.team_id) {
      console.warn(
        `⚠️ [Jira Webhook] Không có TeamMember active cho project ${dbProject._id}; dùng team_id từ Project.`
      );
    }

    const emitTaskEvent = (eventName, taskData) => {
      const io = req.app.get('io');
      if (!io) return;
      const projectRoom = `project:${String(dbProject._id)}`;
      io.to(projectRoom).emit(eventName, taskData);
      // Cùng id với socket.on('join_class', ...) trong index.js — FE màn Tasks theo lớp thường chỉ join room này
      if (dbProject.class_id) {
        io.to(String(dbProject.class_id)).emit(eventName, taskData);
      }
    };

    if (eventType === 'jira:issue_deleted') {
      // Upsert ở create/update dùng issue_id + cloud_id nên delete cũng dùng cùng bộ khóa để tránh lệch khi issue_key thay đổi
      // JiraTaskSchema đang có unique index trên `issue_id` (không bao gồm `cloud_id`),
      // nên filter cũng phải chỉ theo `issue_id` để tránh E11000 khi `cloud_id` khác.
      await JiraTask.deleteOne({ issue_id: issueId });
      console.log(`✅ [Jira Webhook] Đã xóa task: ${issueKey}`);
      emitTaskEvent('task_updated', {
        issueKey,
        issueId,
        status,
        projectId: String(dbProject._id),
        action: 'delete'
      });
      return res.status(200).send('Jira Webhook received');
    }

    if (eventType === 'jira:issue_created' || eventType === 'jira:issue_updated') {
      const defaultSprint = await Sprint.findOneAndUpdate(
        { team_id: teamId, name: 'Default Sprint' },
        {
          team_id: teamId,
          jira_sprint_id: 0,
          name: 'Default Sprint',
          state: 'active',
          isCompleted: false,
          start_date: new Date(),
          end_date: null
        },
        { upsert: true, new: true }
      );
      const sprintId = defaultSprint._id;

      let assigneeMemberId = null;
      const assigneeAccountId = issue.fields?.assignee?.accountId;

      if (assigneeAccountId && teamId) {
        const member = await models.TeamMember.findOne({
          team_id: teamId,
          jira_account_id: assigneeAccountId,
          is_active: true
        }).select('_id');
        assigneeMemberId = member ? member._id : null;
      }

      if (!assigneeMemberId && assigneeEmail && teamId) {
        const members = await models.TeamMember.find({
          team_id: teamId,
          is_active: true
        })
          .populate('student_id', 'email')
          .lean();
        const lower = assigneeEmail.toLowerCase();
        const found = members.find(
          (m) => (m.student_id?.email || '').toLowerCase() === lower
        );
        assigneeMemberId = found ? found._id : null;
      }

      // 🛡️ Không được overwrite Story Points về 0 nếu payload webhook không có SP.
      // `extractStoryPoint()` có thể trả 0 cả khi "không có field", nên phải detect "field present" trước.
      const fields = issue.fields || {};
      const hasStoryPointField =
        Object.prototype.hasOwnProperty.call(fields, 'customfield_10016') ||
        Object.prototype.hasOwnProperty.call(fields, 'customfield_10026') ||
        Object.prototype.hasOwnProperty.call(fields, 'storyPoints') ||
        Object.keys(fields).some(
          (k) => k.startsWith('customfield_') && /^\d+$/.test(k.slice(12)) && fields[k] != null
        );

      const setDoc = {
        // Những field chắc chắn có trong payload issue webhook
        issue_key: issueKey,
        summary: issue.fields?.summary,
        status_name: issue.fields?.status?.name,
        status_category: issue.fields?.status?.statusCategory?.key || '',

        // Assignee: webhook có thể gửi null khi unassign => vẫn update
        assignee_account_id: assigneeAccountId || null,
        assignee_name: issue.fields?.assignee?.displayName || null,
        assignee_id: assigneeMemberId,

        // Luôn cập nhật updated_at để UI refresh đúng
        updated_at: issue.fields?.updated ? new Date(issue.fields.updated) : new Date()
      };

      // ---- Start Date / Due Date ----
      // Jira Due date: issue.fields.duedate (YYYY-MM-DD) hoặc null (khi user xóa ngày)
      if (Object.prototype.hasOwnProperty.call(fields, 'duedate')) {
        setDoc.due_date = fields.duedate ? new Date(fields.duedate) : null;
      }

      // Jira Start date: có thể là fields.startDate hoặc 1 customfield_xxxxx dạng date.
      // Ưu tiên explicit field, fallback rất thận trọng: nếu có đúng 1 customfield_* kiểu YYYY-MM-DD (khác duedate) thì dùng nó.
      // Start Date trên Jira Cloud dự án của bạn: customfield_10015
      if (Object.prototype.hasOwnProperty.call(fields, 'customfield_10015')) {
        setDoc.start_date = fields.customfield_10015 ? new Date(fields.customfield_10015) : null;
      } else if (Object.prototype.hasOwnProperty.call(fields, 'startDate')) {
        setDoc.start_date = fields.startDate ? new Date(fields.startDate) : null;
      } else if (Object.prototype.hasOwnProperty.call(fields, 'start_date')) {
        setDoc.start_date = fields.start_date ? new Date(fields.start_date) : null;
      } else {
        const dateLike = /^\d{4}-\d{2}-\d{2}$/;
        const candidates = Object.keys(fields)
          .filter((k) => k.startsWith('customfield_'))
          .map((k) => ({ key: k, value: fields[k] }))
          // accept string date or null (null means user cleared date)
          .filter((x) => x.value === null || (typeof x.value === 'string' && dateLike.test(x.value)))
          .filter((x) => x.value !== fields.duedate);

        if (candidates.length === 1) {
          const v = candidates[0].value;
          setDoc.start_date = v ? new Date(v) : null;
        }
      }

      if (hasStoryPointField) {
        setDoc.story_point = storyPoints;
      }

      const savedTask = await JiraTask.findOneAndUpdate(
        // Unique constraint trong JiraTaskSchema là issue_id (unique:true)
        // Upsert theo issue_id để tránh lỗi DuplicateKey khi issue_key thay đổi.
        { issue_id: issueId },
        {
          // Chỉ set những field "có trong payload" để tránh ghi đè mất dữ liệu DB (sprint_id, SP, ...)
          $set: setDoc,
          // Chỉ set sprint_id khi tạo mới (issue_created / insert lần đầu)
          $setOnInsert: {
            issue_id: issueId,
            cloud_id: webhookCloudId,
            team_id: teamId,
            sprint_id: sprintId,
            created_at: issue.fields?.created ? new Date(issue.fields.created) : new Date()
          }
        },
        { upsert: true, new: true }
      );

      console.log(`✅ [Jira Webhook] Đã cập nhật task: ${issueKey}`);
      const eventName = eventType === 'jira:issue_created' ? 'task_created' : 'task_updated';
      emitTaskEvent(eventName, {
        ...savedTask.toObject(),
        projectId: String(dbProject._id)
      });
    }

    return res.status(200).send('Jira Webhook received');
  } catch (error) {
    console.error('❌ [Jira Webhook]', error);
    return res.status(200).send('Jira Webhook received');
  }
};

/**
 * POST /api/webhooks/github
 * Nhận payload push từ GitHub (không dùng Bearer JWT — GitHub gọi trực tiếp).
 */
exports.receiveGithubWebhook = async (req, res) => {
  try {
    const event = (req.get('X-GitHub-Event') || '').trim();
    if (event !== 'push') {
      return res.status(200).send('Webhook received');
    }

    const payload = req.body || {};
    const commitsRaw = Array.isArray(payload.commits) ? payload.commits : [];
    const repoHtmlUrl = payload.repository?.html_url;

    if (!repoHtmlUrl || commitsRaw.length === 0) {
      return res.status(200).send('Webhook received');
    }

    let owner;
    let repo;
    try {
      ({ owner, repo } = GithubService.parseRepoUrl(repoHtmlUrl));
    } catch {
      return res.status(200).send('Webhook received');
    }

    const urlPattern = new RegExp(
      `(?:https?:\\/\\/)?(?:www\\.)?github\\.com\\/${escapeRegex(owner)}\\/${escapeRegex(repo)}(?:\\.git)?/?$`,
      'i'
    );

    const project = await models.Project.findOne({
      githubRepoUrl: urlPattern
    }).lean();

    if (!project) {
      console.log(`⚠️ [GitHub Webhook] Không tìm thấy project gắn repo ${owner}/${repo}`);
      return res.status(200).send('Webhook received');
    }

    const teamMembers = await models.TeamMember.find({
      project_id: project._id,
      is_active: true
    })
      .populate('student_id', 'email integrations')
      .exec();

    if (!teamMembers.length) {
      console.log(`⚠️ [GitHub Webhook] Project ${project._id} không có team member active — bỏ qua commit.`);
      return res.status(200).send('Webhook received');
    }

    const teamId = teamMembers[0].team_id;
    const GithubCommit = models.GithubCommit;
    const jiraRegex = /[A-Z][A-Z0-9]+-\d+/g;
    const branch = (payload.ref || '').replace(/^refs\/heads\//, '') || null;

    let commitsSaved = 0;
    const commitsToGrade = new Set();

    for (const c of commitsRaw) {
      if (!c.id) continue;

      const commitLike = {
        author_email: c.author?.email,
        author_name: c.author?.name
      };

      let matched = false;
      for (const m of teamMembers) {
        const emails = m.student_id?.email ? [m.student_id.email] : [];
        const githubUsernames = [m.github_username].filter(Boolean);
        if (commitBelongsToAuthor(commitLike, emails, githubUsernames)) {
          matched = true;
          break;
        }
      }

      if (!matched) continue;

      const commit = {
        hash: c.id,
        message: c.message,
        author_email: c.author?.email,
        author_name: c.author?.name,
        commit_date: c.timestamp ? new Date(c.timestamp) : new Date(),
        url: c.url,
        branch,
        branches: branch ? [branch] : []
      };

      const checkResult = await GithubCommit.processCommit(commit, teamId);
      const branchesToAdd = branch ? [branch] : [];
      const extractedJiraIssues = [...new Set((commit.message || '').match(jiraRegex) || [])];

      const setFields = {
        team_id: teamId,
        author_email: commit.author_email,
        author_name: commit.author_name,
        message: commit.message,
        commit_date: commit.commit_date,
        url: commit.url,
        branch,
        is_counted: checkResult.is_counted,
        is_merge_commit: !!checkResult.isMergeCommit,
        rejection_reason: checkResult.is_counted ? null : checkResult.reason,
        scoring_note_vi: checkResult.scoringNoteVi != null ? checkResult.scoringNoteVi : null
      };
      if (checkResult.isMergeCommit) {
        setFields.ai_score = null;
        setFields.ai_review = null;
        setFields.scoring_note_vi = null;
      }

      const updateDoc = {
        $set: setFields
      };

      const addToSetFields = {};
      if (branchesToAdd.length > 0) addToSetFields.branches = { $each: branchesToAdd };
      if (extractedJiraIssues.length > 0) addToSetFields.jira_issues = { $each: extractedJiraIssues };
      if (Object.keys(addToSetFields).length > 0) updateDoc.$addToSet = addToSetFields;

      await GithubCommit.findOneAndUpdate(
        { team_id: teamId, hash: commit.hash },
        updateDoc,
        { upsert: true, new: true }
      );
      commitsSaved += 1;
      if (checkResult.is_counted) {
        commitsToGrade.add(commit.hash);
      }
    }

    const io = req.app.get('io');
    if (io && commitsSaved > 0) {
      const githubNewCommitsPayload = {
        message: 'Có code mới vừa được push lên GitHub!',
        commitsCount: commitsSaved,
        projectName: project.name || '',
        projectId: String(project._id),
        ...(project.class_id ? { classId: String(project.class_id) } : {})
      };
      // Emit theo room để chỉ client liên quan mới nhận được.
      io.to(`project:${String(project._id)}`).emit('GITHUB_NEW_COMMITS', githubNewCommitsPayload);
      if (project.class_id) {
        io.to(String(project.class_id)).emit('GITHUB_NEW_COMMITS', githubNewCommitsPayload);
      }
    } else if (commitsRaw.length > 0 && commitsSaved === 0) {
      console.log(
        `⚠️ [GitHub Webhook] ${owner}/${repo}: có ${commitsRaw.length} commit nhưng không khớp member (email/github_username) hoặc bị bỏ qua.`
      );
    }

    // Background AI grading + leaderboard update (không chặn webhook response)
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const THROTTLE_MS = Number(process.env.GEMINI_THROTTLE_MS || 1000);

    const backgroundCommitHashes = Array.from(commitsToGrade);
    if (backgroundCommitHashes.length > 0 && geminiKey && project?._id) {
      const githubUser =
        teamMembers.find((tm) => tm?.student_id?.integrations?.github?.accessToken)?.student_id ||
        null;

      // Nếu không có accessToken nào trong nhóm thì skip AI chấm điểm.
      if (githubUser) {
        const projectIdStr = String(project._id);
        const teamIdStr = String(teamId);

        setImmediate(async () => {
          try {
            const genAI = new GoogleGenerativeAI(geminiKey);

            for (const hash of backgroundCommitHashes) {
              try {
                // Chỉ review khi commit chưa có ai_score (để tránh chấm lặp)
                const existing = await models.GithubCommit.findOne({
                  team_id: teamId,
                  hash
                }).select('ai_score').lean();
                if (existing?.ai_score != null) continue;

                await reviewGithubCommitWithGemini(
                  projectIdStr,
                  hash,
                  githubUser,
                  genAI,
                  geminiModel
                );

                await new Promise((r) => setTimeout(r, THROTTLE_MS));
              } catch (e) {
                console.warn('[GitHub Webhook] AI review error:', e?.message || e);
              }
            }

            const leaderboardData = await calculateTeamContribution(teamIdStr);

            // AI grading per member -> persist into TeamMember (ai_grade + ai_review_comment)
            try {
              if (leaderboardData?.leaderboard?.length) {
                const grades = await gradeTeamMembersWithGemini({
                  teamId: teamIdStr,
                  leaderboard: leaderboardData.leaderboard,
                  genAI,
                  modelName: geminiModel
                });

                for (const row of grades) {
                  try {
                    const studentCode = String(row?.student_code || '').trim();
                    if (!studentCode) continue;
                    const grade = typeof row.grade === 'number' ? row.grade : Number(row.grade);
                    if (!Number.isFinite(grade)) continue;
                    const reviewComment =
                      typeof row.review_comment === 'string' ? row.review_comment.trim() : '';

                    const student = await models.Student.findOne({ student_code: studentCode })
                      .select('_id student_code')
                      .lean();
                    if (!student?._id) continue;

                    await models.TeamMember.findOneAndUpdate(
                      { team_id: teamId, student_id: student._id, is_active: true },
                      {
                        $set: {
                          ai_grade: grade,
                          ai_review_comment: reviewComment,
                          ai_graded_at: new Date()
                        }
                      }
                    );
                  } catch (e) {
                    console.warn('[GitHub Webhook] Persist AI member grade failed:', e?.message || e);
                  }
                }
              }
            } catch (e) {
              console.warn('[GitHub Webhook] AI member grading error:', e?.message || e);
            }

            const rt = io || global._io;
            if (rt) {
              // Cùng format room với join_project / join_class (index.js) — không dùng prefix "class:"
              rt.to(`project:${projectIdStr}`).emit('LEADERBOARD_UPDATED', leaderboardData);
              if (project?.class_id) {
                rt.to(String(project.class_id)).emit('LEADERBOARD_UPDATED', leaderboardData);
              }
            }
          } catch (e) {
            console.warn('[GitHub Webhook] Background job error:', e?.message || e);
          }
        });
      }
    }

    return res.status(200).send('Webhook received');
  } catch (error) {
    console.error('❌ [GitHub Webhook]', error);
    return res.status(200).send('Webhook received');
  }
};
