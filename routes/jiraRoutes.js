const express = require('express');
const JiraController = require('../controllers/JiraController');

module.exports = (app) => {
  const router = express.Router();

  // ==================================================================
  // 1. SPRINT ROUTES
  // ==================================================================

  /**
   * @swagger
   * /api/sprints/{teamId}:
   *   get:
   *     summary: Get Sprints by Team
   *     tags: [Jira Sprints]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: teamId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Sprints retrieved successfully
   *       400:
   *         description: Invalid teamId
   *       404:
   *         description: Team not found
   *       500:
   *         description: Internal server error
   */
  router.get('/sprints/:teamId', JiraController.getSprintsByTeam);

  /**
   * @swagger
   * /api/sprints/detail/{id}:
   *   get:
   *     summary: Get Sprint details
   *     tags: [Jira Sprints]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Sprint details retrieved successfully
   *       404:
   *         description: Sprint not found
   *       500:
   *         description: Internal server error
   */
  router.get('/sprints/detail/:id', JiraController.getSprintById);

  /**
   * @swagger
   * /api/sprints:
   *   post:
   *     summary: Create a new Sprint (Sync with Jira)
   *     tags: [Jira Sprints]
   *     security:
   *       - bearerAuth: []
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
   *         description: Sprint created successfully
   *       400:
   *         description: Missing or invalid request data
   *       404:
   *         description: Team or Jira Board not found
   *       500:
   *         description: Internal server error
   */
  router.post('/sprints', JiraController.createSprint);

  /**
   * @swagger
   * /api/sprints/{id}/start:
   *   post:
   *     summary: Start Sprint
   *     tags: [Jira Sprints]
   *     security:
   *       - bearerAuth: []
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
   *               start_date:
   *                 type: string
   *                 format: date-time
   *               end_date:
   *                 type: string
   *                 format: date-time
   *     responses:
   *       200:
   *         description: Sprint started successfully
   *       400:
   *         description: Invalid date format
   *       404:
   *         description: Sprint not found
   *       500:
   *         description: Internal server error
   */
  router.post('/sprints/:id/start', JiraController.startSprint);

  /**
   * @swagger
   * /api/sprints/{id}:
   *   put:
   *     summary: Update Sprint
   *     tags: [Jira Sprints]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               state:
   *                 type: string
   *                 enum: [active, future, closed]
   *               start_date:
   *                 type: string
   *                 format: date-time
   *               end_date:
   *                 type: string
   *                 format: date-time
   *     responses:
   *       200:
   *         description: Sprint updated successfully
   *       400:
   *         description: Invalid request data
   *       404:
   *         description: Sprint not found
   *       500:
   *         description: Internal server error
   */
  router.put('/sprints/:id', JiraController.updateSprint);

  /**
   * @swagger
   * /api/sprints/{id}:
   *   delete:
   *     summary: Delete Sprint
   *     tags: [Jira Sprints]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Sprint deleted successfully
   *       404:
   *         description: Sprint not found
   *       500:
   *         description: Internal server error
   */
  router.delete('/sprints/:id', JiraController.deleteSprint);

  // ==================================================================
  // 2. TASK ROUTES
  // ==================================================================

  /**
   * @swagger
   * /api/tasks:
   *   get:
   *     summary: Get Tasks (Filter)
   *     tags: [Jira Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: team_id
   *         schema:
   *           type: string
   *         description: Filter by Team ID
   *       - in: query
   *         name: sprint_id
   *         schema:
   *           type: string
   *         description: Filter by Sprint ID
   *     responses:
   *       200:
   *         description: Tasks retrieved successfully
   *       500:
   *         description: Internal server error
   */
  router.get('/tasks', JiraController.getTasks);

  /**
   * @swagger
   * /api/tasks/{id}:
   *   get:
   *     summary: Get Task details
   *     tags: [Jira Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Task retrieved successfully
   *       404:
   *         description: Task not found
   *       500:
   *         description: Internal server error
   */
  router.get('/tasks/:id', JiraController.getTaskById);

  /**
   * @swagger
   * /api/tasks:
   *   post:
   *     summary: Create a new Task
   *     tags: [Jira Tasks]
   *     security:
   *       - bearerAuth: []
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
   *               assignee_account_id:
   *                 type: string
   *               story_point:
   *                 type: number
   *               start_date:
   *                 type: string
   *                 format: date
   *               due_date:
   *                 type: string
   *                 format: date
   *               sprint_id:
   *                 type: string
   *     responses:
   *       201:
   *         description: Task created successfully
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Team not found
   *       500:
   *         description: Internal server error
   */
  router.post('/tasks', JiraController.createTask);

  /**
   * @swagger
   * /api/tasks/{id}:
   *   put:
   *     summary: Update Task
   *     tags: [Jira Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               team_id:
   *                 type: string
   *               summary:
   *                 type: string
   *               description:
   *                 type: string
   *               status:
   *                 type: string
   *               sprint_id:
   *                 type: string
   *               story_point:
   *                 type: number
   *               assignee_account_id:
   *                 type: string
   *               reporter_account_id:
   *                 type: string
   *               start_date:
   *                 type: string
   *                 format: date
   *               due_date:
   *                 type: string
   *                 format: date
   *     responses:
   *       200:
   *         description: Task updated successfully
   *       400:
   *         description: Invalid request data
   *       404:
   *         description: Task not found
   *       500:
   *         description: Internal server error
   */
  router.put('/tasks/:id', JiraController.updateTask);

  /**
   * @swagger
   * /api/tasks/{id}:
   *   delete:
   *     summary: Delete Task
   *     tags: [Jira Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Task deleted successfully
   *       404:
   *         description: Task not found
   *       500:
   *         description: Internal server error
   */
  router.delete('/tasks/:id', JiraController.deleteTask);

  // ==================================================================
  // REGISTER ROUTER
  // ==================================================================
  app.use('/api', router);
};
