const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { encryptIntegrations, decryptIntegrations } = require('../utils/encryption');

const StudentSchema = new Schema({
    student_code: { type: String, required: true, unique: true }, // Mã số sinh viên (MSSV)
    email: { type: String, required: true, unique: true },
    full_name: String,
    avatar_url: String,
    major: String,
    // ENT / Khóa (VD: K18, K19) - tiện cho filter theo khóa
    ent: { type: String }, 
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
    role: { type: String, default: 'STUDENT', immutable: true },
    // Firebase Cloud Messaging Token
    fcm_token: { type: String, default: null },
    is_verified: { type: Boolean, default: false }, // Email đã được xác minh chưa
    created_at: { type: Date, default: Date.now }
});

// Pre-save hook: Mã hóa tokens trước khi lưu vào DB
StudentSchema.pre('save', function(next) {
  if (this.isModified('integrations') && this.integrations) {
    this.integrations = encryptIntegrations(this.integrations);
  }
  next();
});

// Post-find hook: Giải mã tokens sau khi lấy từ DB
StudentSchema.post(['find', 'findOne', 'findOneAndUpdate'], function(docs) {
  if (!docs) return;
  
  const processDoc = (doc) => {
    if (doc && doc.integrations) {
      doc.integrations = decryptIntegrations(doc.integrations);
    }
  };
  
  if (Array.isArray(docs)) {
    docs.forEach(processDoc);
  } else {
    processDoc(docs);
  }
});

// Post-init hook: Giải mã khi load document
StudentSchema.post('init', function(doc) {
  if (doc && doc.integrations) {
    doc.integrations = decryptIntegrations(doc.integrations);
  }
});

module.exports = mongoose.model('Student', StudentSchema);