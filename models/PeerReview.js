const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PeerReviewSchema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    
    // Người đi đánh giá
    evaluator_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true }, 
    
    // Người được đánh giá
    evaluated_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true }, 
    
    rating: {
        type: Number,
        required: true,
        min: 0.5,
        max: 5.0
    },
    comment: {
        type: String,
        required: function() {
            return this.rating < 2.0; // Dưới 2 sao bắt buộc có lý do
        }
    },
    submitted_at: { type: Date, default: Date.now }
});

// Đảm bảo 1 người chỉ đánh giá 1 người khác 1 lần duy nhất trong toàn bộ dự án (team)
PeerReviewSchema.index({ team_id: 1, evaluator_id: 1, evaluated_id: 1 }, { unique: true });

module.exports = mongoose.model('PeerReview', PeerReviewSchema);