const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AdminSchema = new Schema({
    email: { type: String, required: true, unique: true },
    full_name: String,
    
    // THÊM CÁI NÀY VÀO NÈ BA
    password: { type: String, required: true }, 
    
    role: { type: String, default: 'ADMIN', immutable: true },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Admin', AdminSchema);