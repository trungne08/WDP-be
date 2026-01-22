const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SemesterSchema = new Schema({
    name: { type: String, required: true }, // VD: Spring 2026
    code: { type: String, required: true, unique: true }, // VD: SP2026
    created_by_admin: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true },
    status: { 
        type: String, 
        enum: ['Open', 'Closed'], 
        default: 'Open' 
    },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Semester', SemesterSchema);
