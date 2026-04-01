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

    // 3. Lấy dữ liệu Đánh giá chéo (Peer Review)
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
    // 4. TÍNH TOÁN VÀ CHUẨN BỊ BULK WRITE
    // ==========================================
    const totalPointPool = groupGrade * memberCount;
    
    const bulkAssessmentUpdates = [];
    const bulkMemberUpdates = [];
    const assessmentResults = [];

    for (const member of members) {
        const mId = member._id.toString();

        // -- Lấy % Data Thập Phân Từ AI (Không cần chia mẫu số) --
        const pGit = member.scores?.git_score || 0; 
        const pJira = member.scores?.jira_score || 0;

        // -- Riêng Review do con người chấm nên vẫn chia % --
        const myReviewTotal = reviewStats[mId] ? reviewStats[mId].total : 0;
        const avgStar = reviewStats[mId] && reviewStats[mId].count > 0 
            ? reviewStats[mId].total / reviewStats[mId].count 
            : 0;
        const pReview = totalReviewScore > 0 ? (myReviewTotal / totalReviewScore) : (1 / memberCount);

        // -- Tính Đóng Góp & Rút Điểm --
        const finalContributionPercent = (pJira * config.jiraWeight) + (pGit * config.gitWeight) + (pReview * config.reviewWeight);
        let finalScore = totalPointPool * finalContributionPercent;

        // -- Chặn Trần (Max 10) --
        if (!config.allowOverCeiling && finalScore > 10.0) {
            finalScore = 10.0; 
        }
        
        finalScore = Number(finalScore.toFixed(2));
        const displayFactor = Number((finalScore / groupGrade).toFixed(2));

        // -- Gói Data --
        const assessmentData = {
            group_grade: groupGrade,
            jira_percentage: pJira,
            git_percentage: pGit,
            review_percentage: Number(avgStar.toFixed(2)),
            contribution_factor: displayFactor, 
            final_score: finalScore, 
            updated_at: new Date()
        };

        assessmentResults.push({ team_id: teamId, member_id: mId, ...assessmentData });

        // 🔥 NẠP LỆNH BULK UPDATE CHO SPRINT ASSESSMENT
        bulkAssessmentUpdates.push({
            updateOne: {
                filter: { team_id: teamId, member_id: mId },
                update: { $set: assessmentData },
                upsert: true
            }
        });

        // 🔥 NẠP LỆNH BULK UPDATE CHO TEAM MEMBER
        bulkMemberUpdates.push({
            updateOne: {
                filter: { _id: mId },
                update: { 
                    $set: { 
                        contribution_percent: Number((finalContributionPercent * 100).toFixed(1)),
                        'scores.total_score': finalScore
                    } 
                }
            }
        });
    }

    // ==========================================
    // 5. THỰC THI GHI XUỐNG DB (TỐC ĐỘ BÀN THỜ)
    // ==========================================
    if (bulkAssessmentUpdates.length > 0) {
        await SprintAssessment.bulkWrite(bulkAssessmentUpdates);
    }
    
    if (bulkMemberUpdates.length > 0) {
        await TeamMember.bulkWrite(bulkMemberUpdates);
    }

    return assessmentResults;
};

module.exports = { calculateSprintGrades };