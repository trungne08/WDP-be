const mongoose = require('mongoose');
const Class = require('../models/Class');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const { SprintAssessment } = require('../models/Assessment');
const { JiraTask } = require('../models/JiraData'); 
const GithubCommit = require('../models/GitData');

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

// ==========================================
// 📊 API DASHBOARD: CHI TIẾT TỪNG NHÓM (TEAM)
// ==========================================
exports.getTeamDashboardOverview = async (req, res) => {
    try {
        const { teamId } = req.params;

        // 1. Lấy thông tin Team & Members
        const team = await Team.findById(teamId).populate('class_id').lean();
        if (!team) return res.status(404).json({ error: 'Không tìm thấy Nhóm.' });

        const members = await TeamMember.find({ team_id: teamId, is_active: true })
            .populate('student_id', 'student_code full_name email avatar_url')
            .lean();

        if (members.length === 0) return res.json({ message: "Nhóm chưa có thành viên.", data: null });

        // ==========================================
        // 🚨 CHẶN CỬA BẢO MẬT (AUTHORIZATION)
        // ==========================================
        if (req.role === 'STUDENT') {
            // Nếu là sinh viên -> Phải nằm trong nhóm này VÀ phải là Leader
            const isLeader = members.find(
                m => m.student_id?._id.toString() === req.user._id.toString() && m.role_in_team === 'Leader'
            );
            if (!isLeader) {
                return res.status(403).json({ error: 'Chỉ Nhóm trưởng (Leader) hoặc Giảng viên mới được xem Dashboard này.' });
            }
        } else if (req.role === 'LECTURER') {
            // Nếu là giảng viên -> Phải là người dạy lớp này
            if (team.class_id?.lecturer_id?.toString() !== req.user._id.toString()) {
                return res.status(403).json({ error: 'Bạn không có quyền xem nhóm của lớp khác.' });
            }
        }

        // 2. QUERY SONG SONG: Lấy điểm chốt, Đếm Commit, Đếm Task (Siêu tối ưu tốc độ)
        const teamObjectId = new mongoose.Types.ObjectId(teamId);
        
        const [assessments, commitCountsAgg, taskCountsAgg] = await Promise.all([
            SprintAssessment.find({ member_id: { $in: members.map(m => m._id) } }).lean(),
            
            // Đếm tổng số Commit của từng email
            GithubCommit.aggregate([
                { $match: { team_id: teamObjectId, author_email: { $ne: null } } },
                { $group: { _id: { $toLower: "$author_email" }, total_commits: { $sum: 1 } } }
            ]),

            // Đếm tổng số Task Jira của từng người
            JiraTask.aggregate([
                { $match: { team_id: teamObjectId } },
                { $group: { _id: "$assignee_id", total_tasks: { $sum: 1 } } }
            ])
        ]);

        // Map kết quả đếm ra object cho dễ dò
        const commitMap = {};
        commitCountsAgg.forEach(c => { commitMap[c._id] = c.total_commits; });

        const taskMap = {};
        taskCountsAgg.forEach(t => { if (t._id) taskMap[t._id.toString()] = t.total_tasks; });

        // 3. TÍNH SỨC KHỎE DỰ ÁN (PROJECT HEALTH)
        let totalJiraSP = 0;
        let totalGitScore = 0;
        let totalReview = 0;
        
        // Tổng số lượng đếm được
        let teamTotalCommits = 0;
        let teamTotalTasks = 0;

        members.forEach(m => {
            totalJiraSP += (m.scores?.jira_score || 0);
            totalGitScore += (m.scores?.commit_score || 0);
            totalReview += (m.scores?.review_score || 0);

            const email = m.student_id?.email?.toLowerCase()?.trim() || '';
            teamTotalCommits += (commitMap[email] || 0);
            teamTotalTasks += (taskMap[m._id.toString()] || 0);
        });

        // 4. MỔ XẺ CHI TIẾT TỪNG THÀNH VIÊN
        const membersBreakdown = members.map(m => {
            const mId = m._id.toString();
            const email = m.student_id?.email?.toLowerCase()?.trim() || '';
            
            const assessment = assessments.find(a => a.member_id.toString() === mId);
            const rawJira = m.scores?.jira_score || 0;
            const rawGit = m.scores?.commit_score || 0;
            const rawReview = m.scores?.review_score || 0;

            const myCommits = commitMap[email] || 0;
            const myTasks = taskMap[mId] || 0;

            // Tính % đóng góp
            const pJira = totalJiraSP > 0 ? (rawJira / totalJiraSP) : (1 / members.length);
            const pGit = totalGitScore > 0 ? (rawGit / totalGitScore) : (1 / members.length);
            const pReview = totalReview > 0 ? (rawReview / totalReview) : (1 / members.length);

            return {
                student_id: m.student_id?._id,
                student_code: m.student_id?.student_code,
                full_name: m.student_id?.full_name,
                avatar_url: m.student_id?.avatar_url,
                role: m.role_in_team,
                
                // FE sẽ sướng rơn với cục raw_counts này
                raw_counts: {
                    total_commits: myCommits,
                    total_jira_tasks: myTasks
                },

                raw_scores: {
                    jira_sp_done: rawJira,
                    git_ai_score: rawGit,
                    peer_review_score: rawReview
                },
                contribution_percentages: {
                    jira_percent: Number((pJira * 100).toFixed(1)),
                    git_percent: Number((pGit * 100).toFixed(1)),
                    review_percent: Number((pReview * 100).toFixed(1))
                },
                grading: {
                    contribution_factor: assessment?.contribution_factor || 0,
                    final_score: assessment?.final_score || 0
                }
            };
        });

        membersBreakdown.sort((a, b) => b.grading.contribution_factor - a.grading.contribution_factor);

        // 5. TRẢ VỀ JSON CHUẨN MỰC
        return res.status(200).json({
            message: "Lấy dữ liệu Dashboard Nhóm thành công!",
            team_info: {
                team_id: team._id,
                project_name: team.project_name || `Nhóm ${team.team_name || ''}`,
                class_name: team.class_id?.class_name || '',
                member_count: members.length
            },
            project_health: {
                total_jira_sp_done: totalJiraSP,
                total_git_ai_score: totalGitScore,
                average_peer_review: members.length > 0 ? Number((totalReview / members.length).toFixed(1)) : 0,
                
                // MỚI: Tổng cộng số lượng của cả Team
                team_total_commits: teamTotalCommits,
                team_total_tasks: teamTotalTasks
            },
            members_breakdown: membersBreakdown
        });

    } catch (error) {
        console.error("❌ Lỗi API getTeamDashboardOverview:", error);
        return res.status(500).json({ error: "Lỗi Server khi lấy dữ liệu Dashboard Nhóm." });
    }
};