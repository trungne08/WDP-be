const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SyncHistorySchema = new Schema(
    {
        synced_at: { type: Date, default: Date.now },
        stats: { type: Schema.Types.Mixed, default: {} },
        errors: { type: [String], default: [] }
    },
    { _id: false }
);

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
    
    last_sync_at: Date,
    sync_history: { type: [SyncHistorySchema], default: [] }
});

module.exports = mongoose.model('Team', TeamSchema);