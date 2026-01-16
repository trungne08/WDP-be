const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 1. Peer Review (Đánh giá chéo)
const PeerReviewSchema = new Schema({
    sprint: { type: Schema.Types.ObjectId, ref: 'Sprint' },
    reviewer: { type: Schema.Types.ObjectId, ref: 'TeamMember' },
    reviewee: { type: Schema.Types.ObjectId, ref: 'TeamMember' },
    
    score_attitude: { type: Number, min: 0.5, max: 5.0 }, // 3.5, 4.5 sao
    comment: String,
    created_at: { type: Date, default: Date.now }
});

// 2. Sprint Assessment (Bảng chốt điểm)
const AssessmentSchema = new Schema({
    sprint: { type: Schema.Types.ObjectId, ref: 'Sprint' },
    member: { type: Schema.Types.ObjectId, ref: 'TeamMember' },
    
    // Các chỉ số đã chuẩn hóa về hệ 10
    scores: {
        jira_10: { type: Number, default: 0 },
        git_10:  { type: Number, default: 0 },
        review_10: { type: Number, default: 0 }
    },
    
    // Điểm tổng hợp & Kết quả
    composite_score: Number,       // Điểm năng lực
    contribution_percentage: Number, // % Đóng góp (0.25 = 25%)
    final_score: Number,           // Điểm chốt (8.5)
    
    created_at: { type: Date, default: Date.now }
});

module.exports = {
    PeerReview: mongoose.model('PeerReview', PeerReviewSchema),
    SprintAssessment: mongoose.model('SprintAssessment', AssessmentSchema)
};