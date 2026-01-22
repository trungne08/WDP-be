const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ClassSchema = new Schema({
    name: { type: String, required: true }, // VD: Software Engineering Project
    semester_id: { type: Schema.Types.ObjectId, ref: 'Semester', required: true },
    lecturer_id: { type: Schema.Types.ObjectId, ref: 'Lecturer', required: true },
    class_code: { type: String, required: true }, // Ví dụ: SE1740
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Class', ClassSchema);