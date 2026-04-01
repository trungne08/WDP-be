/**
 * Bóc tách username từ email noreply GitHub (VD: 123+Zedhuynh0210@users.noreply.github.com → Zedhuynh0210)
 */
function extractUsernameFromNoreplyEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const lower = (email || '').toLowerCase();
  if (!lower.includes('@users.noreply') && !lower.includes('users.noreply.github.com')) return null;
  const plusMatch = email.match(/\+([^@]+)@/);
  if (plusMatch) return plusMatch[1];
  const atMatch = email.match(/^([^@]+)@/);
  return atMatch ? atMatch[1] : null;
}

/**
 * Kiểm tra commit có thuộc về member
 * @param {Object} commit - { author_email, author_name, author_github_id? }
 * @param {string[]} emails - gồm student.email + student.git_emails (đã lowercase)
 * @param {string[]} githubUsernames
 * @param {string[]} displayNames
 * @param {string|null} [memberGithubId] - integrations.github.githubId
 */
function commitBelongsToAuthor(
  commit,
  emails = [],
  githubUsernames = [],
  displayNames = [],
  memberGithubId = null
) {
  const commitGhid = commit.author_github_id != null ? String(commit.author_github_id).trim() : '';
  const memGhid = memberGithubId != null ? String(memberGithubId).trim() : '';
  if (commitGhid && memGhid && commitGhid === memGhid) return true;

  const authorEmail = (commit.author_email || '').toLowerCase().trim();
  const authorName = (commit.author_name || '').toLowerCase().trim();
  const emailSet = new Set(emails.map((e) => (e || '').toLowerCase().trim()).filter(Boolean));
  const usernameSet = new Set(githubUsernames.map((u) => (u || '').toLowerCase().trim()).filter(Boolean));
  const nameSet = new Set(displayNames.map((n) => (n || '').toLowerCase().trim()).filter(Boolean));
  if (authorEmail && emailSet.has(authorEmail)) return true;
  const extractedFromNoreply = extractUsernameFromNoreplyEmail(commit.author_email || '');
  if (extractedFromNoreply && usernameSet.has(extractedFromNoreply.toLowerCase())) return true;
  for (const dn of nameSet) {
    if (dn && authorName === dn) return true;
  }
  for (const u of usernameSet) {
    if (!u) continue;
    if (authorEmail.includes(u) && authorEmail.includes('users.noreply')) return true;
    if (authorName === u || authorName.includes(u)) return true;
  }
  return false;
}

/**
 * Định danh commit ↔ TeamMember: email đăng ký + git_emails OAuth, username, GitHub id, họ tên.
 */
function getMemberCommitIdentifiers(m) {
  const primary = (m.student_id?.email || '').toLowerCase().trim() || '';
  const extra = Array.isArray(m.student_id?.git_emails) ? m.student_id.git_emails : [];
  const emailSet = new Set();
  if (primary) emailSet.add(primary);
  for (const e of extra) {
    const x = String(e || '').toLowerCase().trim();
    if (x) emailSet.add(x);
  }
  const emails = [...emailSet];
  const githubUsernames = [m.github_username, m.student_id?.integrations?.github?.username].filter(
    (x) => x && String(x).trim()
  );
  const displayNames = [m.student_id?.full_name].filter((x) => x && String(x).trim());
  const githubId =
    m.student_id?.integrations?.github?.githubId != null
      ? String(m.student_id.integrations.github.githubId).trim()
      : null;
  return { emails, githubUsernames, displayNames, githubId, primaryEmail: primary };
}

function scoreCommitMemberMatch(commit, m) {
  const ids = getMemberCommitIdentifiers(m);
  const commitLike = {
    author_email: commit.author_email,
    author_name: commit.author_name,
    author_github_id: commit.author_github_id
  };
  if (!commitBelongsToAuthor(commitLike, ids.emails, ids.githubUsernames, ids.displayNames, ids.githubId)) {
    return -1;
  }

  const authorEmail = (commit.author_email || '').toLowerCase().trim();
  const authorName = (commit.author_name || '').toLowerCase().trim();
  let score = 0;

  const commitGhid = commit.author_github_id != null ? String(commit.author_github_id).trim() : '';
  const memGhid = ids.githubId || '';
  if (commitGhid && memGhid && commitGhid === memGhid) {
    score = 110;
  }

  if (authorEmail && ids.emails.includes(authorEmail)) {
    const isPrimary = ids.primaryEmail && authorEmail === ids.primaryEmail;
    score = Math.max(score, isPrimary ? 100 : 98);
  }

  const extracted = extractUsernameFromNoreplyEmail(commit.author_email || '');
  const usernames = ids.githubUsernames.map((u) => String(u).toLowerCase());
  if (extracted && usernames.includes(extracted.toLowerCase())) {
    score = Math.max(score, 90);
  }

  const fn = (m.student_id?.full_name || '').toLowerCase().trim();
  if (fn && authorName === fn) {
    score = Math.max(score, 75);
  }

  for (const u of usernames) {
    if (u && authorName === u) {
      score = Math.max(score, 70);
    }
  }

  for (const u of usernames) {
    if (u && authorEmail.includes(u) && authorEmail.includes('users.noreply')) {
      score = Math.max(score, 88);
    }
  }

  for (const u of usernames) {
    if (u && authorName.includes(u) && authorName !== u) {
      score = Math.max(score, 30);
    }
  }

  return score > 0 ? score : 5;
}

/**
 * Hiển thị GitHub username: ưu tiên TeamMember.github_username, fallback OAuth trên Student.
 */
function resolveGithubUsernameForMember(memberDoc) {
  if (!memberDoc) return null;
  const a = memberDoc.github_username;
  if (a != null && String(a).trim()) return String(a).trim();
  const b = memberDoc.student_id?.integrations?.github?.username;
  if (b != null && String(b).trim()) return String(b).trim();
  return null;
}

function pickMemberForCommit(commit, members) {
  let best = null;
  let bestScore = -1;
  for (const m of members) {
    const s = scoreCommitMemberMatch(commit, m);
    if (s > bestScore) {
      bestScore = s;
      best = m;
    } else if (s === bestScore && s >= 0 && best && m) {
      if (String(m._id) < String(best._id)) {
        best = m;
      }
    }
  }
  return bestScore >= 0 ? best : null;
}

module.exports = {
  extractUsernameFromNoreplyEmail,
  commitBelongsToAuthor,
  getMemberCommitIdentifiers,
  pickMemberForCommit,
  resolveGithubUsernameForMember
};
