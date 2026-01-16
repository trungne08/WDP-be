const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ClassSchema = new Schema({
    class_code: { type: String, required: true }, // Ví dụ: SE1740
    semester: { type: Schema.Types.ObjectId, ref: 'Semester' },
    lecturer: { type: Schema.Types.ObjectId, ref: 'Lecturer' }
});

module.exports = mongoose.model('Class', ClassSchema);