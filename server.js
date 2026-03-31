// Import các router
const authRoutes = require('./routes/authRoutes');
const managementRoutes = require('./routes/managementRoutes');
const integrationRoutes = require('./routes/integrationRoutes');
const projectRoutes = require('./routes/projectRoutes');
const teamRoutes = require('./routes/teamRoutes');
const teamSyncRoutes = require('./routes/teamSyncRoutes');
const teamMemberRoutes = require('./routes/teamMemberRoutes');
const teamDataRoutes = require('./routes/teamDataRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const aiRoutes = require('./routes/aiRoutes');
const pingRoutes = require('./routes/pingRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

// Export function để setup routes
module.exports = (app) => {
    // Setup các router
    pingRoutes(app);
    authRoutes(app);
    managementRoutes(app);
    integrationRoutes(app);
    projectRoutes(app);
    teamRoutes(app);
    teamSyncRoutes(app);
    teamMemberRoutes(app);
    teamDataRoutes(app);
    app.use(reviewRoutes);
    aiRoutes(app);
    require('./routes/notificationRoutes')(app); // <--- Đã thêm route thông báo
    require('./routes/academicRoutes')(app); // <--- Đã thêm route học thuật (Schedule, Assignment, Lab)
    require('./routes/webhookRoutes')(app); // <--- Webhook cho Jira real-time sync
    require('./routes/jiraRoutes')(app);
    app.use(dashboardRoutes);
};