const AiController = require('../controllers/AiController');
const { authenticateToken } = require('../middleware/auth');

module.exports = (app) => {
  app.post('/api/ai/review-commit', authenticateToken, AiController.reviewCommit);
};
