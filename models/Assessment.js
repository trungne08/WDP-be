const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 1. Peer Review (Đánh giá chéo) - Giữ nguyên như cũ
const PeerReviewSchema = new Schema({
    sprint_id: { type: Schema.Types.ObjectId, ref: 'Sprint', required: true },
    reviewer_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    reviewee_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    
    score_attitude: { type: Number, min: 0.5, max: 5.0 }, // Range 0.5 - 5.0
    comment: String,
    created_at: { type: Date, default: Date.now }
});

// 2. Sprint Assessment (Bảng chốt điểm) - Đã cập nhật theo công thức mới
const AssessmentSchema = new Schema({
    sprint_id: { type: Schema.Types.ObjectId, ref: 'Sprint', required: true },
    member_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    
    // Điểm nhóm do Giảng viên nhập (hệ 10)
    group_grade: { type: Number, required: true, default: 0 },
    
    // Tỷ lệ phần trăm đóng góp từng phần (%Jira, %Git, %Review)
    jira_percentage: { type: Number, default: 0 },
    git_percentage: { type: Number, default: 0 },
    review_percentage: { type: Number, default: 0 },
    
    // Kết quả tính toán
    contribution_factor: { type: Number, default: 0 }, // Tổng % đóng góp
    final_score: { type: Number, default: 0 },         // Điểm cá nhân cuối cùng
    
    is_locked: { type: Boolean, default: false }, // Đã chốt điểm chưa
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Export cả 2 model
module.exports = {
    PeerReview: mongoose.model('PeerReview', PeerReviewSchema),
    SprintAssessment: mongoose.model('SprintAssessment', AssessmentSchema)
};