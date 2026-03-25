const { PeerReview, SprintAssessment } = require('../models/Assessment');
const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');

const calculateSprintGrades = async (teamId, groupGrade = 10) => {
    // 1. Lấy thông tin Team & Config
    const team = await Team.findById(teamId).populate('class_id');
    if (!team) throw new Error('Không tìm thấy Nhóm');

    const config = team.class_id?.contributionConfig || { allowOverCeiling: false };

    // 2. Lấy danh sách thành viên (ĐÃ CÓ SẴN contribution_percent từ Webhook AI)
    const members = await TeamMember.find({ team_id: teamId, is_active: true })
        .populate('student_id', 'email');
    const memberCount = members.length;
    if (memberCount === 0) return [];

    // 3. Tính Hệ số Đánh giá chéo (Peer Review Factor)
    const reviews = await PeerReview.find({ team_id: teamId });
    const reviewStats = {};

    reviews.forEach(r => {
        // Hỗ trợ cả 2 tên field (phòng trường hợp schema chưa đồng bộ hoàn toàn)
        const eId = r.evaluated_id ? r.evaluated_id.toString() : (r.reviewee_id ? r.reviewee_id.toString() : null); 
        const rating = r.rating || r.score_attitude;
        
        if (eId && rating) {
            if (!reviewStats[eId]) reviewStats[eId] = { total: 0, count: 0 };
            reviewStats[eId].total += rating;
            reviewStats[eId].count += 1;
        }
    });

    const assessmentResults = [];

    // 4. Ghép nối dữ liệu AI + Peer Review và chốt điểm
    for (const member of members) {
        const mId = member._id.toString();

        // 4.1. Lấy % Đóng góp Kỹ thuật (Từ AI đã tính sẵn, lưu dạng 0-100)
        // Ví dụ: 25% -> 0.25
        const techPercent = (member.contribution_percent || 0) / 100;
        
        // Chuẩn hóa hệ số kỹ thuật (VD: 25% x 4 người = 1.0)
        let normalizedTechFactor = techPercent * memberCount;

        // 4.2. Tính Hệ số Thái độ/Teamwork (Từ công thức ảnh)
        let avgStar = 3; // Mặc định 3 sao (đóng góp bình thường) nếu không ai đánh giá
        if (reviewStats[mId] && reviewStats[mId].count > 0) {
            avgStar = reviewStats[mId].total / reviewStats[mId].count;
        }
        // Áp dụng: factor = 1 + (avg_star - 3) * 0.05
        const peerFactor = 1 + (avgStar - 3) * 0.05;

        // 4.3. Hệ số cuối cùng = Kỹ thuật x Thái độ
        let finalFactor = normalizedTechFactor * peerFactor;

        // 4.4. Kiểm soát trần điểm (Ceiling)
        if (!config.allowOverCeiling && finalFactor > 1.0) {
            finalFactor = 1.0; 
        }

        // 4.5. Tính điểm cá nhân
        const finalScore = Number((groupGrade * finalFactor).toFixed(2));

        // 4.6. Lưu DB
        const assessment = await SprintAssessment.findOneAndUpdate(
            { team_id: teamId, member_id: mId }, 
            {
                group_grade: groupGrade,
                // Tận dụng DB lưu luôn các chỉ số gốc để UI Frontend dễ hiển thị Báo cáo
                jira_percentage: member.jira_story_points || 0, // Lưu số Story point đã done
                git_percentage: member.github_ai_score || 0,    // Lưu điểm AI Score
                review_percentage: Number(avgStar.toFixed(2)),  // Lưu số sao Trung bình
                
                contribution_factor: Number(finalFactor.toFixed(4)),
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