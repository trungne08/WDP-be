const models = require('../models');
const mongoose = require('mongoose');

// POST /api/projects
// Leader tạo project mới dựa trên danh sách members + repo Jira/GitHub đã chọn
exports.createProject = async (req, res) => {
  try {
    const { role, userId, user } = req;

    // Chỉ cho phép STUDENT (Leader) tạo project
    if (role !== 'STUDENT') {
      return res.status(403).json({ error: 'Chỉ sinh viên (Leader) mới được tạo Project.' });
    }

    const { name, members, githubRepoUrl, jiraProjectKey } = req.body || {};

    if (!name || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({
        error: 'name và members (array studentId) là bắt buộc.'
      });
    }

    // Gom tất cả studentIds: leader + members, loại trùng
    const allStudentIds = Array.from(
      new Set([userId.toString(), ...members.map(String)])
    ).map(id => new mongoose.Types.ObjectId(id));

    // 1) Lấy TeamMember cho tất cả sinh viên trong danh sách
    const teamMembers = await models.TeamMember.find({
      student_id: { $in: allStudentIds },
      is_active: true
    }).lean();

    if (teamMembers.length !== allStudentIds.length) {
      // Tìm các student chưa nằm trong team nào
      const foundIds = new Set(teamMembers.map(tm => tm.student_id.toString()));
      const missing = allStudentIds
        .filter(id => !foundIds.has(id.toString()))
        .map(id => id.toString());

      return res.status(400).json({
        error: 'Một số thành viên chưa thuộc nhóm (Team) nào, không thể tạo Project.',
        missing_student_ids: missing
      });
    }

    // 2) Validate: tất cả phải thuộc CÙNG 1 team
    const teamIds = Array.from(new Set(teamMembers.map(tm => tm.team_id.toString())));
    if (teamIds.length !== 1) {
      return res.status(400).json({
        error: 'Các thành viên không thuộc cùng một nhóm (team). Vui lòng kiểm tra lại.'
      });
    }

    // 3) Validate: chưa có project nào gắn với các member này
    const membersWithProject = teamMembers.filter(tm => tm.project_id);
    if (membersWithProject.length > 0) {
      return res.status(400).json({
        error: 'Một số thành viên đã thuộc một Project khác.',
        conflicted_members: membersWithProject.map(tm => ({
          team_member_id: tm._id,
          student_id: tm.student_id,
          project_id: tm.project_id
        }))
      });
    }

    // 4) Cố gắng tìm lecturer từ Class thông qua Team -> Class
    let lecturerId = null;
    try {
      const team = await models.Team.findById(teamIds[0])
        .populate({
          path: 'class_id',
          select: 'lecturer_id'
        })
        .lean();
      lecturerId = team?.class_id?.lecturer_id || null;
    } catch (_) {
      // Nếu lỗi thì cho lecturerId = null, không chặn flow tạo project
      lecturerId = null;
    }

    // 5) Tạo Project
    const project = await models.Project.create({
      name,
      leader_id: userId,
      lecturer_id: lecturerId,
      members: allStudentIds,
      githubRepoUrl: githubRepoUrl || '',
      jiraProjectKey: jiraProjectKey || ''
    });

    // 6) Cập nhật project_id cho tất cả TeamMember trong nhóm
    await models.TeamMember.updateMany(
      { _id: { $in: teamMembers.map(tm => tm._id) } },
      { project_id: project._id }
    );

    return res.status(201).json({
      message: '✅ Tạo Project thành công!',
      project
    });
  } catch (error) {
    console.error('createProject error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/projects/my-project
// Dành cho STUDENT: xem mình đang thuộc Project nào (nếu có)
exports.getMyProject = async (req, res) => {
  try {
    const { role, userId } = req;

    if (role !== 'STUDENT') {
      return res.status(403).json({ error: 'Chỉ sinh viên mới dùng được API này.' });
    }

    // Tìm TeamMember của sinh viên có project_id khác null
    const teamMember = await models.TeamMember.findOne({
      student_id: userId,
      is_active: true,
      project_id: { $ne: null }
    }).lean();

    if (!teamMember) {
      return res.json({ project: null });
    }

    const project = await models.Project.findById(teamMember.project_id)
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .lean();

    if (!project) {
      return res.json({ project: null });
    }

    return res.json({ project });
  } catch (error) {
    console.error('getMyProject error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/projects/lecturer/classes/:classId
// Dành cho LECTURER: lấy tất cả Project thuộc classId đó
exports.getProjectsByClassForLecturer = async (req, res) => {
  try {
    const { role, userId } = req;
    const { classId } = req.params;

    if (role !== 'LECTURER') {
      return res.status(403).json({ error: 'Chỉ giảng viên mới dùng được API này.' });
    }

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ error: 'classId không hợp lệ' });
    }

    // 1) Lấy tất cả team thuộc classId này
    const teams = await models.Team.find({ class_id: classId }).select('_id').lean();
    const teamIds = teams.map(t => t._id);

    if (teamIds.length === 0) {
      return res.json({ total: 0, projects: [] });
    }

    // 2) Lấy TeamMember của các team này có project_id khác null
    const teamMembers = await models.TeamMember.find({
      team_id: { $in: teamIds },
      is_active: true,
      project_id: { $ne: null }
    })
      .select('project_id')
      .lean();

    if (teamMembers.length === 0) {
      return res.json({ total: 0, projects: [] });
    }

    const projectIds = Array.from(new Set(teamMembers.map(tm => tm.project_id.toString())));

    // 3) Lấy Project + populate leader/members
    const projects = await models.Project.find({ _id: { $in: projectIds } })
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .lean();

    return res.json({
      total: projects.length,
      projects
    });
  } catch (error) {
    console.error('getProjectsByClassForLecturer error:', error);
    return res.status(500).json({ error: error.message });
  }
};

