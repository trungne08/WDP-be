const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Sprint Schema (Giữ nguyên)
const SprintSchema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    jira_sprint_id: { type: Number, required: true },
    name: { type: String, required: true },
    state: { type: String, enum: ['active', 'closed', 'future'], default: 'future' },
    start_date: { type: Date },
    end_date: { type: Date },
    goal: { type: String }
});

// Task Schema (Cập nhật thêm fields)
const JiraTaskSchema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team' },
    sprint_id: { type: Schema.Types.ObjectId, ref: 'Sprint', default: null },
    issue_id: { type: String, required: true, unique: true },
    issue_key: { type: String, required: true },
    summary: { type: String },
    description: { type: String, default: '' }, 
    status_name: { type: String },
    status_category: { type: String },
    story_point: { type: Number, default: 0 },
    // accountId trên Jira (đảm bảo không dùng các field cũ như key/name)
    assignee_account_id: { type: String },
    assignee_avatar: { type: String },
    assignee_name: { type: String },
    // Mapping sang TeamMember trong hệ thống (để populate thông tin user nội bộ)
    assignee_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
    reporter_account_id: { type: String },
    reporter_name: { type: String },
    reporter_avatar: { type: String },
    start_date: { type: Date, default: null }, 
    due_date: { type: Date, default: null },
    updated_at: { type: Date, default: Date.now }
});

module.exports = {
    Sprint: mongoose.model('Sprint', SprintSchema),
    JiraTask: mongoose.model('JiraTask', JiraTaskSchema)
};