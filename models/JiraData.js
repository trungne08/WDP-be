const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 1. Sprint
const SprintSchema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    jira_sprint_id: Number, // ID gốc bên Jira
    name: String,
    state: String, // active, closed
    start_date: Date,
    end_date: Date,
    
    // QUỸ ĐIỂM (Giảng viên nhập)
    lecturer_grade: { type: Number, default: null } // Ví dụ: 8.0
});

// 2. Jira Task
const JiraTaskSchema = new Schema({
    sprint_id: { type: Schema.Types.ObjectId, ref: 'Sprint', required: true },
    // Optional: chỉ có sau khi mapping được TeamMember <-> Jira account
    assignee_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
    
    issue_key: String, // SWP-123
    issue_id: String,
    summary: String,
    
    // Cache assignee info từ Jira để phục vụ mapping + hiển thị
    assignee_account_id: { type: String, default: null },
    assignee_name: { type: String, default: 'Unassigned' },
    
    status_name: String,     // In Review
    status_category: String, // Done (Dùng cái này tính điểm)
    
    story_point: { type: Number, default: 0 },
    
    created_at: Date,
    updated_at: Date
});

module.exports = {
    Sprint: mongoose.model('Sprint', SprintSchema),
    JiraTask: mongoose.model('JiraTask', JiraTaskSchema)
};