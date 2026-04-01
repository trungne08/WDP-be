const models = require('../models');
const mongoose = require('mongoose');
const GithubService = require('../services/GithubService');

// POST /api/projects
// Leader tạo project mới dựa trên danh sách members + repo Jira/GitHub đã chọn
exports.createProject = async (req, res) => {
  try {
    const { role, userId, user } = req;

    // Log request để debug
    console.log(`\n🚀 [CreateProject] Bắt đầu tạo project`);
    console.log(`   👤 User: ${user?.email || 'N/A'} (${userId})`);
    console.log(`   🔑 Role: ${role}`);
    console.log(`   📦 Request Body:`, JSON.stringify(req.body, null, 2));

    // Chỉ cho phép STUDENT (Leader) tạo project
    if (role !== 'STUDENT') {
      console.log(`   ❌ [CreateProject] Lỗi: Role không phải STUDENT`);
      return res.status(403).json({ error: 'Chỉ sinh viên (Leader) mới được tạo Project.' });
    }

    const { name, members, class_id: bodyClassId, team_id: bodyTeamId, githubRepoUrl: rawGithubUrl, jiraProjectKey: rawJiraKey } = req.body || {};
    
    // Sanitize Jira Project Key (loại bỏ "[SCRUM]", trim, uppercase)
    const sanitizeJiraProjectKey = (input) => {
      if (!input || typeof input !== 'string') return '';
      let cleaned = input.trim();
      const bracketMatch = cleaned.match(/^\[([^\]]+)\]/);
      if (bracketMatch) cleaned = bracketMatch[1];
      cleaned = cleaned.trim().replace(/[^A-Za-z0-9_-]/g, '').toUpperCase();
      return cleaned;
    };
    
    // Normalize GitHub Repo URL (loại bỏ .git, trailing slash, validate format)
    const normalizeGithubRepoUrl = (input) => {
      if (!input || typeof input !== 'string') return '';
      let cleaned = input.trim();
      // Loại bỏ .git ở cuối
      cleaned = cleaned.replace(/\.git$/, '');
      // Loại bỏ trailing slash
      cleaned = cleaned.replace(/\/$/, '');
      // Validate: phải là URL GitHub hợp lệ
      if (!cleaned.match(/^https?:\/\/(www\.)?github\.com\/[\w\-\.]+\/[\w\-\.]+/i)) {
        console.warn(`⚠️ [CreateProject] GitHub URL có vẻ không hợp lệ: ${cleaned}`);
        // Vẫn trả về để lưu (có thể là private repo hoặc format khác)
      }
      return cleaned;
    };
    
    const jiraProjectKey = rawJiraKey ? sanitizeJiraProjectKey(rawJiraKey) : '';
    const githubRepoUrl = rawGithubUrl ? normalizeGithubRepoUrl(rawGithubUrl) : '';
    
    // Log để debug
    if (rawJiraKey && jiraProjectKey !== rawJiraKey.trim()) {
      console.log(`🔧 [CreateProject] Sanitized Jira Key: "${rawJiraKey}" -> "${jiraProjectKey}"`);
    }
    if (rawGithubUrl && githubRepoUrl !== rawGithubUrl.trim()) {
      console.log(`🔧 [CreateProject] Normalized GitHub URL: "${rawGithubUrl}" -> "${githubRepoUrl}"`);
    }

    if (!name || !Array.isArray(members) || members.length === 0) {
      console.log(`   ❌ [CreateProject] Validation: Thiếu name hoặc members`);
      return res.status(400).json({
        error: 'name và members (array studentId) là bắt buộc.',
        received: { name: name || null, members: members || null }
      });
    }

    if (!bodyClassId || !bodyTeamId) {
      console.log(`   ❌ [CreateProject] Validation: Thiếu class_id hoặc team_id`);
      return res.status(400).json({
        error: 'class_id và team_id là bắt buộc. Vui lòng chọn lớp và nhóm từ giao diện.',
        received: { class_id: bodyClassId || null, team_id: bodyTeamId || null }
      });
    }
    if (!mongoose.Types.ObjectId.isValid(bodyClassId) || !mongoose.Types.ObjectId.isValid(bodyTeamId)) {
      return res.status(400).json({ error: 'class_id hoặc team_id không hợp lệ.' });
    }

    const selectedTeamId = bodyTeamId.toString().trim();
    const requestedClassId = bodyClassId.toString().trim();

    // Validate và filter các ID hợp lệ
    const allStudentIdStrings = Array.from(
      new Set([userId.toString(), ...members.map(String)])
    ).filter(id => id && id.trim() !== ''); // Loại bỏ null, undefined, rỗng

    // Kiểm tra tất cả ID có phải ObjectId hợp lệ không
    const invalidIds = allStudentIdStrings.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      console.log(`   ❌ [CreateProject] Validation: Có ${invalidIds.length} ID không hợp lệ:`, invalidIds);
      return res.status(400).json({
        error: 'Một số member ID không hợp lệ (phải là ObjectId 24 ký tự hex).',
        invalid_ids: invalidIds
      });
    }

    // Convert sang ObjectId (đã validate rồi nên an toàn)
    const allStudentIds = allStudentIdStrings.map(id => new mongoose.Types.ObjectId(id));

    // 1) Kiểm tra Team tồn tại và thuộc đúng class (dùng class_id và team_id từ req.body)
    const teamExists = await models.Team.findOne({
      _id: selectedTeamId,
      class_id: requestedClassId
    }).lean();

    if (!teamExists) {
      console.log(`   ❌ [CreateProject] Validation: Team ${selectedTeamId} không tồn tại hoặc không thuộc lớp ${requestedClassId}`);
      return res.status(400).json({
        error: 'Nhóm (team) không tồn tại hoặc không thuộc lớp đã chọn. Vui lòng kiểm tra lại.'
      });
    }

    // 2) Kiểm tra TẤT CẢ thành viên đều đang tồn tại (active) trong TeamMember với team_id đã chọn
    const teamMembers = await models.TeamMember.find({
      team_id: selectedTeamId,
      student_id: { $in: allStudentIds },
      is_active: true
    }).lean();

    const foundStudentIds = [...new Set(teamMembers.map(tm => tm.student_id?.toString()).filter(Boolean))];
    const missingStudentIds = allStudentIds
      .filter(id => !foundStudentIds.includes(id.toString()))
      .map(id => id.toString());

    if (missingStudentIds.length > 0) {
      console.log(`   ❌ [CreateProject] Validation: ${missingStudentIds.length} thành viên không thuộc nhóm này: ${missingStudentIds.join(', ')}`);
      return res.status(400).json({
        error: 'Một số thành viên không thuộc nhóm (team) đã chọn hoặc đã bị vô hiệu hóa. Vui lòng kiểm tra lại.',
        missing_student_ids: missingStudentIds
      });
    }

    console.log(`   ✅ [CreateProject] Đã xác thực team ${selectedTeamId} với ${teamMembers.length} thành viên hợp lệ`);

    // 3) Lấy thông tin team hiện tại (để lấy class_id, semester_id và subject_id)
    const currentTeam = await models.Team.findById(selectedTeamId)
      .populate({
        path: 'class_id',
        select: 'lecturer_id semester_id subject_id _id'
      })
      .lean();
    
    if (!currentTeam || !currentTeam.class_id) {
      return res.status(400).json({
        error: 'Không tìm thấy thông tin lớp học của nhóm này.'
      });
    }

    const currentClassId = currentTeam.class_id._id.toString();
    const currentSemesterId = currentTeam.class_id.semester_id?.toString() || currentTeam.class_id.semester_id;
    const currentSubjectId = currentTeam.class_id.subject_id?.toString() || currentTeam.class_id.subject_id || null;
    const lecturerId = currentTeam.class_id.lecturer_id || null;

    if (!currentSemesterId) {
      return res.status(400).json({
        error: 'Lớp học này chưa có thông tin học kỳ. Vui lòng kiểm tra lại.'
      });
    }

    // 4) Validate: Kiểm tra xem member có project ở CÙNG LỚP + CÙNG HỌC KỲ + CÙNG MÔN không (khác lớp/kỳ/môn thì OK)
    // QUAN TRỌNG: Nếu student đã chuyển nhóm hoặc không còn thuộc team của project cũ, tự động cleanup project cũ
    // VALIDATION IS CLASS-SCOPED: Students can have projects in different classes
    const queryConditions = {
      class_id: currentClassId,
      semester_id: currentSemesterId,
      members: { $in: allStudentIds }
    };
    
    // Nếu có subject_id thì thêm vào điều kiện (để phân biệt rõ hơn)
    if (currentSubjectId) {
      queryConditions.subject_id = currentSubjectId;
    }
    
    console.log(`   🔍 [CreateProject] Validation Query (Class-Scoped):`);
    console.log(`      - class_id: ${currentClassId}`);
    console.log(`      - semester_id: ${currentSemesterId}`);
    console.log(`      - subject_id: ${currentSubjectId || '(not specified)'}`);
    console.log(`      - checking ${allStudentIds.length} student(s)`);
    console.log(`   ✅ Students CAN join projects in OTHER classes - validation is PER CLASS only`);
    
    const existingProjectsInSameClass = await models.Project.find(queryConditions).lean();

    if (existingProjectsInSameClass.length > 0) {
      // Tìm các member bị conflict (đã có project ở lớp này)
      // QUAN TRỌNG: Kiểm tra xem student có còn thuộc team của project cũ không
      const conflictedMemberIds = new Set();
      const projectsToCleanup = []; // Danh sách project cần cleanup (xóa student khỏi members)

      for (const proj of existingProjectsInSameClass) {
        const projectTeamId = proj.team_id?.toString();
        
        // Kiểm tra từng student trong project cũ
        for (const memberId of proj.members) {
          const memberIdStr = memberId.toString();
          
          // Nếu student này nằm trong danh sách tạo project mới
          if (allStudentIds.some(id => id.toString() === memberIdStr)) {
            // Kiểm tra xem student có còn thuộc team của project cũ không
            const stillInOldTeam = await models.TeamMember.findOne({
              team_id: projectTeamId,
              student_id: memberIdStr,
              is_active: true
            }).lean();

            if (!stillInOldTeam) {
              // Student KHÔNG còn thuộc team cũ → tự động cleanup (xóa khỏi project cũ)
              console.log(`   🔧 [CreateProject] Auto-cleanup: Student ${memberIdStr} không còn thuộc team ${projectTeamId} của project cũ "${proj.name}" → Xóa khỏi project cũ`);
              
              if (!projectsToCleanup.find(p => p.projectId === proj._id.toString())) {
                projectsToCleanup.push({
                  projectId: proj._id.toString(),
                  projectName: proj.name,
                  studentsToRemove: []
                });
              }
              
              const cleanupItem = projectsToCleanup.find(p => p.projectId === proj._id.toString());
              cleanupItem.studentsToRemove.push(memberIdStr);
            } else {
              // Student VẪN còn thuộc team cũ → CONFLICT thật sự
              conflictedMemberIds.add(memberIdStr);
            }
          }
        }
      }

      // Thực hiện cleanup: Xóa student khỏi members của project cũ
      for (const cleanup of projectsToCleanup) {
        await models.Project.updateOne(
          { _id: cleanup.projectId },
          { $pull: { members: { $in: cleanup.studentsToRemove.map(id => new mongoose.Types.ObjectId(id)) } } }
        );
        console.log(`   ✅ [CreateProject] Đã cleanup project "${cleanup.projectName}": Xóa ${cleanup.studentsToRemove.length} student(s) khỏi members`);
      }

      // Sau khi cleanup, nếu vẫn còn conflict → báo lỗi
      if (conflictedMemberIds.size > 0) {
        console.log(`   ❌ [CreateProject] Validation: Có ${conflictedMemberIds.size} thành viên VẪN CÒN thuộc team của project cũ ở lớp này (học kỳ ${currentSemesterId}, môn ${currentSubjectId || 'N/A'})`);
        return res.status(400).json({
          error: 'Một số thành viên đã có Project ở lớp này trong học kỳ này và vẫn còn thuộc team của project đó. Mỗi sinh viên chỉ được có 1 Project trong 1 lớp/1 học kỳ/1 môn.',
          conflicted_member_ids: Array.from(conflictedMemberIds),
          semester_id: currentSemesterId,
          subject_id: currentSubjectId,
          existing_projects: existingProjectsInSameClass
            .filter(p => {
              // Chỉ trả về project mà có student VẪN CÒN conflict (không phải đã cleanup)
              return p.members.some(memberId => conflictedMemberIds.has(memberId.toString()));
            })
            .map(p => ({
              _id: p._id,
              name: p.name,
              class_id: p.class_id,
              team_id: p.team_id,
              semester_id: p.semester_id,
              subject_id: p.subject_id
            }))
        });
      } else if (projectsToCleanup.length > 0) {
        // Đã cleanup thành công, không còn conflict → tiếp tục tạo project mới
        console.log(`   ✅ [CreateProject] Đã cleanup ${projectsToCleanup.length} project(s) cũ, không còn conflict → Tiếp tục tạo project mới`);
      }
    }

    // 5) Tạo Project (với class_id, team_id, semester_id và subject_id)
    const project = await models.Project.create({
      name,
      class_id: currentClassId,       // QUAN TRỌNG: Lưu class_id để biết project thuộc lớp nào
      team_id: selectedTeamId,        // QUAN TRỌNG: Lưu team_id để biết project thuộc team nào
      semester_id: currentSemesterId, // QUAN TRỌNG: Lưu semester_id để phân biệt project cùng lớp/team nhưng khác học kỳ
      subject_id: currentSubjectId,   // QUAN TRỌNG: Lưu subject_id để phân biệt project cùng lớp/team/kỳ nhưng khác môn
      leader_id: userId,
      lecturer_id: lecturerId,
      members: allStudentIds,
      githubRepoUrl: githubRepoUrl,
      jiraProjectKey: jiraProjectKey
    });
    
    console.log(`✅ [CreateProject] Đã tạo project "${name}"`);
    console.log(`   📚 Lớp: ${currentClassId}`);
    console.log(`   👥 Team: ${selectedTeamId}`);
    console.log(`   📅 Học kỳ: ${currentSemesterId}`);
    console.log(`   📖 Môn học: ${currentSubjectId || '(không có)'}`);
    console.log(`   📦 GitHub: ${githubRepoUrl || '(không có)'}`);
    console.log(`   📦 Jira: ${jiraProjectKey || '(không có)'}`);

    // 6) Cập nhật project_id cho tất cả TeamMember trong nhóm
    // Dùng team_id và student_id để đảm bảo cập nhật đúng (tránh duplicate TeamMember records)
    await models.TeamMember.updateMany(
      { 
        team_id: selectedTeamId,
        student_id: { $in: allStudentIds },
        is_active: true
      },
      { project_id: project._id }
    );

    const ghToken = user?.integrations?.github?.accessToken;
    if (githubRepoUrl && ghToken) {
      try {
        const backendBase = GithubService.getWebhookBackendBaseUrl(req);
        if (backendBase) {
          const { owner, repo } = GithubService.parseRepoUrl(githubRepoUrl);
          await GithubService.createGithubWebhook(owner, repo, ghToken, backendBase);
          console.log(`✅ [CreateProject] Đã đăng ký webhook push cho ${owner}/${repo}`);
        } else {
          console.warn('⚠️ [CreateProject] Thiếu SERVER_URL/RENDER_EXTERNAL_URL/BACKEND_URL — bỏ qua đăng ký webhook');
        }
      } catch (whErr) {
        console.warn('⚠️ [CreateProject] Đăng ký webhook GitHub thất bại:', whErr.message);
      }
    }

    // 7) Populate project để trả về đầy đủ thông tin (class_id, team_id, semester_id, subject_id)
    const populatedProject = await models.Project.findById(project._id)
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .populate('class_id', '_id name class_code subjectName')
      .populate('team_id', '_id project_name')
      .populate('semester_id', '_id name code')
      .populate('subject_id', '_id name code')
      .lean();

    // Manual Socket Emission: project_updated thay thế ChangeStream
    if (global._io) {
      const projectDoc = await models.Project.findById(project._id).lean();
      if (projectDoc) {
        const pid = project._id.toString();
        const projectRoom = `project:${pid}`;
        const payload = { action: 'insert', data: projectDoc };
        global._io.to(projectRoom).emit('project_updated', payload);
        if (projectDoc.class_id) {
          global._io.to(String(projectDoc.class_id)).emit('project_updated', payload);
        }
      }
    }

    return res.status(201).json({
      message: '✅ Tạo Project thành công!',
      project: populatedProject
    });
  } catch (error) {
    console.error('createProject error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/projects/my-project?class_id=xxx (optional)
// Dành cho STUDENT: lấy TẤT CẢ projects mà user là thành viên (leader hoặc members)
// Trả về Array [], sắp xếp theo thời gian tạo mới nhất
exports.getMyProject = async (req, res) => {
  try {
    const { role, userId } = req;
    const userObjectId = req.user?._id || userId;
    const { class_id } = req.query; // Query param optional

    if (role !== 'STUDENT') {
      return res.status(403).json({ error: 'Chỉ sinh viên mới dùng được API này.' });
    }

    const query = {
      $or: [
        { leader_id: userObjectId },
        { members: userObjectId }
      ]
    };

    if (class_id && mongoose.Types.ObjectId.isValid(class_id)) {
      query.class_id = class_id;
    }

    const projects = await models.Project.find(query)
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .populate('class_id', '_id name class_code subjectName')
      .populate('team_id', '_id project_name')
      .populate('semester_id', '_id name code')
      .populate('subject_id', '_id name code')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      total: (projects || []).length,
      projects: projects || []
    });
  } catch (error) {
    console.error('getMyProject error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/projects/can-create?class_id=xxx
// Dành cho STUDENT: check xem có thể tạo project trong class này không
exports.canCreateProject = async (req, res) => {
  try {
    const { role, userId } = req;
    const { class_id } = req.query;

    if (role !== 'STUDENT') {
      return res.status(403).json({ error: 'Chỉ sinh viên mới dùng được API này.' });
    }

    if (!class_id) {
      return res.status(400).json({ error: 'class_id là bắt buộc trong query params.' });
    }

    // Lấy thông tin class để có semester_id và subject_id
    const classInfo = await models.Class.findById(class_id).lean();
    if (!classInfo) {
      return res.status(404).json({ error: 'Không tìm thấy lớp học.' });
    }

    // Check xem sinh viên đã có project trong class này chưa
    const queryConditions = {
      class_id: class_id,
      semester_id: classInfo.semester_id,
      $or: [
        { leader_id: userId },
        { members: userId }
      ]
    };

    if (classInfo.subject_id) {
      queryConditions.subject_id = classInfo.subject_id;
    }

    const existingProject = await models.Project.findOne(queryConditions).lean();

    return res.json({
      can_create: !existingProject,
      reason: existingProject 
        ? 'Bạn đã có project trong lớp này rồi' 
        : 'Bạn có thể tạo project trong lớp này',
      existing_project: existingProject ? {
        _id: existingProject._id,
        name: existingProject.name,
        class_id: existingProject.class_id
      } : null
    });

  } catch (error) {
    console.error('canCreateProject error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/projects/my-projects
// Dành cho STUDENT: lấy TẤT CẢ projects của sinh viên (nhiều lớp)
exports.getMyProjects = async (req, res) => {
  try {
    const { role, userId } = req;

    if (role !== 'STUDENT') {
      return res.status(403).json({ error: 'Chỉ sinh viên mới dùng được API này.' });
    }

    // Lấy TẤT CẢ projects của sinh viên (query trực tiếp từ Project model - nhanh hơn)
    const projects = await models.Project.find({
      $or: [
        { leader_id: userId },
        { members: userId }
      ]
    })
    .populate('leader_id', 'student_code email full_name avatar_url')
    .populate('lecturer_id', 'email full_name avatar_url')
    .populate('members', 'student_code email full_name avatar_url')
    .populate('class_id', '_id name class_code subjectName')
    .populate('team_id', '_id project_name')
    .populate('semester_id', '_id name code')
    .lean();

    if (projects.length === 0) {
      return res.json({ 
        total: 0,
        projects: []
      });
    }

    return res.json({
      total: projects.length,
      projects: projects
    });
  } catch (error) {
    console.error('getMyProjects error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/projects/teams/:teamId
// Lấy project của một team cụ thể
exports.getProjectByTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { role, userId } = req;

    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ error: 'teamId không hợp lệ' });
    }

    // Kiểm tra team tồn tại
    const team = await models.Team.findById(teamId)
      .populate('class_id', '_id name class_code subjectName lecturer_id') 
      .lean();

    if (!team) {
      return res.status(404).json({ error: 'Không tìm thấy team' });
    }

    // Kiểm tra quyền: Student chỉ xem được team của mình, Lecturer xem được team trong lớp của mình
    if (role === 'STUDENT') {
      const teamMember = await models.TeamMember.findOne({
        team_id: teamId,
        student_id: userId,
        is_active: true
      }).lean();

      if (!teamMember) {
        return res.status(403).json({ error: 'Bạn không thuộc team này' });
      }
    } else if (role === 'LECTURER') {
      if (team.class_id?.lecturer_id?.toString() !== userId.toString()) {
        return res.status(403).json({ error: 'Bạn không phải giảng viên của lớp này' });
      }
    }

    // Lấy project của team này (query trực tiếp từ Project model - nhanh và chính xác hơn)
    const project = await models.Project.findOne({ team_id: teamId })
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .populate('class_id', '_id name class_code subjectName')
      .populate('team_id', '_id project_name')
      .populate('semester_id', '_id name code')
      .populate('subject_id', '_id name code')
      .lean();

    return res.json({
      team: {
        _id: team._id,
        class: team.class_id
      },
      project: project || null
    });
  } catch (error) {
    console.error('getProjectByTeam error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/projects/classes/:classId
// Lấy tất cả projects của một lớp (cho Student hoặc Lecturer)
exports.getProjectsByClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const { role, userId } = req;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ error: 'classId không hợp lệ' });
    }

    // Kiểm tra lớp tồn tại
    const classInfo = await models.Class.findById(classId).lean();
    if (!classInfo) {
      return res.status(404).json({ error: 'Không tìm thấy lớp học' });
    }

    // Kiểm tra quyền
    if (role === 'STUDENT') {
      // Student chỉ xem được lớp mà mình đang học
      // Kiểm tra xem student có project nào trong lớp này không (nhanh hơn)
      const studentProject = await models.Project.findOne({
        class_id: classId,
        $or: [
          { leader_id: userId },
          { members: userId }
        ]
      }).lean();

      if (!studentProject) {
        // Nếu không có project, kiểm tra xem có thuộc team nào trong lớp này không
        const teamMember = await models.TeamMember.findOne({
          student_id: userId,
          is_active: true
        })
        .populate({
          path: 'team_id',
          select: 'class_id'
        })
        .lean();

        if (!teamMember || teamMember.team_id?.class_id?.toString() !== classId) {
          return res.status(403).json({ error: 'Bạn không thuộc lớp này' });
        }
      }
    } else if (role === 'LECTURER') {
      // Lecturer chỉ xem được lớp của mình
      if (classInfo.lecturer_id?.toString() !== userId.toString()) {
        return res.status(403).json({ error: 'Bạn không phải giảng viên của lớp này' });
      }
    }

    // Lấy TẤT CẢ projects thuộc lớp này (query trực tiếp từ Project model - nhanh hơn)
    const projects = await models.Project.find({ class_id: classId })
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .populate('class_id', '_id name class_code subjectName')
      .populate('team_id', '_id project_name')
      .lean();

    return res.json({
      class: {
        _id: classInfo._id,
        name: classInfo.name,
        class_code: classInfo.class_code
      },
      total: projects.length,
      projects: projects
    });
  } catch (error) {
    console.error('getProjectsByClass error:', error);
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

    // Lấy TẤT CẢ projects thuộc lớp này (query trực tiếp từ Project model - nhanh và chính xác hơn)
    const projects = await models.Project.find({ class_id: classId })
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .populate('class_id', '_id name class_code')
      .populate('team_id', '_id project_name')
      .populate('semester_id', '_id name code')
      .populate('subject_id', '_id name code')
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

