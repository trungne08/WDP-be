const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Remove the model from Mongoose models cache if it already exists
if (mongoose.models.PeerReview) {
    delete mongoose.models.PeerReview;
}

const PeerReviewSchema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    evaluator_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true }, 
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
            return this.rating < 2.0; 
        }
    },
    submitted_at: { type: Date, default: Date.now }
});

PeerReviewSchema.index({ team_id: 1, evaluator_id: 1, evaluated_id: 1 }, { unique: true });

// Always compile and export the new model
module.exports = mongoose.model('PeerReview', PeerReviewSchema);