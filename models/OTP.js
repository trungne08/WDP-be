const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const OTPSchema = new Schema({
    email: { type: String, required: true, index: true },
    otp_code: { type: String, required: true, index: true },
    verification_token: { type: String, required: true, unique: true, index: true }, // Token để verify chỉ với OTP
    role: { 
        type: String, 
        enum: ['ADMIN', 'LECTURER', 'STUDENT'],
        required: true 
    },
    type: {
        type: String,
        enum: ['VERIFICATION', 'RESET_PASSWORD'],
        default: 'VERIFICATION'
    },
    expires_at: { type: Date, required: true },
    is_used: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now }
});

// Tự động xóa OTP sau 10 phút (expires_at)
OTPSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OTP', OTPSchema);
