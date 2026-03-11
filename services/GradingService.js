const { Sprint, JiraTask } = require('../models/JiraData');
const GithubCommit = require('../models/GitData');
const { PeerReview, SprintAssessment } = require('../models/Assessment');
const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');

/**
 * Tính toán điểm đóng góp và điểm cá nhân cho một Sprint/Assignment
 * @param {string} teamId - ID của Nhóm
 * @param {string} sprintId - ID của Sprint (Assignment)
 * @param {number} groupGrade - Điểm nhóm do giảng viên chấm (Hệ 10)
 */
const calculateSprintGrades = async (teamId, sprintId, groupGrade = 10) => {
    // 1. Lấy thông tin Team, Config của Lớp và Sprint
    const team = await Team.findById(teamId).populate('class_id');
    const sprint = await Sprint.findById(sprintId);
    if (!team || !sprint) throw new Error('Không tìm thấy Nhóm hoặc Sprint');

    const config = team.class_id.contributionConfig || {
        jiraWeight: 0.4, gitWeight: 0.4, reviewWeight: 0.2, allowOverCeiling: false
    };

    // 2. Lấy danh sách thành viên đang active
    const members = await TeamMember.find({ team_id: teamId, is_active: true })
        .populate('student_id', 'email');
    const memberCount = members.length;
    if (memberCount === 0) return [];

    // Helper tính % (Nếu tổng = 0 thì chia đều để tránh chia cho 0)
    const calcPercent = (individual, total) => total === 0 ? (1 / memberCount) : (individual / total);

    // ==========================================
    // BƯỚC 1: TÍNH % JIRA (Dựa trên Story Points DONE)
    // ==========================================
    const jiraTasks = await JiraTask.find({ 
        team_id: teamId, 
        sprint_id: sprintId, 
        status_category: { $in: ['done', 'Done', 'green'] } // Tùy Jira config
    });

    let totalJiraSP = 0;
    const jiraMap = {}; // Lưu SP theo member_id
    
    jiraTasks.forEach(task => {
        if (task.assignee_id && task.story_point) {
            const mId = task.assignee_id.toString();
            jiraMap[mId] = (jiraMap[mId] || 0) + task.story_point;
            totalJiraSP += task.story_point;
        }
    });

    // ==========================================
    // BƯỚC 2: TÍNH % GIT (Commits hợp lệ trong khung thời gian)
    // ==========================================
    const gitQuery = { team_id: teamId, is_counted: true };
    if (sprint.start_date) gitQuery.commit_date = { $gte: sprint.start_date };
    if (sprint.end_date) gitQuery.commit_date.$lte = sprint.end_date;

    const commits = await GithubCommit.find(gitQuery);
    
    let totalGitCommits = 0;
    const gitMap = {}; // Lưu số commit theo email

    commits.forEach(commit => {
        if (commit.author_email) {
            const email = commit.author_email.toLowerCase();
            gitMap[email] = (gitMap[email] || 0) + 1;
            totalGitCommits += 1;
        }
    });

    // ==========================================
    // BƯỚC 3: TÍNH % REVIEW CHÉO
    // ==========================================
    // PeerReview schema dùng student_id làm evaluator/evaluated
    const reviews = await PeerReview.find({ team_id: teamId });
    
    let totalReviewScore = 0;
    const reviewMap = {}; // Lưu tổng rating nhận được theo student_id

    reviews.forEach(review => {
        if (review.evaluated_id && review.rating) {
            const sId = review.evaluated_id.toString();
            reviewMap[sId] = (reviewMap[sId] || 0) + review.rating;
            totalReviewScore += review.rating;
        }
    });

    // ==========================================
    // BƯỚC 4: TÍNH ĐIỂM TỔNG HỢP VÀ LƯU DATABASE
    // ==========================================
    const assessmentResults = [];

    for (const member of members) {
        const mId = member._id.toString();
        const studentId = member.student_id._id.toString();
        const studentEmail = member.student_id.email.toLowerCase();

        // 4.1 Lấy chỉ số cá nhân
        const myJiraSP = jiraMap[mId] || 0;
        const myGitCommits = gitMap[studentEmail] || gitMap[member.github_username?.toLowerCase()] || 0;
        const myReviewScore = reviewMap[studentId] || 0;

        // 4.2 Tính % đóng góp
        const pJira = calcPercent(myJiraSP, totalJiraSP);
        const pGit = calcPercent(myGitCommits, totalGitCommits);
        const pReview = calcPercent(myReviewScore, totalReviewScore);

        // 4.3 Áp dụng công thức Contribution Factor
        const baseContribution = 
            (config.jiraWeight * pJira) + 
            (config.gitWeight * pGit) + 
            (config.reviewWeight * pReview);

        // 4.4 CHUẨN HÓA HỆ SỐ (Nhân với số thành viên để đưa hệ số trung bình về 1.0)
        let normalizedContribution = baseContribution * memberCount;

        // 4.5 Trần điểm (Ceiling)
        if (!config.allowOverCeiling && normalizedContribution > 1.0) {
            normalizedContribution = 1.0; 
        }

        // 4.6 Tính điểm Assignment cá nhân
        const finalScore = Number((groupGrade * normalizedContribution).toFixed(2));

        // 4.7 Upsert vào DB
        const assessment = await SprintAssessment.findOneAndUpdate(
            { sprint_id: sprintId, member_id: mId },
            {
                group_grade: groupGrade,
                jira_percentage: Number(pJira.toFixed(4)),
                git_percentage: Number(pGit.toFixed(4)),
                review_percentage: Number(pReview.toFixed(4)),
                contribution_factor: Number(normalizedContribution.toFixed(4)),
                final_score: finalScore,
                updated_at: new Date()
            },
            { upsert: true, new: true }
        );

        assessmentResults.push(assessment);
    }

    return assessmentResults;
};

module.exports = {
    calculateSprintGrades
};