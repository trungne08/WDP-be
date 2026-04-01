/**
 * Issue Jira được coi là hoàn thành (Done) — đồng bộ với TeamApiController + Webhook (status category / tên).
 */
function isJiraTaskDone(task) {
  const cat = (task?.status_category || '').toLowerCase().trim();
  const name = (task?.status_name || '').toLowerCase().trim();
  if (cat === 'done' || cat === 'completed' || cat === 'hoàn thành') return true;
  if (name === 'done' || name === 'hoàn thành') return true;
  return /done|closed|complete|resolved|hoàn thành|đã xong|đóng/i.test(name || '');
}

module.exports = { isJiraTaskDone };
