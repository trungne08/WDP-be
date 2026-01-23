const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const RefreshTokenSchema = new Schema({
    user_id: { type: Schema.Types.ObjectId, required: true, index: true },
    role: { 
        type: String, 
        enum: ['ADMIN', 'LECTURER', 'STUDENT'],
        required: true 
    },
    token: { type: String, required: true, unique: true },
    expires_at: { type: Date, required: true },
    created_at: { type: Date, default: Date.now },
    revoked: { type: Boolean, default: false }
});

// Index để tìm token nhanh
// Lưu ý: token đã có unique: true nên không cần index() thêm
RefreshTokenSchema.index({ user_id: 1, role: 1 });

// Tự động xóa token đã hết hạn
RefreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);
