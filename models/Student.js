const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const StudentSchema = new Schema({
    student_code: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    full_name: String,
    avatar_url: String,
    major: String,
    password: { type: String, required: true },
    // Thêm role cố định
    role: { type: String, default: 'STUDENT', immutable: true },
    is_verified: { type: Boolean, default: false }, // Email đã được xác minh chưa
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Student', StudentSchema);