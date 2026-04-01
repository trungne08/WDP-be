const mongoose = require('mongoose');
const Class = require('../models/Class');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const { SprintAssessment } = require('../models/Assessment');
const { JiraTask } = require('../models/JiraData'); 
const GithubCommit = require('../models/GitData');
const { pickMemberForCommit, resolveGithubUsernameForMember } = require('../utils/commitUtils');
const PeerReview = require('../models/PeerReview');
const Admin = require('../models/Admin');
const Lecturer = require('../models/Lecturer');
const Student = require('../models/Student');
const Subject = require('../models/Subject'); 
const Semester = require('../models/Semester');

exports.getAdminDashboardOverview = async (req, res) => {
    try {
        if (req.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Truy cập bị từ chối. Chỉ Quản trị viên (Admin) mới được xem Dashboard này.' });
        }

        // 2. QUERY SONG SONG THEO ĐÚNG SCHEMA
        const [
            currentSemester,
            totalSubjects,
            totalClasses,
            totalAdmins,
            totalLecturers,
            totalStudents
        ] = await Promise.all([
            // SỬA: Tìm theo status: 'Open' (khớp với enum trong Semester.js)
            Semester.findOne({ status: 'Open' }).lean(), 
            
            // SỬA: Chỉ đếm những môn và lớp đang Active
            Subject.countDocuments({ status: 'Active' }),                      
            Class.countDocuments({ status: 'Active' }),                        
            
            // Đếm người dùng
            Admin.countDocuments(),                        
            Lecturer.countDocuments(),                     
            Student.countDocuments()                       
        ]);

        const totalUsers = totalAdmins + totalLecturers + totalStudents;

        return res.status(200).json({
            message: "Lấy dữ liệu Admin Dashboard thành công!",
            data: {
                current_semester: currentSemester ? {
                    semester_id: currentSemester._id,
                    name: currentSemester.name, // Khớp với trường 'name' trong Semester.js
                    start_date: currentSemester.start_date,
                    end_date: currentSemester.end_date
                } : null,
                metrics: {
                    total_subjects: totalSubjects,
                    total_classes: totalClasses,
                    total_users: totalUsers
                },
                users_breakdown: {
                    admins: totalAdmins,
                    lecturers: totalLecturers,
                    students: totalStudents
                }
            }
        });

    } catch (error) {
        console.error("❌ Lỗi API getAdminDashboardOverview:", error);
        return res.status(500).json({ error: "Lỗi Server khi lấy dữ liệu Admin Dashboard." });
    }
};

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
        const teamObjectId = new mongoose.Types.ObjectId(teamId);

        // 1. Lấy thông tin Team & Members
        const team = await Team.findById(teamId).populate('class_id').lean();
        if (!team) return res.status(404).json({ error: 'Không tìm thấy Nhóm.' });

        const members = await TeamMember.find({ team_id: teamId, is_active: true })
            .populate('student_id', 'student_code full_name email avatar_url integrations git_emails')
            .lean();

        if (members.length === 0) return res.json({ message: "Nhóm chưa có thành viên.", data: null });

        // Phân quyền
        if (req.role === 'STUDENT') {
            const isLeader = members.find(
                m => m.student_id?._id.toString() === req.user._id.toString() && m.role_in_team === 'Leader'
            );
            if (!isLeader) return res.status(403).json({ error: 'Chỉ Nhóm trưởng hoặc Giảng viên mới được xem Dashboard.' });
        } else if (req.role === 'LECTURER') {
            if (team.class_id?.lecturer_id?.toString() !== req.user._id.toString()) {
                return res.status(403).json({ error: 'Bạn không có quyền xem nhóm của lớp khác.' });
            }
        }

        // ==========================================
        // 2. QUERY: Lấy nguyên cục Data để tự Map
        // ==========================================
        const [assessments, reviews, allCommits, jiraTasksAgg, jiraSpAgg] = await Promise.all([
            SprintAssessment.find({ member_id: { $in: members.map(m => m._id) } }).lean(),
            PeerReview.find({ team_id: teamId }).lean(),
            
            // 🔥 THAY ĐỔI LỚN NHẤT: Lấy toàn bộ commit của Team (Thay vì dùng Group)
            GithubCommit.find({ team_id: teamObjectId }).lean(),

            JiraTask.aggregate([
                { $match: { team_id: teamObjectId } },
                { $group: { _id: { $ifNull: ["$assignee_id", "$assignee_account_id"] }, total_tasks: { $sum: 1 } }}
            ]),

            JiraTask.aggregate([
                { $match: { 
                    team_id: teamObjectId,
                    $or: [
                        { status_category: /^(done|completed)$/i },
                        { status_name: /(done|closed|complete|resolved|hoàn thành|đã xong|đóng)/i }
                    ]
                }},
                { $group: { _id: { $ifNull: ["$assignee_id", "$assignee_account_id"] }, total_sp_done: { $sum: { $ifNull: ["$story_point", 0] } } }}
            ])
        ]);

        // ==========================================
        // 3. TỔNG TEAM + commit hợp lệ (is_counted) — dùng cho điểm Git thang 10
        // ==========================================
        let teamTotalCommits = allCommits.length;
        let teamApprovedCommits = 0;
        let teamTotalGit = 0;

        allCommits.forEach((c) => {
            if (c.is_counted) teamApprovedCommits++;
            if (c.ai_score) teamTotalGit += c.ai_score;
        });
        const totalTeamValidCommits = teamApprovedCommits;

        let teamTotalTasks = 0, teamTotalSp = 0;
        const jiraTaskMap = {}, jiraSpMap = {};
        
        jiraTasksAgg.forEach(j => { 
            if (j._id) jiraTaskMap[j._id.toString()] = j.total_tasks; 
            teamTotalTasks += j.total_tasks; 
        });
        jiraSpAgg.forEach((j) => {
            teamTotalSp += Number(j.total_sp_done) || 0;
            if (j._id != null && j._id !== '') {
                jiraSpMap[j._id.toString()] = j.total_sp_done;
            }
        });

        const reviewStats = {};
        let totalReviewGroup = 0;
        reviews.forEach(r => {
            const eId = r.evaluated_id?.toString();
            if (eId && r.rating) {
                if (!reviewStats[eId]) reviewStats[eId] = { total: 0, count: 0 };
                reviewStats[eId].total += r.rating;
                reviewStats[eId].count += 1;
                totalReviewGroup += r.rating;
            }
        });

        // Gán mỗi commit đúng một member (pickMemberForCommit — đồng bộ ranking / getTeamCommits)
        const commitStatsByMemberId = new Map();
        for (const m of members) {
            commitStatsByMemberId.set(m._id.toString(), { total: 0, approved: 0, aiScoreSum: 0 });
        }
        for (const c of allCommits) {
            const winner = pickMemberForCommit(c, members);
            if (!winner) continue;
            const k = winner._id.toString();
            const s = commitStatsByMemberId.get(k);
            if (!s) continue;
            s.total += 1;
            if (c.is_counted) s.approved += 1;
            if (c.ai_score) s.aiScoreSum += Number(c.ai_score) || 0;
        }

        // ==========================================
        // 4. MỔ XẺ CHI TIẾT TỪNG THÀNH VIÊN
        // ==========================================
        const membersBreakdown = members.map((m) => {
            const mId = m._id.toString();
            const jiraAccId =
                (m.jira_account_id || m.student_id?.integrations?.jira?.jiraAccountId || '').toString();
            const stats = commitStatsByMemberId.get(mId) || { total: 0, approved: 0, aiScoreSum: 0 };
            const myTotalCommits = stats.total;
            const myApprovedCommits = stats.approved;
            const personalValidCommits = myApprovedCommits;
            const gitScore =
                totalTeamValidCommits > 0
                    ? (personalValidCommits / totalTeamValidCommits) * 10
                    : 0;

            // Khớp Jira
            const myJiraTasks = jiraTaskMap[mId] || (jiraAccId ? jiraTaskMap[jiraAccId] : 0) || 0;
            const myJiraSp = jiraSpMap[mId] || (jiraAccId ? jiraSpMap[jiraAccId] : 0) || 0;
            const jiraScore = teamTotalSp > 0 ? (myJiraSp / teamTotalSp) * 10 : 0;

            const myReview = reviewStats[mId] || { total: 0, count: 0 };
            const avgStar = myReview.count > 0 ? myReview.total / myReview.count : 0;
            const assessment = assessments.find((a) => a.member_id.toString() === mId);

            const pJira = teamTotalSp > 0 ? myJiraSp / teamTotalSp : 1 / members.length;
            const pGit =
                totalTeamValidCommits > 0 ? personalValidCommits / totalTeamValidCommits : 1 / members.length;
            const pReview =
                totalReviewGroup > 0 ? (avgStar * myReview.count) / totalReviewGroup : 1 / members.length;

            const ghUserResolved = resolveGithubUsernameForMember(m);

            return {
                student_id: m.student_id?._id,
                student_code: m.student_id?.student_code,
                full_name: m.student_id?.full_name,
                avatar_url: m.student_id?.avatar_url,
                role: m.role_in_team,
                github_username: ghUserResolved,
                raw_counts: {
                    total_commits: myTotalCommits,
                    approved_commits: myApprovedCommits,
                    personal_valid_commits: personalValidCommits,
                    total_jira_tasks: myJiraTasks
                },
                raw_scores: {
                    jira_sp_done: myJiraSp,
                    jira_score: Number(jiraScore.toFixed(2)),
                    git_score: Number(gitScore.toFixed(2)),
                    git_ai_score: Number(gitScore.toFixed(2)),
                    git_ai_score_sum: Number((stats.aiScoreSum || 0).toFixed(2)),
                    peer_review_score: Number(avgStar.toFixed(2))
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

        return res.status(200).json({
            message: "Lấy dữ liệu Dashboard Nhóm thành công!",
            team_info: {
                team_id: team._id,
                project_name: team.project_name || `Nhóm ${team.team_name || ''}`,
                class_name: team.class_id?.class_name || team.class_id?.name || '', 
                member_count: members.length
            },
            project_health: {
                total_jira_sp_done: teamTotalSp,
                total_git_ai_score: Number(teamTotalGit.toFixed(2)),
                total_team_valid_commits: totalTeamValidCommits,
                average_peer_review: members.length > 0 ? Number((totalReviewGroup / members.length).toFixed(1)) : 0,
                team_total_commits: teamTotalCommits,
                team_approved_commits: teamApprovedCommits,
                team_total_tasks: teamTotalTasks
            },
            members_breakdown: membersBreakdown
        });

    } catch (error) {
        console.error("❌ Lỗi API getTeamDashboard:", error);
        return res.status(500).json({ error: error.message });
    }
};