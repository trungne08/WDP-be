const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SyncHistorySchema = new Schema(
    {
        synced_at: { type: Date, default: Date.now },
        stats: { type: Schema.Types.Mixed, default: {} },
        sync_errors: { type: [String], default: [] }
    },
    { _id: false }
);

// 1. Team (Nhóm dự án)
const TeamSchema = new Schema({
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    project_name: String,
    jira_project_key: String, 
    jira_board_id: Number,    
    jira_url: String,
    api_token_jira: String,   
    jira_story_point_field: { type: String, default: 'customfield_10016' },
    github_repo_url: String,
    api_token_github: String,
    last_sync_at: Date,
    sync_history: { type: [SyncHistorySchema], default: [] },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Team', TeamSchema);