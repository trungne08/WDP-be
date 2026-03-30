const mongoose = require('mongoose');
const Class = require('../models/Class');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const { SprintAssessment } = require('../models/Assessment');

exports.getClassDashboardOverview = async (req, res) => {
    try {
        const { classId } = req.params;

        // 1. Kiểm tra Lớp học và Phân quyền
        const targetClass = await Class.findById(classId);
        if (!targetClass) {
            return res.status(404).json({ error: 'Không tìm thấy lớp học.' });
        }

        // Chỉ Giảng viên dạy lớp này hoặc Admin mới được xem
        if (req.role === 'LECTURER' && targetClass.lecturer_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Từ chối truy cập. Bạn không quản lý lớp này.' });
        }

        // 2. Fetch toàn bộ dữ liệu (Teams, Members, Assessments)
        const teams = await Team.find({ class_id: classId }).lean();
        const teamIds = teams.map(t => t._id);

        if (teamIds.length === 0) {
            return res.json({ message: "Lớp học chưa có nhóm nào.", data: null });
        }

        const members = await TeamMember.find({ team_id: { $in: teamIds }, is_active: true })
            .populate('student_id', 'student_code full_name email avatar_url')
            .lean();
        
        const memberIds = members.map(m => m._id);
        const assessments = await SprintAssessment.find({ member_id: { $in: memberIds } }).lean();

        // ==========================================
        // 3. XỬ LÝ CHỈ SỐ: TỔNG QUAN (OVERVIEW)
        // ==========================================
        const totalTeams = teams.length;
        const totalStudents = members.length;
        
        let totalClassScore = 0;
        let gradedStudentsCount = 0;
        const gradeDistribution = { excellent: 0, good: 0, average: 0, poor: 0 }; // Giỏi, Khá, TB, Yếu

        assessments.forEach(a => {
            if (a.final_score !== undefined && a.final_score !== null) {
                totalClassScore += a.final_score;
                gradedStudentsCount++;

                // Phân bổ phổ điểm
                if (a.final_score >= 8.0) gradeDistribution.excellent++;
                else if (a.final_score >= 6.5) gradeDistribution.good++;
                else if (a.final_score >= 5.0) gradeDistribution.average++;
                else gradeDistribution.poor++;
            }
        });

        const averageClassGrade = gradedStudentsCount > 0 
            ? Number((totalClassScore / gradedStudentsCount).toFixed(2)) 
            : 0;

        // ==========================================
        // 4. XỬ LÝ CHỈ SỐ: ĐỘI NHÓM & LEADERBOARD
        // ==========================================
        const teamStatsMap = {}; // Lưu tổng điểm Tech của từng team
        const ghostStudents = []; // Sinh viên không có dòng code / task nào
        let syncedTeamsCount = 0;

        teams.forEach(t => {
            teamStatsMap[t._id.toString()] = {
                team_id: t._id,
                project_name: t.project_name || `Nhóm ${t.team_name || 'Unkown'}`,
                total_jira_sp: 0,
                total_git_score: 0,
                is_synced: false // Check xem team có hoạt động không
            };
        });

        members.forEach(m => {
            const tId = m.team_id.toString();
            const jScore = m.scores?.jira_score || 0;
            const gScore = m.scores?.commit_score || 0;

            if (teamStatsMap[tId]) {
                teamStatsMap[tId].total_jira_sp += jScore;
                teamStatsMap[tId].total_git_score += gScore;
                
                // Nếu có bất kỳ data nào > 0 thì coi như Team đã Sync thành công
                if (jScore > 0 || gScore > 0) {
                    teamStatsMap[tId].is_synced = true;
                }
            }

            // Tìm "Bóng ma": Không có code, không có task
            if (jScore === 0 && gScore === 0) {
                ghostStudents.push({
                    student_id: m.student_id?._id,
                    student_code: m.student_id?.student_code,
                    full_name: m.student_id?.full_name,
                    team_name: teamStatsMap[tId]?.project_name
                });
            }
        });

        // Đếm số team đã có dữ liệu Sync
        Object.values(teamStatsMap).forEach(ts => {
            if (ts.is_synced) syncedTeamsCount++;
        });

        // Xếp hạng Nhóm: Top 3 nhóm code đỉnh nhất (theo AI Score)
        const topTeamsByCode = Object.values(teamStatsMap)
            .sort((a, b) => b.total_git_score - a.total_git_score)
            .slice(0, 3)
            .map(t => ({
                project_name: t.project_name,
                ai_score: t.total_git_score
            }));

        // Xếp hạng Nhóm: Top 3 nhóm quản lý Task tốt nhất (theo Jira SP)
        const topTeamsByTask = Object.values(teamStatsMap)
            .sort((a, b) => b.total_jira_sp - a.total_jira_sp)
            .slice(0, 3)
            .map(t => ({
                project_name: t.project_name,
                story_points: t.total_jira_sp
            }));

        // Xếp hạng Cá nhân: Gánh team (Dựa trên Hệ số Factor cao nhất từ bảng Assessment)
        // Nếu chưa chốt điểm thì mảng này sẽ rỗng
        const topContributors = assessments
            .sort((a, b) => (b.contribution_factor || 0) - (a.contribution_factor || 0))
            .slice(0, 5)
            .map(a => {
                const member = members.find(m => m._id.toString() === a.member_id.toString());
                return {
                    full_name: member?.student_id?.full_name,
                    team_name: teamStatsMap[member?.team_id.toString()]?.project_name,
                    factor: a.contribution_factor,
                    final_score: a.final_score
                };
            }).filter(item => item.full_name); // Lọc bỏ trường hợp rỗng

        // ==========================================
        // 5. TRẢ VỀ JSON CHO FRONTEND
        // ==========================================
        return res.status(200).json({
            message: "Lấy dữ liệu Dashboard Lớp học thành công!",
            overview: {
                total_teams: totalTeams,
                total_students: totalStudents,
                synced_teams_ratio: `${syncedTeamsCount}/${totalTeams}`,
                average_class_grade: averageClassGrade,
                is_graded: gradedStudentsCount > 0 // Cờ báo hiệu cho UI biết lớp này đã chấm điểm chưa
            },
            distribution: {
                excellent: gradeDistribution.excellent, // >= 8.0
                good: gradeDistribution.good,           // 6.5 - 7.9
                average: gradeDistribution.average,     // 5.0 - 6.4
                poor: gradeDistribution.poor            // < 5.0
            },
            leaderboards: {
                top_teams_code: topTeamsByCode,
                top_teams_task: topTeamsByTask,
                top_individual_contributors: topContributors
            },
            alerts: {
                ghost_students_count: ghostStudents.length,
                ghost_students_list: ghostStudents,
                inactive_teams: Object.values(teamStatsMap).filter(t => !t.is_synced).map(t => t.project_name)
            }
        });

    } catch (error) {
        console.error("❌ Lỗi API getClassDashboardOverview:", error);
        return res.status(500).json({ error: "Lỗi Server khi lấy dữ liệu Dashboard." });
    }
};