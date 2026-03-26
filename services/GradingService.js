const { PeerReview, SprintAssessment } = require('../models/Assessment');
const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');

const calculateSprintGrades = async (teamId, groupGrade = 10) => {
    // 1. Lấy thông tin Team & Config
    const team = await Team.findById(teamId).populate('class_id');
    if (!team) throw new Error('Không tìm thấy Nhóm');

    // LẤY CẤU HÌNH TRỌNG SỐ TỪ API CỦA GIẢNG VIÊN
    const config = team.class_id?.contributionConfig || { 
        jiraWeight: 0.4, gitWeight: 0.4, reviewWeight: 0.2, allowOverCeiling: false 
    };

    const members = await TeamMember.find({ team_id: teamId, is_active: true })
        .populate('student_id', 'email');
    const memberCount = members.length;
    if (memberCount === 0) return [];

    const calcPercent = (individual, total) => total === 0 ? (1 / memberCount) : (individual / total);

    // 2. Lấy dữ liệu Đánh giá chéo (Peer Review)
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

    const assessmentResults = [];
    const techWeightTotal = config.jiraWeight + config.gitWeight; // Thường là 0.8 (nếu review = 0.2)

    // 3. Tính toán và chốt điểm cho từng thành viên
    for (const member of members) {
        const mId = member._id.toString();

        // 3.1. Lấy % Đóng góp Kỹ thuật (Từ AI đã tính sẵn ở Webhook, dạng 0-100)
        // Chia 100 để đưa về dạng số thập phân (VD: 25% -> 0.25)
        const aiTechPercent = (member.contribution_percent || 0) / 100;

        // 3.2. Tính % Đánh giá chéo so với cả nhóm
        const myReviewTotal = reviewStats[mId] ? reviewStats[mId].total : 0;
        const pReview = calcPercent(myReviewTotal, totalReviewScore);
        
        const avgStar = reviewStats[mId] && reviewStats[mId].count > 0 
            ? reviewStats[mId].total / reviewStats[mId].count 
            : 0;

        // 3.3. TÍNH CỔ PHẦN ĐÓNG GÓP (Dựa trên cấu hình API của Giảng viên)
        const baseContribution = (techWeightTotal * aiTechPercent) + (config.reviewWeight * pReview);

        // 3.4. CHUẨN HÓA HỆ SỐ (Nhân với số thành viên để đưa hệ số trung bình về 1.0)
        let normalizedContribution = baseContribution * memberCount;

        // 3.5. Kiểm soát trần điểm (Ceiling)
        if (!config.allowOverCeiling && normalizedContribution > 1.0) {
            normalizedContribution = 1.0; 
        }

        // 3.6. Tính điểm Assignment cá nhân
        const finalScore = Number((groupGrade * normalizedContribution).toFixed(2));

        // 3.7. Lưu DB
        const assessment = await SprintAssessment.findOneAndUpdate(
            { team_id: teamId, member_id: mId }, 
            {
                group_grade: groupGrade,
                jira_percentage: member.jira_story_points || 0,
                git_percentage: member.github_ai_score || 0,
                review_percentage: Number(avgStar.toFixed(2)),
                
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

module.exports = { calculateSprintGrades };