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
 * Kiểm tra commit có thuộc về member - không phân biệt hoa/thường
 * @param {Object} commit - { author_email, author_name }
 * @param {string[]} emails - Danh sách email
 * @param {string[]} githubUsernames - GitHub username (TeamMember.github_username, integrations.github.username)
 * @param {string[]} [displayNames] - Họ tên hiển thị (Student.full_name) — Git thường lưu display name trong author.name, không phải username
 */
function commitBelongsToAuthor(commit, emails = [], githubUsernames = [], displayNames = []) {
  const authorEmail = (commit.author_email || '').toLowerCase().trim();
  const authorName = (commit.author_name || '').toLowerCase().trim();
  const emailSet = new Set(emails.map(e => (e || '').toLowerCase().trim()).filter(Boolean));
  const usernameSet = new Set(githubUsernames.map(u => (u || '').toLowerCase().trim()).filter(Boolean));
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
 * Email / github_username / full_name cho một TeamMember (đồng bộ với webhook & getTeamCommits).
 */
function getMemberCommitIdentifiers(m) {
  const email = m.student_id?.email?.toLowerCase()?.trim() || '';
  const githubUsernames = [m.github_username, m.student_id?.integrations?.github?.username].filter(
    (x) => x && String(x).trim()
  );
  const displayNames = [m.student_id?.full_name].filter((x) => x && String(x).trim());
  return {
    emails: email ? [email] : [],
    githubUsernames,
    displayNames
  };
}

/**
 * Điểm khớp càng cao càng ưu tiên (tránh 1 commit bị gán nhầm cho Leader khi nhiều member cùng khớp weak rule).
 */
function scoreCommitMemberMatch(commit, m) {
  const ids = getMemberCommitIdentifiers(m);
  const commitLike = { author_email: commit.author_email, author_name: commit.author_name };
  if (!commitBelongsToAuthor(commitLike, ids.emails, ids.githubUsernames, ids.displayNames)) {
    return -1;
  }

  const authorEmail = (commit.author_email || '').toLowerCase().trim();
  const authorName = (commit.author_name || '').toLowerCase().trim();
  let score = 0;

  const em = (m.student_id?.email || '').toLowerCase().trim();
  if (em && authorEmail === em) {
    score = Math.max(score, 100);
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
 * Gán mỗi commit đúng một member (hoặc null nếu không ai khớp đủ mạnh).
 */
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
  pickMemberForCommit
};
