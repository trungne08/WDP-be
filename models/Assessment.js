const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ==========================================
// 1. BẢNG PEER REVIEW (Đánh giá chéo)
// ==========================================
const PeerReviewSchema = new Schema({
    // Đã thay sprint_id bằng team_id vì chỉ tính điểm 1 lần cho toàn dự án
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    
    // Khớp tên biến với Webhook/Controller của bạn
    evaluator_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    evaluated_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    
    // Khớp tên biến lưu điểm rating (0.5 - 5.0)
    rating: { type: Number, min: 0.5, max: 5.0, required: true }, 
    comment: String,
    
    created_at: { type: Date, default: Date.now }
});

// ==========================================
// 2. BẢNG ASSESSMENT (Chốt điểm cuối kỳ)
// ==========================================
const AssessmentSchema = new Schema({
    // Đã thay sprint_id bằng team_id
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    member_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    
    // Điểm nhóm do Giảng viên nhập (hệ 10)
    group_grade: { type: Number, required: true, default: 0 },
    
    // Tận dụng lưu các chỉ số gốc để FE dễ vẽ Bảng báo cáo
    jira_percentage: { type: Number, default: 0 },   // Sẽ lưu tổng Story points làm được
    git_percentage: { type: Number, default: 0 },    // Sẽ lưu điểm AI Score
    review_percentage: { type: Number, default: 0 }, // Sẽ lưu số sao Review trung bình
    
    // Kết quả tính toán
    contribution_factor: { type: Number, default: 0 }, // Hệ số (Kỹ thuật x Thái độ)
    final_score: { type: Number, default: 0 },         // Điểm cá nhân cuối cùng
    
    is_locked: { type: Boolean, default: false }, // Đánh dấu điểm đã chốt/khóa
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Export cả 2 model (Vẫn giữ nguyên tên SprintAssessment để không phải sửa import ở các file khác)
module.exports = {
    PeerReview: mongoose.model('PeerReview', PeerReviewSchema),
    SprintAssessment: mongoose.model('SprintAssessment', AssessmentSchema)
};