const JiraController = require('../controllers/JiraController');

module.exports = (app) => {
  // ================= SPRINT ROUTES =================

  /**
   * @swagger
   * /api/teams/{teamId}/sprints:
   *   get:
   *     summary: Lấy danh sách Sprint của team
   *     tags:
   *       - Jira Data
   *     parameters:
   *       - in: path
   *         name: teamId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID của Team
   *     responses:
   *       200:
   *         description: Danh sách Sprints thành công
   */
  app.get('/api/teams/:teamId/sprints', JiraController.getSprintsByTeam);

  /**
   * @swagger
   * /api/sprints/{id}:
   *   get:
   *     summary: Lấy chi tiết 1 Sprint
   *     tags:
   *       - Jira Data
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Chi tiết Sprint
   *
   *   put:
   *     summary: Cập nhật Sprint (Ví dụ chấm điểm)
   *     tags:
   *       - Jira Data
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               lecturer_grade:
   *                 type: number
   *               state:
   *                 type: string
   *     responses:
   *       200:
   *         description: Update thành công
   *
   *   delete:
   *     summary: Xóa Sprint
   *     tags:
   *       - Jira Data
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Đã xóa thành công
   */
  app.get('/api/sprints/:id', JiraController.getSprintById);
  app.put('/api/sprints/:id', JiraController.updateSprint);
  app.delete('/api/sprints/:id', JiraController.deleteSprint);

  // ================= TASK ROUTES =================

  /**
   * @swagger
   * /api/teams/{teamId}/tasks:
   *   get:
   *     summary: Lấy danh sách Task (có filter)
   *     tags:
   *       - Jira Data
   *     parameters:
   *       - in: path
   *         name: teamId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: sprintId
   *         schema:
   *           type: string
   *         description: Lọc theo Sprint ID
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *         description: Lọc theo trạng thái (To Do, Done...)
   *     responses:
   *       200:
   *         description: Danh sách Tasks
   */
  app.get('/api/teams/:teamId/tasks', JiraController.getTasksByTeam);

  /**
   * @swagger
   * /api/tasks:
   *   post:
   *     summary: Tạo Task mới
   *     tags:
   *       - Jira Data
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - team_id
   *               - summary
   *             properties:
   *               team_id:
   *                 type: string
   *               summary:
   *                 type: string
   *               story_point:
   *                 type: number
   *               assignee_account_id:
   *                 type: string
   *     responses:
   *       201:
   *         description: Tạo thành công
   */
  app.post('/api/tasks', JiraController.createTask);

  /**
   * @swagger
   * /api/tasks/{id}:
   *   get:
   *     summary: Lấy chi tiết Task
   *     tags:
   *       - Jira Data
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Chi tiết Task
   *
   *   put:
   *     summary: Cập nhật Task
   *     tags:
   *       - Jira Data
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               summary:
   *                 type: string
   *               story_point:
   *                 type: number
   *               assignee_account_id:
   *                 type: string
   *     responses:
   *       200:
   *         description: Update thành công
   *
   *   delete:
   *     summary: Xóa Task
   *     tags:
   *       - Jira Data
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Đã xóa thành công
   */
  app.get('/api/tasks/:id', JiraController.getTaskById);
  app.put('/api/tasks/:id', JiraController.updateTask);
  app.delete('/api/tasks/:id', JiraController.deleteTask);
};
