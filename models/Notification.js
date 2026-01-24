const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NotificationSchema = new Schema({
    user_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true,
        refPath: 'user_role_ref' // Dynamic reference based on role
    },
    user_role: { 
        type: String, 
        enum: ['STUDENT', 'LECTURER'],
        required: true 
    },
    // Virtual field for dynamic reference
    user_role_ref: {
        type: String,
        required: true,
        enum: ['Student', 'Lecturer'],
        // Tự động gán giá trị mặc định dựa trên user_role ngay khi khởi tạo
        default: function() {
            if (this.user_role === 'STUDENT') return 'Student';
            if (this.user_role === 'LECTURER') return 'Lecturer';
            return null;
        }
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { 
        type: String, 
        // enum: ['SYSTEM', 'GRADE', 'TASK', 'ASSIGNMENT'], // Bỏ enum cứng để linh hoạt
        default: 'SYSTEM' 
    },
    is_read: { type: Boolean, default: false },
    data: { type: Object }, // Metadata (url, id, etc.)
    created_at: { type: Date, default: Date.now }
});

// Không cần pre('save') hook nữa vì đã có default function

module.exports = mongoose.model('Notification', NotificationSchema);