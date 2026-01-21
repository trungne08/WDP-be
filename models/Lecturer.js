const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const LecturerSchema = new Schema({
    email: { type: String, required: true, unique: true },
    full_name: String,
    avatar_url: String,
    password: { type: String, required: true },
    // Thêm role cố định
    role: { type: String, default: 'LECTURER', immutable: true },
    is_verified: { type: Boolean, default: false }, // Email đã được xác minh chưa
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Lecturer', LecturerSchema);