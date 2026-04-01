const { PeerReview, SprintAssessment } = require('../models/Assessment');
const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');

const calculateProjectGrades = async (teamId, groupGrade = 10) => {
    const Team = require('../models/Team');
    const TeamMember = require('../models/TeamMember');
    const PeerReview = require('../models/PeerReview');
    const { SprintAssessment } = require('../models/Assessment');

    const team = await Team.findById(teamId).populate('class_id');
    if (!team) throw new Error('Không tìm thấy Nhóm');

    const config = team.class_id?.contributionConfig || { 
        jiraWeight: 0.4, gitWeight: 0.4, reviewWeight: 0.2, allowOverCeiling: false 
    };

    const members = await TeamMember.find({ team_id: teamId, is_active: true })
        .populate('student_id', 'email');
    
    const memberCount = members.length;
    if (memberCount === 0) return [];

    const reviews = await PeerReview.find({ team_id: teamId });
    const reviewStats = {};
    let totalReviewScore = 0;

    reviews.forEach(r => {
        // Lấy ID của STUDENT để gom nhóm Review
        const eId = r.evaluated_id ? r.evaluated_id.toString() : (r.reviewee_id ? r.reviewee_id.toString() : null);
        const rating = r.rating || r.score_attitude;
        
        if (eId && rating) {
            if (!reviewStats[eId]) reviewStats[eId] = { total: 0, count: 0 };
            reviewStats[eId].total += rating;
            reviewStats[eId].count += 1;
            totalReviewScore += rating;
        }
    });

    const totalPointPool = groupGrade * memberCount;
    const bulkAssessmentUpdates = [];
    const bulkMemberUpdates = [];
    const assessmentResults = [];

    for (const member of members) {
        const mId = member._id.toString();
        
        // Trích xuất ID của STUDENT để đi móc điểm Review
        const sId = member.student_id._id ? member.student_id._id.toString() : member.student_id.toString();

        // 🔥 CHỈ LẤY DATA TỪ NGOÀI GỐC (Dọn sạch .scores)
        const pGit = member.git_score || 0; 
        const pJira = member.jira_score || 0;

        // Đi móc Review bằng STUDENT ID
        const myReviewTotal = reviewStats[sId] ? reviewStats[sId].total : 0;
        const avgStar = reviewStats[sId] && reviewStats[sId].count > 0 
            ? reviewStats[sId].total / reviewStats[sId].count 
            : 0;
        const pReview = totalReviewScore > 0 ? (myReviewTotal / totalReviewScore) : (1 / memberCount);

        const finalContributionPercent = (pJira * config.jiraWeight) + (pGit * config.gitWeight) + (pReview * config.reviewWeight);
        let finalScore = totalPointPool * finalContributionPercent;

        if (!config.allowOverCeiling && finalScore > 10.0) {
            finalScore = 10.0; 
        }
        
        finalScore = Number(finalScore.toFixed(2));
        const displayFactor = Number((finalScore / groupGrade).toFixed(2));

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

        bulkAssessmentUpdates.push({
            updateOne: {
                filter: { team_id: teamId, member_id: mId },
                update: { $set: assessmentData },
                upsert: true
            }
        });

        // Chỉ update contribution_percent ngoài gốc, bỏ qua cái scores.total_score
        bulkMemberUpdates.push({
            updateOne: {
                filter: { _id: mId },
                update: { 
                    $set: { 
                        contribution_percent: Number((finalContributionPercent * 100).toFixed(1))
                    } 
                }
            }
        });
    }

    if (bulkAssessmentUpdates.length > 0) {
        await SprintAssessment.bulkWrite(bulkAssessmentUpdates);
    }
    
    if (bulkMemberUpdates.length > 0) {
        await TeamMember.bulkWrite(bulkMemberUpdates);
    }

    return assessmentResults;
};

module.exports = { calculateSprintGrades };