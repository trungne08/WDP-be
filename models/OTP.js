const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const OTPSchema = new Schema({
    email: { type: String, required: true, index: true },
    otp_code: { type: String, required: true, index: true },
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

// Tạo index cho email và otp_code (không tạo cho verification_token)
OTPSchema.index({ email: 1, otp_code: 1 });

module.exports = mongoose.model('OTP', OTPSchema);
