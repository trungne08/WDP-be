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
   *     responses:
   *       200:
   *         description: Danh sách Sprints
  *       400:
  *         description: teamId không hợp lệ
  *       404:
  *         description: Không tìm thấy team
  *       500:
  *         description: Lỗi server
   */
  app.get('/api/teams/:teamId/sprints', JiraController.getSprintsByTeam);

  /**
   * @swagger
   * /api/sprints:
   *   post:
   *     summary: Tạo Sprint mới
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
   *               - name
   *             properties:
   *               team_id:
   *                 type: string
   *               name:
   *                 type: string
   *               start_date:
   *                 type: string
   *                 format: date-time
   *               end_date:
   *                 type: string
   *                 format: date-time
   *     responses:
   *       201:
   *         description: Tạo thành công
  *       400:
  *         description: Lỗi validation (thiếu team_id/name hoặc dữ liệu không hợp lệ)
  *       404:
  *         description: Không tìm thấy team
  *       500:
  *         description: Lỗi server
   */
  app.post('/api/sprints', JiraController.createSprint);

  /**
   * @swagger
   * /api/sprints/{id}/start:
   *   post:
   *     summary: Bắt đầu Sprint (Active)
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
   *             required:
   *               - start_date
   *               - end_date
   *             properties:
   *               start_date:
   *                 type: string
   *                 format: date-time
   *               end_date:
   *                 type: string
   *                 format: date-time
   *     responses:
   *       200:
   *         description: Sprint đã start thành công
  *       400:
  *         description: Lỗi validation (thiếu start_date/end_date hoặc dữ liệu không hợp lệ)
  *       404:
  *         description: Không tìm thấy sprint
  *       500:
  *         description: Lỗi server
   */
  app.post('/api/sprints/:id/start', JiraController.startSprint);

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
  *       400:
  *         description: id không hợp lệ
  *       404:
  *         description: Không tìm thấy sprint
  *       500:
  *         description: Lỗi server
   *
   *   put:
   *     summary: Cập nhật Sprint (Tên, ngày tháng, trạng thái)
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
   *               name:
   *                 type: string
   *               state:
   *                 type: string
   *               start_date:
   *                 type: string
   *                 format: date-time
   *               end_date:
   *                 type: string
   *                 format: date-time
   *     responses:
   *       200:
   *         description: Update thành công
  *       400:
  *         description: id không hợp lệ hoặc body không hợp lệ
  *       404:
  *         description: Không tìm thấy sprint
  *       500:
  *         description: Lỗi server
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
  *       400:
  *         description: id không hợp lệ
  *       404:
  *         description: Không tìm thấy sprint
  *       500:
  *         description: Lỗi server
   */
  app.get('/api/sprints/:id', JiraController.getSprintById);
  app.put('/api/sprints/:id', JiraController.updateSprint);
  app.delete('/api/sprints/:id', JiraController.deleteSprint);

  // ================= TASK ROUTES =================

  /**
 * @swagger
 * /api/tasks:
 *   post:
 *     summary: Tạo Task mới (Chỉ cần Tên, Description)
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
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tạo thành công
 *       400:
 *         description: Lỗi validation (thiếu team_id/summary hoặc dữ liệu không hợp lệ)
 *       404:
 *         description: Không tìm thấy team hoặc sprint (nếu có)
 *       500:
 *         description: Lỗi server
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
 *       400:
 *         description: id không hợp lệ
 *       404:
 *         description: Không tìm thấy task
 *       500:
 *         description: Lỗi server
 *
 *   put:
 *     summary: Cập nhật Task (Bắt buộc gửi team_id)
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
 *             required:
 *               - team_id
 *             properties:
 *               team_id:
 *                 type: string
 *               summary:
 *                 type: string
 *               story_point:
 *                 type: number
 *               assignee_account_id:
 *                 type: string
 *               sprint_id:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Update thành công
 *       400:
 *         description: id không hợp lệ hoặc body không hợp lệ
 *       404:
 *         description: Không tìm thấy task
 *       500:
 *         description: Lỗi server
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
 *       400:
 *         description: id không hợp lệ
 *       404:
 *         description: Không tìm thấy task
 *       500:
 *         description: Lỗi server
 */
app.get('/api/tasks/:id', JiraController.getTaskById);
app.put('/api/tasks/:id', JiraController.updateTask);
app.delete('/api/tasks/:id', JiraController.deleteTask);
};
