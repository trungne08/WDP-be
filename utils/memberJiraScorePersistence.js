const { isJiraTaskDone } = require('./jiraTaskDone');

function memberJiraAccountId(m) {
  const fromMember = (m.jira_account_id || '').toString().trim();
  if (fromMember) return fromMember;
  const fromStudent = (m.student_id?.integrations?.jira?.jiraAccountId || '').toString().trim();
  return fromStudent || null;
}

/**
 * Cập nhật TeamMember.jira_score: tỷ lệ personal done SP / total team done SP (0..1), không nhân hệ số, không làm tròn.
 * Chỉ tính issue đã Done; total = 0 => 0.
 */
async function persistTeamMemberJiraScores(models, teamId) {
  const { TeamMember, JiraTask } = models;
  if (!TeamMember || !JiraTask || teamId == null) return;

  const members = await TeamMember.find({ team_id: teamId, is_active: true })
    .populate('student_id', 'integrations')
    .lean();

  if (!members.length) return;

  const tasks = await JiraTask.find({ team_id: teamId })
    .select('assignee_account_id story_point status_category status_name')
    .lean();

  let totalTeamStoryPoints = 0;
  const personalByAssignee = new Map();
  for (const t of tasks) {
    if (!isJiraTaskDone(t)) continue;
    const sp = Number(t.story_point) || 0;
    totalTeamStoryPoints += sp;
    const aid = (t.assignee_account_id || '').toString().trim();
    if (!aid) continue;
    personalByAssignee.set(aid, (personalByAssignee.get(aid) || 0) + sp);
  }

  const bulk = members.map((m) => {
    const jiraId = memberJiraAccountId(m);
    const personal = jiraId ? personalByAssignee.get(jiraId) || 0 : 0;
    const jiraScore = totalTeamStoryPoints > 0 ? personal / totalTeamStoryPoints : 0;
    return {
      updateOne: {
        filter: { _id: m._id },
        update: { $set: { jira_score: jiraScore } }
      }
    };
  });

  await TeamMember.bulkWrite(bulk);
}

module.exports = { persistTeamMemberJiraScores, memberJiraAccountId };
