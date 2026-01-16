const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const RiskAlertSchema = new Schema({
    member_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    type: { 
        type: String, 
        required: true,
        enum: ['NoCommit', 'OverdueTask', 'LowContribution', 'Other']
    },
    message: { type: String, required: true },
    is_read: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RiskAlert', RiskAlertSchema);
