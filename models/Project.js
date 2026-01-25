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

    // QUAN HỆ VỚI LỚP, NHÓM, HỌC KỲ VÀ MÔN HỌC (Quan trọng để phân biệt project)
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    semester_id: { type: Schema.Types.ObjectId, ref: 'Semester', required: true }, // Học kỳ để phân biệt project cùng team/class nhưng khác kỳ
    subject_id: { type: Schema.Types.ObjectId, ref: 'Subject', required: false }, // Môn học (có thể null nếu dùng subjectName)

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

// Index để query nhanh theo lớp, team, học kỳ và môn học
ProjectSchema.index({ class_id: 1, team_id: 1, semester_id: 1, subject_id: 1 });
ProjectSchema.index({ team_id: 1, semester_id: 1, subject_id: 1 });
ProjectSchema.index({ semester_id: 1, subject_id: 1 });
ProjectSchema.index({ subject_id: 1 });

module.exports = mongoose.models.Project || mongoose.model('Project', ProjectSchema);

