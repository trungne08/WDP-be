const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 1. Team (Nhóm dự án)
const TeamSchema = new Schema({
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    project_name: String,
    
    // Cấu hình Jira (flat fields theo schema)
    jira_project_key: String, // e.g. SWP
    jira_board_id: Number,     // REQUIRED for Agile API
    jira_url: String,
    api_token_jira: String,   // Encrypted
    
    // Cấu hình GitHub (flat fields theo schema)
    github_repo_url: String,
    api_token_github: String, // Encrypted
    
    last_sync_at: Date
});

module.exports = mongoose.model('Team', TeamSchema);