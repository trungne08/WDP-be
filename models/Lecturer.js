const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const LecturerSchema = new Schema({
    email: { type: String, required: true, unique: true },
    full_name: String,
    avatar_url: String,
    // ==================================================
    // TÍCH HỢP TÀI KHOẢN (Account Integration)
    // ==================================================
    integrations: {
        github: {
            githubId: { type: String },
            username: { type: String },
            accessToken: { type: String },
            linkedAt: { type: Date }
        },
        jira: {
            jiraAccountId: { type: String }, // Quan trọng: dùng để map assignee trong Jira
            cloudId: { type: String },       // ID site Jira (accessible-resources)
            email: { type: String },
            accessToken: { type: String },
            refreshToken: { type: String },  // offline_access để refresh token
            linkedAt: { type: Date }
        }
    },
    password: { type: String, required: true },
    // Google OAuth
    googleId: { type: String, sparse: true, unique: true },
    // Thêm role cố định
    role: { type: String, default: 'LECTURER', immutable: true },
    is_verified: { type: Boolean, default: false }, // Email đã được xác minh chưa
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Lecturer', LecturerSchema);