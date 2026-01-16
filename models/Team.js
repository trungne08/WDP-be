const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 1. Team (Nhóm dự án)
const TeamSchema = new Schema({
    class: { type: Schema.Types.ObjectId, ref: 'Class' },
    project_name: String,
    
    // Cấu hình Jira
    jira_config: {
        project_key: String, // SWP
        board_id: Number,    // Quan trọng để lấy Sprint
        url: String,
        api_token: String    // Encrypted
    },
    
    // Cấu hình GitHub
    github_config: {
        repo_url: String,
        api_token: String    // Encrypted
    },
    
    last_sync_at: Date
});

// 2. Team Member (Bảng Mapping quan trọng nhất)
const TeamMemberSchema = new Schema({
    team: { type: Schema.Types.ObjectId, ref: 'Team' },
    student: { type: Schema.Types.ObjectId, ref: 'Student' },
    
    // Mapping ID
    jira_account_id: String, // ID dài loằng ngoằng của Jira
    github_username: String,
    
    role: { type: String, enum: ['Leader', 'Member'], default: 'Member' },
    is_active: { type: Boolean, default: true }
});

module.exports = {
    Team: mongoose.model('Team', TeamSchema),
    TeamMember: mongoose.model('TeamMember', TeamMemberSchema)
};