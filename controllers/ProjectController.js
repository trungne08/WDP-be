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
    const allTeamMembers = await models.TeamMember.find({
      student_id: { $in: allStudentIds },
      is_active: true
    })
    .populate({
      path: 'team_id',
      select: 'class_id',
      populate: {
        path: 'class_id',
        select: '_id name'
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
      // Log chi tiết để debug
      Object.entries(teamMembersByStudent).forEach(([studentId, members]) => {
        const teams = members.map(m => ({
          team_id: m.team_id?._id?.toString(),
          class_id: m.team_id?.class_id?._id?.toString(),
          class_name: m.team_id?.class_id?.name
        }));
        console.log(`      - Student ${studentId}: thuộc ${teams.length} team(s)`, teams);
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
            class_name: m.team_id?.class_id?.name
          }))
        }))
      });
    }

    // Nếu có nhiều team chung (hiếm khi xảy ra, nhưng có thể do data lỗi)
    if (commonTeams.length > 1) {
      console.log(`   ⚠️ [CreateProject] Có ${commonTeams.length} teams chung. Chọn team đầu tiên: ${commonTeams[0]}`);
      // Kiểm tra xem các team này có cùng lớp không (nếu không thì có vấn đề về data)
      const teamsInfo = await models.Team.find({ _id: { $in: commonTeams } })
        .select('class_id')
        .lean();
      const classIds = Array.from(new Set(teamsInfo.map(t => t.class_id?.toString()).filter(Boolean)));
      if (classIds.length > 1) {
        console.warn(`   ⚠️ [CreateProject] CẢNH BÁO: Có ${commonTeams.length} teams chung nhưng thuộc ${classIds.length} lớp khác nhau! Có thể do data lỗi.`);
      }
    }

    // Chọn team chung (nếu có nhiều thì chọn team đầu tiên)
    const selectedTeamId = commonTeams[0];
    
    // Lọc TeamMember chỉ lấy những record thuộc team được chọn
    const teamMembers = allTeamMembers.filter(tm => tm.team_id?._id?.toString() === selectedTeamId);
    
    // Đảm bảo số lượng TeamMember = số lượng sinh viên (mỗi sinh viên chỉ có 1 record trong team này)
    if (teamMembers.length !== allStudentIds.length) {
      console.warn(`   ⚠️ [CreateProject] Số TeamMember (${teamMembers.length}) khác số sinh viên (${allStudentIds.length}). Có thể có duplicate.`);
    }
    
    console.log(`   ✅ [CreateProject] Đã chọn team: ${selectedTeamId} với ${teamMembers.length} TeamMember records`);

    // 3) Lấy thông tin team hiện tại (để lấy class_id)
    const currentTeam = await models.Team.findById(selectedTeamId)
      .populate({
        path: 'class_id',
        select: 'lecturer_id _id'
      })
      .lean();
    
    if (!currentTeam || !currentTeam.class_id) {
      return res.status(400).json({
        error: 'Không tìm thấy thông tin lớp học của nhóm này.'
      });
    }

    const currentClassId = currentTeam.class_id._id.toString();
    const lecturerId = currentTeam.class_id.lecturer_id || null;

    // 4) Validate: Kiểm tra xem member có project ở CÙNG LỚP không (khác lớp thì OK)
    const membersWithProject = teamMembers.filter(tm => tm.project_id);
    if (membersWithProject.length > 0) {
      // Lấy tất cả project_id của các member có project
      const existingProjectIds = Array.from(new Set(
        membersWithProject.map(tm => tm.project_id.toString())
      ));

      // Tìm các TeamMember có project_id này để lấy team_id -> class_id
      const otherTeamMembers = await models.TeamMember.find({
        project_id: { $in: existingProjectIds },
        is_active: true
      })
        .select('team_id project_id')
        .lean();

      // Lấy team_id từ các member này
      const otherTeamIds = Array.from(new Set(
        otherTeamMembers.map(tm => tm.team_id.toString())
      ));

      // Lấy thông tin các team đó để so sánh class_id
      const otherTeams = await models.Team.find({
        _id: { $in: otherTeamIds }
      })
        .select('class_id')
        .lean();

      // Kiểm tra xem có project nào thuộc CÙNG LỚP không
      const conflictedInSameClass = otherTeams.some(team => 
        team.class_id && team.class_id.toString() === currentClassId
      );

      if (conflictedInSameClass) {
        // Tìm các member bị conflict (cùng lớp)
        const conflictedMembers = membersWithProject.filter(tm => {
          // Tìm team của project này
          const projectTeamMember = otherTeamMembers.find(
            otm => otm.project_id && otm.project_id.toString() === tm.project_id.toString()
          );
          if (!projectTeamMember) return false;
          
          const projectTeam = otherTeams.find(
            t => t._id.toString() === projectTeamMember.team_id.toString()
          );
          return projectTeam && projectTeam.class_id && 
                 projectTeam.class_id.toString() === currentClassId;
        });

        return res.status(400).json({
          error: 'Một số thành viên đã có Project ở lớp này. Mỗi sinh viên chỉ được có 1 Project trong 1 lớp.',
          conflicted_members: conflictedMembers.map(tm => ({
            team_member_id: tm._id,
            student_id: tm.student_id,
            project_id: tm.project_id
          }))
        });
      }
      // Nếu project cũ thuộc lớp khác -> Cho phép tạo project mới ở lớp này
    }

    // 5) Tạo Project
    const project = await models.Project.create({
      name,
      leader_id: userId,
      lecturer_id: lecturerId,
      members: allStudentIds,
      githubRepoUrl: githubRepoUrl,
      jiraProjectKey: jiraProjectKey
    });
    
    console.log(`✅ [CreateProject] Đã tạo project "${name}" với GitHub: ${githubRepoUrl || '(không có)'}, Jira: ${jiraProjectKey || '(không có)'}`);

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

    const project = await models.Project.findById(teamMember.project_id)
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .lean();

    if (!project) {
      return res.json({ project: null });
    }

    // Thêm thông tin lớp vào project
    project.class = teamMember.team_id?.class_id || null;

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
              try {
                const IntegrationService = require('../services/IntegrationService');
                const clientId = process.env.ATLASSIAN_CLIENT_ID;
                const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
                
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
                console.warn('⚠️ Lazy Sync: Không thể refresh token Jira:', refreshError.message);
                throw jiraError; // Throw lại lỗi gốc
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
            if (newLeaderUser && newLeaderUser._id.toString() !== project.leader_id._id.toString()) {
              console.log(`🔄 Lazy Sync: Phát hiện Leader thay đổi từ Jira (${projectInfo.lead.displayName}) -> Cập nhật DB...`);
              
              // 1. Update Project Leader
              await models.Project.updateOne(
                { _id: project._id },
                { leader_id: newLeaderUser._id }
              );

              // 2. Update TeamMember Roles
              // Tìm team của project này (thông qua teamMember hiện tại)
              const teamId = teamMember.team_id;
              
              // Reset tất cả thành Member
              await models.TeamMember.updateMany(
                { team_id: teamId },
                { role_in_team: 'Member' }
              );

              // Set Leader mới
              await models.TeamMember.updateOne(
                { team_id: teamId, student_id: newLeaderUser._id },
                { role_in_team: 'Leader' }
              );

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

    // Tìm TẤT CẢ TeamMember của sinh viên có project_id khác null
    const teamMembers = await models.TeamMember.find({
      student_id: userId,
      is_active: true,
      project_id: { $ne: null }
    })
    .populate({
      path: 'team_id',
      select: 'class_id',
      populate: {
        path: 'class_id',
        select: '_id name class_code subjectName'
      }
    })
    .lean();

    if (teamMembers.length === 0) {
      return res.json({ 
        total: 0,
        projects: []
      });
    }

    // Lấy tất cả project_id (unique)
    const projectIds = Array.from(new Set(
      teamMembers.map(tm => tm.project_id.toString())
    ));

    // Lấy tất cả projects
    const projects = await models.Project.find({ _id: { $in: projectIds } })
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .lean();

    // Gắn thông tin lớp vào từng project
    const projectsWithClass = projects.map(project => {
      // Tìm TeamMember có project_id này để lấy class_id
      const teamMember = teamMembers.find(tm => tm.project_id.toString() === project._id.toString());
      return {
        ...project,
        class: teamMember?.team_id?.class_id || null,
        team_id: teamMember?.team_id?._id || null
      };
    });

    return res.json({
      total: projectsWithClass.length,
      projects: projectsWithClass
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

    // Tìm TeamMember có project_id của team này
    const teamMemberWithProject = await models.TeamMember.findOne({
      team_id: teamId,
      is_active: true,
      project_id: { $ne: null }
    }).lean();

    if (!teamMemberWithProject) {
      return res.json({ 
        team: {
          _id: team._id,
          class: team.class_id
        },
        project: null
      });
    }

    // Lấy project
    const project = await models.Project.findById(teamMemberWithProject.project_id)
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
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
    } else if (role === 'LECTURER') {
      // Lecturer chỉ xem được lớp của mình
      if (classInfo.lecturer_id?.toString() !== userId.toString()) {
        return res.status(403).json({ error: 'Bạn không phải giảng viên của lớp này' });
      }
    }

    // Lấy tất cả team thuộc lớp này
    const teams = await models.Team.find({ class_id: classId }).select('_id').lean();
    const teamIds = teams.map(t => t._id);

    if (teamIds.length === 0) {
      return res.json({ 
        class: {
          _id: classInfo._id,
          name: classInfo.name,
          class_code: classInfo.class_code
        },
        total: 0,
        projects: []
      });
    }

    // Lấy TeamMember của các team này có project_id khác null
    const teamMembers = await models.TeamMember.find({
      team_id: { $in: teamIds },
      is_active: true,
      project_id: { $ne: null }
    })
    .select('project_id team_id')
    .lean();

    if (teamMembers.length === 0) {
      return res.json({ 
        class: {
          _id: classInfo._id,
          name: classInfo.name,
          class_code: classInfo.class_code
        },
        total: 0,
        projects: []
      });
    }

    const projectIds = Array.from(new Set(teamMembers.map(tm => tm.project_id.toString())));

    // Lấy Project + populate leader/members
    const projects = await models.Project.find({ _id: { $in: projectIds } })
      .populate('leader_id', 'student_code email full_name avatar_url')
      .populate('lecturer_id', 'email full_name avatar_url')
      .populate('members', 'student_code email full_name avatar_url')
      .lean();

    // Gắn team_id vào từng project
    const projectsWithTeam = projects.map(project => {
      const teamMember = teamMembers.find(tm => tm.project_id.toString() === project._id.toString());
      return {
        ...project,
        team_id: teamMember?.team_id || null
      };
    });

    return res.json({
      class: {
        _id: classInfo._id,
        name: classInfo.name,
        class_code: classInfo.class_code
      },
      total: projectsWithTeam.length,
      projects: projectsWithTeam
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

