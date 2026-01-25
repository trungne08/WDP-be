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

    // QUAN HỆ VỚI LỚP VÀ NHÓM (Quan trọng để phân biệt project ở lớp nào)
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },

    leader_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    // Giảng viên lấy từ class_id (có thể null nếu class chưa có lecturer)
    lecturer_id: { type: Schema.Types.ObjectId, ref: 'Lecturer' },
    members: [{ type: Schema.Types.ObjectId, ref: 'Student', default: [] }],

    // Thông tin tích hợp (chọn từ dropdown)
    githubRepoUrl: { type: String, default: '' },
    jiraProjectKey: { type: String, default: '' },

    created_at: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Index để query nhanh theo lớp và team
ProjectSchema.index({ class_id: 1, team_id: 1 });
ProjectSchema.index({ team_id: 1 });

module.exports = mongoose.models.Project || mongoose.model('Project', ProjectSchema);

