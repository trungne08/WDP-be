const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Project model (Dự án)
 *
 * Lưu ý theo codebase hiện tại:
 * - User đang tách 3 collection: Student/Lecturer/Admin
 * - Project của môn/lớp thường: leader và members là Student, lecturer là Lecturer
 */
const ProjectSchema = new Schema(
  {
    name: { type: String, required: true },

    leader_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    // Giảng viên có thể null nếu tạo project không gắn lớp cụ thể
    lecturer_id: { type: Schema.Types.ObjectId, ref: 'Lecturer' },
    members: [{ type: Schema.Types.ObjectId, ref: 'Student', default: [] }],

    // Thông tin tích hợp (chọn từ dropdown)
    githubRepoUrl: { type: String, default: '' },
    jiraProjectKey: { type: String, default: '' },

    created_at: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Project || mongoose.model('Project', ProjectSchema);

