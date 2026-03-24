const models = require('../models');
const { Sprint, JiraTask } = require('../models/JiraData');
const { extractStoryPoint } = require('../services/JiraSyncService');
const GithubService = require('../services/GithubService');
const { commitBelongsToAuthor } = require('../utils/commitUtils');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * POST /api/webhooks/jira
 * Nhận Jira dynamic webhook (không dùng authenticateToken).
 * Payload: webhookEvent, issue (fields.summary, status, assignee, customfield_10016 / story points qua extractStoryPoint).
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

    const projectKey = project.key;
    const dbProject = await models.Project.findOne({
      jiraProjectKey: projectKey
    }).lean();

    if (!dbProject) {
      console.log(`⚠️ [Jira Webhook] Không tìm thấy Project với key: ${projectKey}`);
      return res.status(200).send('Jira Webhook received');
    }

    const teamMember = await models.TeamMember.findOne({
      project_id: dbProject._id,
      is_active: true
    }).lean();

    if (!teamMember) {
      console.log(`⚠️ [Jira Webhook] Không tìm thấy Team cho project: ${dbProject._id}`);
      return res.status(200).send('Jira Webhook received');
    }

    const teamId = teamMember.team_id;

    const emitKanbanUpdate = () => {
      const io = req.app.get('io');
      if (io) {
        io.emit('JIRA_ISSUE_UPDATED', {
          message: 'Bảng Kanban Jira vừa có cập nhật!',
          issueKey,
          status
        });
      }
    };

    if (eventType === 'jira:issue_deleted') {
      await JiraTask.deleteOne({ issue_id: issueId });
      console.log(`✅ [Jira Webhook] Đã xóa task: ${issueKey}`);
      emitKanbanUpdate();
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

      await JiraTask.findOneAndUpdate(
        { issue_id: issueId },
        {
          team_id: teamId,
          sprint_id: sprintId,
          assignee_id: assigneeMemberId,
          issue_key: issueKey,
          issue_id: issueId,
          summary,
          status_name: status,
          status_category: issue.fields?.status?.statusCategory?.key || '',
          assignee_account_id: assigneeAccountId || null,
          assignee_name: issue.fields?.assignee?.displayName || null,
          story_point: storyPoints,
          created_at: issue.fields?.created ? new Date(issue.fields.created) : undefined,
          updated_at: issue.fields?.updated ? new Date(issue.fields.updated) : new Date()
        },
        { upsert: true, new: true }
      );

      console.log(`✅ [Jira Webhook] Đã cập nhật task: ${issueKey}`);
      emitKanbanUpdate();
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
      .populate('student_id', 'email')
      .lean();

    if (!teamMembers.length) {
      return res.status(200).send('Webhook received');
    }

    const teamId = teamMembers[0].team_id;
    const GithubCommit = models.GithubCommit;
    const jiraRegex = /[A-Z][A-Z0-9]+-\d+/g;
    const branch = (payload.ref || '').replace(/^refs\/heads\//, '') || null;

    let commitsSaved = 0;

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

      const updateDoc = {
        $set: {
          team_id: teamId,
          author_email: commit.author_email,
          author_name: commit.author_name,
          message: commit.message,
          commit_date: commit.commit_date,
          url: commit.url,
          branch,
          is_counted: checkResult.is_counted,
          rejection_reason: checkResult.reason
        }
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
    }

    const io = req.app.get('io');
    if (io && commitsSaved > 0) {
      io.emit('GITHUB_NEW_COMMITS', {
        message: 'Có code mới vừa được push lên GitHub!',
        commitsCount: commitsSaved,
        projectName: project.name || ''
      });
    }

    return res.status(200).send('Webhook received');
  } catch (error) {
    console.error('❌ [GitHub Webhook]', error);
    return res.status(200).send('Webhook received');
  }
};
