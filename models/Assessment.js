const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 1. Peer Review (Đánh giá chéo)
const PeerReviewSchema = new Schema({
    sprint_id: { type: Schema.Types.ObjectId, ref: 'Sprint', required: true },
    reviewer_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    reviewee_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    
    score_attitude: { type: Number, min: 0.5, max: 5.0 }, // Range 0.5 - 5.0
    comment: String,
    created_at: { type: Date, default: Date.now }
});

// 2. Sprint Assessment (Bảng chốt điểm)
const AssessmentSchema = new Schema({
    sprint_id: { type: Schema.Types.ObjectId, ref: 'Sprint', required: true },
    member_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    
    // Chỉ số hệ 10 (flat fields theo schema)
    jira_score_10: { type: Number, default: 0 },
    git_score_10:  { type: Number, default: 0 },
    review_score_10: { type: Number, default: 0 },
    
    // Tính toán
    composite_score: Number,       // Weighted Sum
    contribution_percentage: Number, // % Share
    final_score: Number,           // Fund * %
    
    created_at: { type: Date, default: Date.now }
});

module.exports = {
    PeerReview: mongoose.model('PeerReview', PeerReviewSchema),
    SprintAssessment: mongoose.model('SprintAssessment', AssessmentSchema)
};