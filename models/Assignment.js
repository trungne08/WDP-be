const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AssignmentSchema = new Schema({
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    lecturer_id: { type: Schema.Types.ObjectId, ref: 'Lecturer', required: true },
    
    title: { type: String, required: true },
    description: { type: String },
    
    // Phân loại: Bài tập về nhà (ASSIGNMENT) hoặc Bài Lab (LAB)
    type: { type: String, enum: ['ASSIGNMENT', 'LAB'], required: true }, 
    
    deadline: { type: Date, required: true },
    
    resources: [{ type: String }], // Link tài liệu hoặc file đề bài
    
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Assignment', AssignmentSchema);