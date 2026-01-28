const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { encryptIntegrations, decryptIntegrations } = require('../utils/encryption');

const LecturerSchema = new Schema({
    email: { type: String, required: true, unique: true },
    full_name: String,
    avatar_url: String,
    // ==================================================
    // TÍCH HỢP TÀI KHOẢN (Account Integration)
    // Dùng Mixed + default {} tương tự Student để tránh
    // lỗi "Cast to Object failed for value 'undefined' at path 'integrations.github'"
    // khi dữ liệu cũ hoặc khi integrations/github/jira bị null/undefined.
    // ==================================================
    integrations: {
        type: Schema.Types.Mixed,
        default: {}
    },
    password: { type: String, required: true },
    // Google OAuth
    googleId: { type: String, sparse: true, unique: true },
    // Thêm role cố định
    role: { type: String, default: 'LECTURER', immutable: true },
    // Firebase Cloud Messaging Token
    fcm_token: { type: String, default: null },
    is_verified: { type: Boolean, default: false }, // Email đã được xác minh chưa
    created_at: { type: Date, default: Date.now }
});

// Pre-save hook: Mã hóa tokens trước khi lưu vào DB
LecturerSchema.pre('save', async function() {
  if (this.isModified('integrations') && this.integrations) {
    this.integrations = encryptIntegrations(this.integrations);
  }
});

// Post-find hook: Giải mã tokens sau khi lấy từ DB
LecturerSchema.post(['find', 'findOne', 'findOneAndUpdate'], function(docs) {
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
LecturerSchema.post('init', function(doc) {
  if (doc && doc.integrations) {
    doc.integrations = decryptIntegrations(doc.integrations);
  }
});

module.exports = mongoose.model('Lecturer', LecturerSchema);