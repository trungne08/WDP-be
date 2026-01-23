const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AdminSchema = new Schema({
    email: { type: String, required: true, unique: true },
    full_name: String,
    // ==================================================
    // TÍCH HỢP TÀI KHOẢN (Account Integration)
    // (Admin có thể không dùng, nhưng thêm để đồng nhất)
    // ==================================================
    integrations: {
        github: {
            githubId: { type: String },
            username: { type: String },
            accessToken: { type: String },
            linkedAt: { type: Date }
        },
        jira: {
            jiraAccountId: { type: String },
            cloudId: { type: String },
            email: { type: String },
            accessToken: { type: String },
            refreshToken: { type: String },
            linkedAt: { type: Date }
        }
    },
    
    password: { type: String, required: true }, 
    
    role: { type: String, default: 'ADMIN', immutable: true },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Admin', AdminSchema);