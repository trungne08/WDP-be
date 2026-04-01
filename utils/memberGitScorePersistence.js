const { pickMemberForCommit } = require('./commitUtils');

/**
 * Cập nhật TeamMember.git_score (thang 10) theo tỷ lệ commit is_counted cá nhân / team.
 * Gọi sau getTeamCommits / webhook khi dữ liệu commit thay đổi.
 */
async function persistTeamMemberGitScores(models, teamId) {
  const { TeamMember, GithubCommit } = models;
  if (!TeamMember || !GithubCommit || teamId == null) return;

  const members = await TeamMember.find({ team_id: teamId, is_active: true })
    .populate('student_id', 'email full_name integrations git_emails student_code avatar_url')
    .lean();

  if (!members.length) return;

  const commits = await GithubCommit.find({ team_id: teamId, is_counted: true })
    .select('author_email author_name author_github_id')
    .lean();

  const total = commits.length;
  const counts = new Map();
  for (const m of members) {
    counts.set(String(m._id), 0);
  }
  for (const c of commits) {
    const winner = pickMemberForCommit(c, members);
    if (winner) {
      const k = String(winner._id);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }

  const bulk = members.map((m) => {
    const personal = counts.get(String(m._id)) || 0;
    const gitScore = total > 0 ? (personal / total) * 10 : 0;
    return {
      updateOne: {
        filter: { _id: m._id },
        update: { $set: { git_score: Number(gitScore.toFixed(4)) } }
      }
    };
  });

  await TeamMember.bulkWrite(bulk);
}

module.exports = { persistTeamMemberGitScores };
