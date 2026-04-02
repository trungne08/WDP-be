const AiController = require('../controllers/AiController');
const { authenticateToken } = require('../middleware/auth');

module.exports = (app) => {
  // Đã gộp review commit vào POST /api/ai/project-chat (tool review_github_commit + Gemini)
  // app.post('/api/ai/review-commit', authenticateToken, AiController.reviewCommit);
  app.post('/api/ai/project-chat', authenticateToken, AiController.projectChat);
  app.get(
    '/api/ai/project/:projectId/export-srs',
    authenticateToken,
    AiController.exportSrs
  );
  app.get(
    '/api/ai/teams/:id/export-srs',
    authenticateToken,
    AiController.exportSrs
  );
};
