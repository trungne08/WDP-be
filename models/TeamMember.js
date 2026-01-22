const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TeamMemberSchema = new Schema({
    // 1. Liên kết cơ bản (Sửa thành _id để khớp controller)
    team_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Team', 
        required: true 
    },
    student_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Student', 
        required: true 
    },

    // 2. Định danh vai trò (Khớp với logic seed-member)
    // Controller dùng: role_in_team = 'Leader' hoặc 'Member'
    role_in_team: { 
        type: String, 
        enum: ['Leader', 'Member'],
        default: 'Member' 
    },
    
    // 3. Mapping Tài khoản (Khớp với TeamApiController)
    jira_account_id: { 
        type: String, 
        default: null 
    },
    github_username: { 
        type: String, 
        default: null 
    },

    // 4. Trạng thái hoạt động (Khớp với ManagementController)
    is_active: {
        type: Boolean,
        default: true
    },

    // 5. Cache điểm số (Giữ nguyên ý tưởng của bạn, rất tốt cho Dashboard)
    scores: {
        jira_score: { type: Number, default: 0 },
        commit_score: { type: Number, default: 0 },
        review_score: { type: Number, default: 0 },
        total_score: { type: Number, default: 0 }
    }

}, { 
    timestamps: true 
});

// Index chống trùng lặp: 1 SV không thể vào 2 team
// TeamMemberSchema.index({ team_id: 1, student_id: 1 }, { unique: true });

// Check kỹ model name để tránh lỗi OverwriteModelError
module.exports = mongoose.models.TeamMember || mongoose.model('TeamMember', TeamMemberSchema);