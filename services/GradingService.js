const { PeerReview, SprintAssessment } = require('../models/Assessment');
const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');

const calculateSprintGrades = async (teamId, groupGrade = 10) => {
    // 1. Lấy thông tin Team & Config
    const team = await Team.findById(teamId).populate('class_id');
    if (!team) throw new Error('Không tìm thấy Nhóm');

    const config = team.class_id?.contributionConfig || { 
        jiraWeight: 0.4, gitWeight: 0.4, reviewWeight: 0.2, allowOverCeiling: false 
    };

    // 2. Lấy danh sách thành viên (Điểm đã lưu sẵn trong m.scores)
    const members = await TeamMember.find({ team_id: teamId, is_active: true })
        .populate('student_id', 'email');
    
    const memberCount = members.length;
    if (memberCount === 0) return [];

    // 3. Tính tổng điểm của cả nhóm (để làm mẫu số chia % quỹ điểm)
    let totalGitScore = 0;
    let totalJiraSP = 0;

    members.forEach(m => {
        // Lấy đúng đường dẫn object scores theo Schema database của bạn
        totalGitScore += (m.scores?.commit_score || 0);
        totalJiraSP += (m.scores?.jira_score || 0);
    });

    // 4. Lấy dữ liệu Đánh giá chéo (Peer Review)
    const reviews = await PeerReview.find({ team_id: teamId });
    const reviewStats = {};
    let totalReviewScore = 0;

    reviews.forEach(r => {
        const eId = r.evaluated_id ? r.evaluated_id.toString() : (r.reviewee_id ? r.reviewee_id.toString() : null);
        const rating = r.rating || r.score_attitude;
        
        if (eId && rating) {
            if (!reviewStats[eId]) reviewStats[eId] = { total: 0, count: 0 };
            reviewStats[eId].total += rating;
            reviewStats[eId].count += 1;
            totalReviewScore += rating;
        }
    });

    // ==========================================
    // 5. TÍNH TOÁN ĐIỂM THEO CƠ CHẾ "QUỸ ĐIỂM"
    // ==========================================
    const assessmentResults = [];
    const totalPointPool = groupGrade * memberCount;

    for (const member of members) {
        const mId = member._id.toString();

        // -- Lấy dữ liệu thô cá nhân --
        const myGitScore = member.scores?.commit_score || 0;
        const myJiraSP = member.scores?.jira_score || 0;
        const myReviewTotal = reviewStats[mId] ? reviewStats[mId].total : 0;
        
        const avgStar = reviewStats[mId] && reviewStats[mId].count > 0 
            ? reviewStats[mId].total / reviewStats[mId].count 
            : 0;

        // -- BƯỚC B: Tính % đóng góp --
        const pGit = totalGitScore > 0 ? (myGitScore / totalGitScore) : (1 / memberCount);
        const pJira = totalJiraSP > 0 ? (myJiraSP / totalJiraSP) : (1 / memberCount);
        const pReview = totalReviewScore > 0 ? (myReviewTotal / totalReviewScore) : (1 / memberCount);

        // -- BƯỚC C: Tính % Đóng Góp Cuối Cùng --
        const finalContributionPercent = (pJira * config.jiraWeight) + (pGit * config.gitWeight) + (pReview * config.reviewWeight);

        // -- BƯỚC D: Rút điểm từ Quỹ Điểm --
        let finalScore = totalPointPool * finalContributionPercent;

        // -- Xử lý trần điểm 10 --
        if (!config.allowOverCeiling && finalScore > 10.0) {
            finalScore = 10.0; 
        }
        
        finalScore = Number(finalScore.toFixed(2));
        const displayFactor = Number((finalScore / groupGrade).toFixed(2));

        // -- Lưu DB Assessment --
        const assessment = await SprintAssessment.findOneAndUpdate(
            { team_id: teamId, member_id: mId }, 
            {
                group_grade: groupGrade,
                jira_percentage: myJiraSP,
                git_percentage: myGitScore,
                review_percentage: Number(avgStar.toFixed(2)),
                
                contribution_factor: displayFactor, 
                final_score: finalScore, 
                updated_at: new Date()
            },
            { upsert: true, new: true }
        );
        assessmentResults.push(assessment);
    }

    return assessmentResults;
};

module.exports = { calculateSprintGrades };