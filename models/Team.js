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
    
    // Jira Config (chỉ cần project key và board ID)
    jira_project_key: String, 
    jira_board_id: Number,
    jira_story_point_field: { type: String, default: 'customfield_10016' },
    
    // GitHub Config (chỉ cần repo URL)
    github_repo_url: String,
    
    // ⚠️ DEPRECATED FIELDS - Không dùng nữa, dùng User OAuth thay thế
    // Giữ lại để backward compatibility, sẽ xóa trong version tương lai
    jira_url: { 
        type: String,
        deprecated: true,
        description: '⚠️ DEPRECATED: Dùng user.integrations.jira.jiraUrl thay thế'
    },
    api_token_jira: { 
        type: String,
        deprecated: true,
        description: '⚠️ DEPRECATED: Dùng user.integrations.jira.accessToken (OAuth) thay thế'
    },
    api_token_github: { 
        type: String,
        deprecated: true,
        description: '⚠️ DEPRECATED: Dùng user.integrations.github.accessToken (OAuth) thay thế'
    },
    
    // Sync metadata
    last_sync_at: Date,
    sync_history: { type: [SyncHistorySchema], default: [] },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Team', TeamSchema);