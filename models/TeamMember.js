const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TeamMemberSchema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    
    // Mapping ID
    jira_account_id: String, // Jira Account ID
    github_username: String,
    
    role_in_team: { 
        type: String, 
        enum: ['Leader', 'Member'], 
        default: 'Member' 
    },
    
    is_active: { type: Boolean, default: true }
});

module.exports = mongoose.model('TeamMember', TeamMemberSchema);