const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { encryptIntegrations, decryptIntegrations } = require('../utils/encryption');

const AdminSchema = new Schema({
    email: { type: String, required: true, unique: true },
    full_name: String,
    // ==================================================
    // TÍCH HỢP TÀI KHOẢN (Account Integration)
    // FIX: Dùng Mixed + default {} để tránh lỗi "Cast to Object failed for value 'undefined'"
    // Tương tự Student/Lecturer để đồng nhất và tránh validation errors
    // ==================================================
    integrations: {
        type: Schema.Types.Mixed,
        default: {}
    },
    
    password: { type: String, required: true },
    // Google OAuth
    googleId: { type: String, sparse: true, unique: true },
    
    role: { type: String, default: 'ADMIN', immutable: true },
    // Firebase Cloud Messaging Token
    fcm_token: { type: String, default: null },
    is_verified: { type: Boolean, default: false }, // Email đã được xác minh chưa
    created_at: { type: Date, default: Date.now }
});

// Pre-save hook: Mã hóa tokens trước khi lưu vào DB
AdminSchema.pre('save', async function() {
  if (this.isModified('integrations') && this.integrations) {
    this.integrations = encryptIntegrations(this.integrations);
  }
});

// Post-find hook: Giải mã tokens sau khi lấy từ DB
AdminSchema.post(['find', 'findOne', 'findOneAndUpdate'], function(docs) {
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
AdminSchema.post('init', function(doc) {
  if (doc && doc.integrations) {
    doc.integrations = decryptIntegrations(doc.integrations);
  }
});

module.exports = mongoose.model('Admin', AdminSchema);