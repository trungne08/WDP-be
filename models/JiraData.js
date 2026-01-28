const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 1. Sprint
const SprintSchema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    jira_sprint_id: Number,
    name: String,
    state: String,
    start_date: Date,
    end_date: Date
});

// 2. Jira Task
const JiraTaskSchema = new Schema({
    sprint_id: { type: Schema.Types.ObjectId, ref: 'Sprint', default: null },
    assignee_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
    issue_key: String,
    issue_id: String,
    summary: String,
    assignee_account_id: { type: String, default: null },
    // Nếu task không có assignee thì lưu null (UI tự hiển thị "Unassigned")
    assignee_name: { type: String, default: null },
    status_name: String,    
    status_category: String, 
    story_point: { type: Number, default: 0 },
    created_at: Date,
    updated_at: Date
});

module.exports = {
    Sprint: mongoose.model('Sprint', SprintSchema),
    JiraTask: mongoose.model('JiraTask', JiraTaskSchema)
};