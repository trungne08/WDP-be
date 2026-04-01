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

module.exports = {
  extractUsernameFromNoreplyEmail,
  commitBelongsToAuthor
};
