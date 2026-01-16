const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TeamMemberSchema = new Schema({
    team: { type: Schema.Types.ObjectId, ref: 'Team' },
    student: { type: Schema.Types.ObjectId, ref: 'Student' },
    
    // Mapping ID
    jira_account_id: String,
    github_username: String,
    
    // SỬA: Enum viết in hoa
    role: { 
        type: String, 
        enum: ['LEADER', 'MEMBER'], 
        default: 'MEMBER' 
    },
    
    is_active: { type: Boolean, default: true }
});

module.exports = mongoose.model('TeamMember', TeamMemberSchema);