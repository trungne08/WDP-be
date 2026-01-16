const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SemesterSchema = new Schema({
    name: { type: String, required: true },
    created_by_admin: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true },
    status: { 
        type: String, 
        enum: ['Open', 'Closed'], 
        default: 'Open' 
    }
});

module.exports = mongoose.model('Semester', SemesterSchema);
