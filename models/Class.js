const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ClassSchema = new Schema({
    // 1. Thông tin cơ bản
    name: { 
        type: String, 
        required: true 
    },
    class_code: { 
        type: String, 
        required: true, 
        // unique: true // Đã bỏ unique global để cho phép trùng mã lớp nếu khác môn
    },
    subjectName: {
        type: String,
        required: true
    },
    // Link đến Subject model (optional, để backward compatible)
    // Nếu có subject_id thì dùng, nếu không thì dùng subjectName
    subject_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subject',
        default: null
    },
    status: {
        type: String,
        enum: ['Active', 'Archived'],
        default: 'Active'
    },

    // 2. Liên kết
    semester_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Semester',
        required: true 
    },
    lecturer_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Lecturer',
        required: true 
    },

    // ==================================================
    // 3. CẤU HÌNH ĐIỂM (GRADING CONFIG) - QUAN TRỌNG
    // ==================================================
    
    // Cấu trúc điểm môn học (VD: Lab 10%, Ass 20%, Final 40%)
    gradeStructure: [{
        name: { type: String, required: true },     // Tên cột điểm (VD: Assignment 1)
        weight: { type: Number, required: true },   // Trọng số (VD: 0.2 cho 20%)
        isGroupGrade: { type: Boolean, default: false } // Có phải điểm nhóm không?
    }],

    // Cấu hình tính đóng góp (Cho các cột điểm nhóm)
    contributionConfig: {
        jiraWeight: { type: Number, default: 0.4 },   // Trọng số Jira (40%)
        gitWeight: { type: Number, default: 0.4 },    // Trọng số Git (40%)
        reviewWeight: { type: Number, default: 0.2 }, // Trọng số Review (20%)
        allowOverCeiling: { type: Boolean, default: false } // Cho phép điểm > 100% không? (Bonus)
    }

}, { 
    timestamps: true 
});

// Index phức hợp: Trong cùng 1 kỳ, cùng 1 môn (subjectName), mã lớp (class_code) phải là duy nhất
// Cho phép: Kỳ SP2026, Môn SWP301 -> Lớp SE1943
// Cho phép: Kỳ SP2026, Môn PRJ301 -> Lớp SE1943 (Trùng mã lớp nhưng khác môn -> OK)
ClassSchema.index({ semester_id: 1, subjectName: 1, class_code: 1 }, { unique: true });

// Nếu dùng subject_id thì cũng đánh index tương tự (partial để tránh lỗi nếu null)
ClassSchema.index({ semester_id: 1, subject_id: 1, class_code: 1 }, { unique: true, partialFilterExpression: { subject_id: { $type: "objectId" } } });

// Kiểm tra xem model đã tồn tại chưa để tránh lỗi OverwriteModelError
module.exports = mongoose.models.Class || mongoose.model('Class', ClassSchema);