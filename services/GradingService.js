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

    // 2. Lấy danh sách thành viên
    const members = await TeamMember.find({ team_id: teamId, is_active: true })
        .populate('student_id', 'email');
    
    const memberCount = members.length;
    if (memberCount === 0) return [];

    // ❌ ĐÃ XÓA: Đoạn vòng lặp tính totalGitScore và totalJiraSP (Vì không cần chia nữa)

    // 3. Lấy dữ liệu Đánh giá chéo (Peer Review) - Vẫn giữ nguyên vì nó nằm ở bảng khác
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
    // 4. TÍNH TOÁN ĐIỂM THEO CƠ CHẾ "QUỸ ĐIỂM"
    // ==========================================
    const assessmentResults = [];
    const totalPointPool = groupGrade * memberCount;

    for (const member of members) {
        const mId = member._id.toString();

        // -- BƯỚC A: LẤY THẲNG SỐ THẬP PHÂN TỪ AI (KHÔNG CẦN CHIA) --
        // Dữ liệu này đã là 0.x -> 1.0 (Ví dụ: 0.25 tương đương 25% cống hiến)
        const pGit = member.scores?.commit_score || member.scores?.github_score || 0; 
        const pJira = member.scores?.jira_score || 0;

        // Riêng Review thì vẫn phải tự tính % vì nó do con người chấm
        const myReviewTotal = reviewStats[mId] ? reviewStats[mId].total : 0;
        const avgStar = reviewStats[mId] && reviewStats[mId].count > 0 
            ? reviewStats[mId].total / reviewStats[mId].count 
            : 0;
        const pReview = totalReviewScore > 0 ? (myReviewTotal / totalReviewScore) : (1 / memberCount);

        // -- BƯỚC B: Tính Hệ số Đóng Góp Cuối Cùng --
        // Ví dụ: (0.25 * 0.4) + (0.3 * 0.4) + (0.25 * 0.2) = 0.27 (Hưởng 27% Quỹ điểm)
        const finalContributionPercent = (pJira * config.jiraWeight) + (pGit * config.gitWeight) + (pReview * config.reviewWeight);

        // -- BƯỚC C: Rút điểm từ Quỹ Điểm --
        let finalScore = totalPointPool * finalContributionPercent;

        // -- BƯỚC D: Xử lý trần điểm 10 --
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
                jira_percentage: pJira,        // Update lại cho chuẩn với data thập phân
                git_percentage: pGit,          // Update lại cho chuẩn với data thập phân
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