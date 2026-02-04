const models = require('../models');
const mongoose = require('mongoose');

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

    const { name, members, githubRepoUrl: rawGithubUrl, jiraProjectKey: rawJiraKey } = req.body || {};
    
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
      console.log(`      name: ${name || '(empty)'}`);
      console.log(`      members: ${Array.isArray(members) ? members.length : 'not array'} items`);
      return res.status(400).json({
        error: 'name và members (array studentId) là bắt buộc.',
        received: {
          name: name || null,
          members: members || null,
          members_type: Array.isArray(members) ? 'array' : typeof members
        }
      });
    }

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

    // 1) Lấy TeamMember cho tất cả sinh viên trong danh sách
    // QUAN TRỌNG: Populate đầy đủ để có thông tin lớp, học kỳ, môn học khi debug
    const allTeamMembers = await models.TeamMember.find({
      student_id: { $in: allStudentIds },
      is_active: true
    })
    .populate({
      path: 'team_id',
      select: 'class_id',
      populate: {
        path: 'class_id',
        select: '_id name class_code subjectName semester_id subject_id',
        populate: [
          {
            path: 'semester_id',
            select: '_id name code'
          },
          {
            path: 'subject_id',
            select: '_id name code'
          }
        ]
      }
    })
    .lean();

    // Debug log
    console.log(`🔍 [CreateProject] Tìm kiếm TeamMember cho ${allStudentIds.length} sinh viên`);
    console.log(`   📋 Danh sách ID cần tìm: ${allStudentIds.map(id => id.toString()).join(', ')}`);
    console.log(`   ✅ Tìm thấy ${allTeamMembers.length} TeamMember records (có thể thuộc nhiều lớp/team khác nhau)`);
    
    // Group TeamMember theo student_id để xử lý trường hợp 1 sinh viên có nhiều TeamMember
    const teamMembersByStudent = {};
    allTeamMembers.forEach(tm => {
      const studentIdStr = tm.student_id?.toString();
      if (!studentIdStr) return;
      
      if (!teamMembersByStudent[studentIdStr]) {
        teamMembersByStudent[studentIdStr] = [];
      }
      teamMembersByStudent[studentIdStr].push(tm);
    });

    // Kiểm tra xem có sinh viên nào không có TeamMember không
    const foundStudentIds = Object.keys(teamMembersByStudent);
    const missingStudentIds = allStudentIds
      .filter(id => !foundStudentIds.includes(id.toString()))
      .map(id => id.toString());

    if (missingStudentIds.length > 0) {
      console.log(`   ❌ [CreateProject] Thiếu ${missingStudentIds.length} thành viên: ${missingStudentIds.join(', ')}`);
      return res.status(400).json({
        error: 'Một số thành viên chưa thuộc nhóm (Team) nào, không thể tạo Project.',
        missing_student_ids: missingStudentIds,
        debug_info: {
          requested_count: allStudentIds.length,
          found_count: foundStudentIds.length,
          requested_ids: allStudentIds.map(id => id.toString()),
          found_ids: foundStudentIds
        }
      });
    }

    // 2) Tìm team chung cho tất cả sinh viên (trong cùng một lớp)
    // Logic: Một sinh viên có thể thuộc nhiều lớp/team khác nhau, nhưng trong MỘT LỚP chỉ thuộc MỘT TEAM
    // Khi tạo project, tất cả thành viên phải thuộc CÙNG MỘT TEAM trong CÙNG MỘT LỚP
    
    // Lấy tất cả team_id từ tất cả TeamMember (có thể thuộc nhiều lớp khác nhau)
    const allTeamIds = Array.from(new Set(
      allTeamMembers.map(tm => tm.team_id?._id?.toString()).filter(Boolean)
    ));

    console.log(`   🔍 [CreateProject] Tất cả team IDs: ${allTeamIds.join(', ')}`);

    // Tìm team mà TẤT CẢ sinh viên đều thuộc
    // Mỗi sinh viên có thể có nhiều TeamMember (nhiều lớp), nhưng chỉ cần tìm team chung
    const commonTeams = allTeamIds.filter(teamId => {
      return allStudentIds.every(studentId => {
        const studentIdStr = studentId.toString();
        const members = teamMembersByStudent[studentIdStr] || [];
        // Kiểm tra xem sinh viên này có TeamMember thuộc team này không
        return members.some(m => m.team_id?._id?.toString() === teamId);
      });
    });

    console.log(`   🔍 [CreateProject] Team chung cho tất cả sinh viên: ${commonTeams.length > 0 ? commonTeams.join(', ') : 'KHÔNG CÓ'}`);

    if (commonTeams.length === 0) {
      console.log(`   ❌ [CreateProject] Validation: Không có team nào chứa TẤT CẢ thành viên`);
      // Log chi tiết để debug (kèm thông tin lớp, học kỳ, môn học)
      Object.entries(teamMembersByStudent).forEach(([studentId, members]) => {
        const teams = members.map(m => ({
          team_id: m.team_id?._id?.toString(),
          class_id: m.team_id?.class_id?._id?.toString(),
          class_name: m.team_id?.class_id?.name || m.team_id?.class_id?.class_code,
          subject_name: m.team_id?.class_id?.subjectName,
          semester: m.team_id?.class_id?.semester_id?.name || m.team_id?.class_id?.semester_id,
          subject: m.team_id?.class_id?.subject_id?.name || m.team_id?.class_id?.subject_id
        }));
        console.log(`      - Student ${studentId}: thuộc ${teams.length} team(s)`, JSON.stringify(teams, null, 2));
      });
      
      return res.status(400).json({
        error: 'Các thành viên không thuộc cùng một nhóm (team). Mỗi sinh viên có thể thuộc nhiều lớp/team khác nhau, nhưng để tạo project thì tất cả phải thuộc cùng một team.',
        found_teams: allTeamIds.length,
        team_ids: allTeamIds,
        students_teams: Object.entries(teamMembersByStudent).map(([studentId, members]) => ({
          student_id: studentId,
          teams: members.map(m => ({
            team_id: m.team_id?._id?.toString(),
            class_id: m.team_id?.class_id?._id?.toString(),
            class_name: m.team_id?.class_id?.name || m.team_id?.class_id?.class_code,
            subject_name: m.team_id?.class_id?.subjectName,
            semester: m.team_id?.class_id?.semester_id?.name || m.team_id?.class_id?.semester_id,
            subject: m.team_id?.class_id?.subject_id?.name || m.team_id?.class_id?.subject_id
          }))
        }))
      });
    }

    // Nếu có nhiều team chung, cần kiểm tra xem chúng có cùng lớp không
    // QUAN TRỌNG: Tất cả commonTeams phải thuộc CÙNG MỘT LỚP để đảm bảo project được tạo đúng lớp
    let selectedTeamId = commonTeams[0];
    
    if (commonTeams.length > 1) {
      console.log(`   ⚠️ [CreateProject] Có ${commonTeams.length} teams chung. Kiểm tra xem có cùng lớp không...`);
      
      // Lấy thông tin các team này (kèm class_id, semester_id, subject_id)
      const teamsInfo = await models.Team.find({ _id: { $in: commonTeams } })
        .populate({
          path: 'class_id',
          select: '_id semester_id subject_id'
        })
        .lean();
      
      // Nhóm teams theo lớp (class_id + semester_id + subject_id)
      const teamsByClass = {};
      teamsInfo.forEach(team => {
        const classId = team.class_id?._id?.toString();
        const semesterId = team.class_id?.semester_id?.toString() || team.class_id?.semester_id;
        const subjectId = team.class_id?.subject_id?.toString() || team.class_id?.subject_id || 'null';
        
        // Tạo key duy nhất cho mỗi lớp (class_id + semester_id + subject_id)
        const classKey = `${classId}_${semesterId}_${subjectId}`;
        
        if (!teamsByClass[classKey]) {
          teamsByClass[classKey] = {
            class_id: classId,
            semester_id: semesterId,
            subject_id: subjectId,
            teams: []
          };
        }
        teamsByClass[classKey].teams.push({
          team_id: team._id.toString(),
          class_id: classId
        });
      });
      
      const classKeys = Object.keys(teamsByClass);
      
      if (classKeys.length > 1) {
        // Có teams từ nhiều lớp khác nhau - KHÔNG CHO PHÉP
        console.log(`   ❌ [CreateProject] Validation: Có ${commonTeams.length} teams chung nhưng thuộc ${classKeys.length} lớp khác nhau!`);
        return res.status(400).json({
          error: 'Các thành viên thuộc nhiều nhóm (team) ở các lớp khác nhau. Không thể xác định được lớp nào để tạo project. Vui lòng đảm bảo tất cả thành viên thuộc cùng một nhóm trong cùng một lớp.',
          found_teams: commonTeams.length,
          teams_by_class: Object.values(teamsByClass).map(group => ({
            class_id: group.class_id,
            semester_id: group.semester_id,
            subject_id: group.subject_id,
            team_count: group.teams.length,
            team_ids: group.teams.map(t => t.team_id)
          }))
        });
      }
      
      // Tất cả teams đều thuộc cùng một lớp - OK, chọn team đầu tiên
      console.log(`   ✅ [CreateProject] Tất cả ${commonTeams.length} teams đều thuộc cùng một lớp. Chọn team: ${selectedTeamId}`);
    }
    
    // Lọc TeamMember chỉ lấy những record thuộc team được chọn
    const teamMembers = allTeamMembers.filter(tm => tm.team_id?._id?.toString() === selectedTeamId);
    
    // Đảm bảo số lượng TeamMember = số lượng sinh viên (mỗi sinh viên chỉ có 1 record trong team này)
    if (teamMembers.length !== allStudentIds.length) {
      console.warn(`   ⚠️ [CreateProject] Số TeamMember (${teamMembers.length}) khác số sinh viên (${allStudentIds.length}). Có thể có duplicate.`);
    }
    
    console.log(`   ✅ [CreateProject] Đã chọn team: ${selectedTeamId} với ${teamMembers.length} TeamMember records`);

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
    const queryConditions = {
      class_id: currentClassId,
      semester_id: currentSemesterId,
      members: { $in: allStudentIds }
    };
    
    // Nếu có subject_id thì thêm vào điều kiện (để phân biệt rõ hơn)
    if (currentSubjectId) {
      queryConditions.subject_id = currentSubjectId;
    }
    
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

    return res.status(201).json({
      message: '✅ Tạo Project thành công!',
      project: populatedProject
    });
  } catch (error) {
    console.error('createProject error:', error);
    return res.status(500).json({ error: error.message });
  }
};

const IntegrationService = require('../services/IntegrationService');

// GET /api/projects/my-project
// Dành cho STUDENT: xem Project đầu tiên của mình (backward compatibility)
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
    })
    .populate({
      path: 'team_id',
      select: 'class_id',
      populate: {
        path: 'class_id',
        select: '_id name class_code'
      }
    })
    .lean();

    if (!teamMember) {
      return res.json({ project: null });
    }

    // Lấy project từ teamMember (backward compatibility)
    const project = await models.Project.findById(teamMember.project_id)
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .populate('class_id', '_id name class_code subjectName')
      .populate('team_id', '_id project_name')
      .populate('semester_id', '_id name code')
      .populate('subject_id', '_id name code')
      .lean();

    if (!project) {
      return res.json({ project: null });
    }

    // ==========================================
    // LAZY SYNC LEADER FROM JIRA (Tự động đồng bộ Leader)
    // ==========================================
    // Chỉ thực hiện nếu project có jiraProjectKey
    if (project.jiraProjectKey) {
      try {
        // Lấy thông tin user hiện tại để mượn token
        const requestUser = await models.Student.findById(userId);
        const jiraIntegration = requestUser?.integrations?.jira;

        // Chỉ sync nếu user hiện tại ĐÃ link Jira (có token)
        if (jiraIntegration && jiraIntegration.accessToken && jiraIntegration.cloudId) {
          
          // Gọi Jira lấy info project (chạy ngầm, không await để tránh block response)
          // Tuy nhiên để đảm bảo data trả về là mới nhất, ta nên await nhưng bọc try-catch
          // để nếu lỗi sync thì vẫn trả về project cũ chứ không crash API.
          
          let projectInfo;
          let accessToken = jiraIntegration.accessToken;
          
          try {
            projectInfo = await IntegrationService.fetchJiraProjectInfo({
              accessToken: accessToken,
              cloudId: jiraIntegration.cloudId,
              projectKey: project.jiraProjectKey
            });
          } catch (jiraError) {
            const status = jiraError.response?.status;
            if (status === 410) {
              console.warn(`⚠️ Lazy Sync: Jira Project "${project.jiraProjectKey}" không còn tồn tại (410 Gone)`);
              project.jira_sync_warning = 'Jira project không còn tồn tại (410). GitHub và dữ liệu khác vẫn dùng bình thường.';
              projectInfo = null;
            } else if ((status === 401 || status === 403) && jiraIntegration.refreshToken) {
              const clientId = process.env.ATLASSIAN_CLIENT_ID;
              const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
              if (!clientId || !clientSecret) {
                console.warn('⚠️ Lazy Sync: Thiếu ATLASSIAN_CLIENT_ID hoặc ATLASSIAN_CLIENT_SECRET (env). Không thể refresh token Jira.');
              } else {
                try {
                  const refreshed = await IntegrationService.refreshAtlassianAccessToken({
                    clientId,
                    clientSecret,
                    refreshToken: jiraIntegration.refreshToken
                  });

                  // Cập nhật token mới vào DB
                  requestUser.integrations.jira.accessToken = refreshed.accessToken;
                  if (refreshed.refreshToken) {
                    requestUser.integrations.jira.refreshToken = refreshed.refreshToken;
                  }
                  await requestUser.save();

                  // Thử lại với token mới
                  accessToken = refreshed.accessToken;
                  projectInfo = await IntegrationService.fetchJiraProjectInfo({
                    accessToken: accessToken,
                    cloudId: jiraIntegration.cloudId,
                    projectKey: project.jiraProjectKey
                  });

                  console.log('🔄 Lazy Sync: Đã refresh token Jira thành công');
                } catch (refreshError) {
                  // 400/401/404 = refresh token hết hạn hoặc bị thu hồi -> user cần reconnect Jira
                  const refreshStatus = refreshError.status || refreshError.response?.status;
                  console.warn('⚠️ Lazy Sync: Không thể refresh token Jira:', refreshError.message, refreshStatus ? `(HTTP ${refreshStatus})` : '');
                  throw jiraError; // Throw lại lỗi gốc
                }
              }
            } else {
              throw jiraError; // Throw lại nếu không phải lỗi 401 hoặc không có refreshToken
            }
          }

          if (projectInfo && projectInfo.lead && projectInfo.lead.accountId) {
            const jiraLeadAccountId = projectInfo.lead.accountId;
            
            // Tìm user trong DB có accountId này
            const newLeaderUser = await models.Student.findOne({
              'integrations.jira.jiraAccountId': jiraLeadAccountId
            });

            // Nếu tìm thấy user và user này KHÁC leader hiện tại của project
            // project.leader_id đã được populate nên là object, cần kiểm tra null
            const currentLeaderId = project.leader_id?._id?.toString() || project.leader_id?.toString();
            if (newLeaderUser && currentLeaderId && newLeaderUser._id.toString() !== currentLeaderId) {
              console.log(`🔄 Lazy Sync: Phát hiện Leader thay đổi từ Jira (${projectInfo.lead.displayName}) -> Cập nhật DB...`);
              
              // 1. Update Project Leader
              await models.Project.updateOne(
                { _id: project._id },
                { leader_id: newLeaderUser._id }
              );

              // 2. Update TeamMember Roles
              // Tìm team của project này (thông qua teamMember hiện tại hoặc project.team_id)
              const teamId = teamMember?.team_id?._id || teamMember?.team_id || project.team_id;
              
              if (teamId) {
                // Reset tất cả thành Member
                await models.TeamMember.updateMany(
                  { team_id: teamId, is_active: true },
                  { role_in_team: 'Member' }
                );

                // Set Leader mới
                await models.TeamMember.updateOne(
                  { team_id: teamId, student_id: newLeaderUser._id, is_active: true },
                  { role_in_team: 'Leader' }
                );
              }

              // Cập nhật lại biến project để trả về data mới nhất cho FE
              project.leader_id = newLeaderUser; // Gán object user mới vào
              console.log('✅ Lazy Sync: Đã cập nhật Leader thành công!');
            }
          }
        }
      } catch (syncError) {
        // Lỗi sync (ví dụ token hết hạn, mạng lag...) -> Chỉ log, không làm fail API chính
        console.warn('⚠️ Lazy Sync Leader Warning:', syncError.message);
      }
    }
    // ==========================================
    // END LAZY SYNC
    // ==========================================

    return res.json({ project });
  } catch (error) {
    console.error('getMyProject error:', error);
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
      .populate('class_id', '_id name class_code subjectName')
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

