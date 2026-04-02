const { pickMemberForCommit } = require('./commitUtils');

/**
 * Cập nhật TeamMember.git_score: tỷ lệ gốc personal/total (0..1), không nhân hệ số, không làm tròn.
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

  // 🔥 FIX 1: Khởi tạo mẫu số = 0
  let total = 0; 
  const counts = new Map();
  for (const m of members) {
    counts.set(String(m._id), 0);
  }
  
  for (const c of commits) {
    const winner = pickMemberForCommit(c, members);
    if (winner) {
      const k = String(winner._id);
      counts.set(k, (counts.get(k) || 0) + 1);
      
      // 🔥 FIX 2: Chỉ cộng vào mẫu số tổng khi commit ĐÃ TÌM ĐƯỢC CHỦ
      total++;
    }
  }

  const bulk = members.map((m) => {
    const personal = counts.get(String(m._id)) || 0;
    const gitScore = total > 0 ? personal / total : 0;
    return {
      updateOne: {
        filter: { _id: m._id },
        update: { $set: { git_score: gitScore } }
      }
    };
  });

  await TeamMember.bulkWrite(bulk);
}

module.exports = { persistTeamMemberGitScores };