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
    // Lưu ý: dùng Mixed + default {} để tránh lỗi "Cast to Object"
    // khi field integrations/github/jira đang là undefined/null hoặc
    // dữ liệu cũ chưa đúng format.
    // Cấu trúc mong đợi vẫn là:
    // integrations.github: { githubId, username, accessToken, linkedAt }
    // integrations.jira:  { jiraAccountId, cloudId, jiraUrl, email, accessToken, refreshToken, linkedAt }
    // nhưng schema mềm hơn để backward-compatible với dữ liệu cũ.
    // ==================================================
    integrations: {
        type: Schema.Types.Mixed,
        default: {}
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
StudentSchema.pre('save', async function() {
  if (this.isModified('integrations') && this.integrations) {
    this.integrations = encryptIntegrations(this.integrations);
  }
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