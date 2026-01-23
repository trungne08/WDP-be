// Import các router
const authRoutes = require('./routes/authRoutes');
const managementRoutes = require('./routes/managementRoutes');
const integrationRoutes = require('./routes/integrationRoutes');
const projectRoutes = require('./routes/projectRoutes');
const teamRoutes = require('./routes/teamRoutes');
const teamSyncRoutes = require('./routes/teamSyncRoutes');
const teamMemberRoutes = require('./routes/teamMemberRoutes');
const teamDataRoutes = require('./routes/teamDataRoutes');

// Export function để setup routes
module.exports = (app) => {
    // Setup các router
    authRoutes(app);
    managementRoutes(app);
    integrationRoutes(app);
    projectRoutes(app);
    teamRoutes(app);
    teamSyncRoutes(app);
    teamMemberRoutes(app);
    teamDataRoutes(app);
};