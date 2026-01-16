const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const LecturerSchema = new Schema({
    email: { type: String, required: true, unique: true },
    full_name: String,
    avatar_url: String,
    // Thêm role cố định
    role: { type: String, default: 'LECTURER', immutable: true },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Lecturer', LecturerSchema);