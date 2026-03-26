const mongoose = require('mongoose');
const PeerReview = require('../models/PeerReview');
const TeamMember = require('../models/TeamMember');
const GradingService = require('../services/GradingService');
const Team = require('../models/Team');
const { SprintAssessment } = require('../models/Assessment');
const Class = require('../models/Class');

// ==========================================
// 1. SINH VIÊN NỘP ĐÁNH GIÁ (CHỈ 1 LẦN)
// ==========================================
exports.submitPeerReview = async (req, res) => {
    try {
        const evaluatorId = req.user._id;
        const { teamId, reviews } = req.body;

        // 1. Kiểm tra Nhóm có tồn tại không
        const team = await Team.findById(teamId);
        if (!team) {
            return res.status(404).json({ error: "Không tìm thấy Nhóm." });
        }

        // 2. CHECK RULE KHÓA DỮ LIỆU: Đã nộp cho nhóm này ở cuối kỳ rồi thì không được nộp lại
        const existingReview = await PeerReview.findOne({
            team_id: teamId,
            evaluator_id: evaluatorId
        });

        if (existingReview) {
            return res.status(403).json({ error: "Bạn đã nộp đánh giá chéo cho dự án này rồi. Không thể chỉnh sửa." });
        }

        // 3. Lấy danh sách thành viên nhóm (Trừ bản thân ra)
        const otherMembers = await TeamMember.find({
            team_id: teamId,
            is_active: true,
            student_id: { $ne: evaluatorId }
        }).select('student_id');

        const requiredMemberIds = otherMembers.map(m => m.student_id.toString());
        const submittedMemberIds = reviews.map(r => r.evaluated_id.toString());

        // 4. CHECK RULE TOÀN DIỆN: Phải chấm đủ tất cả mọi người trong team
        const isMissingMember = requiredMemberIds.some(id => !submittedMemberIds.includes(id));
        const isExtraMember = submittedMemberIds.some(id => !requiredMemberIds.includes(id));

        if (isMissingMember || isExtraMember || requiredMemberIds.length !== submittedMemberIds.length) {
            return res.status(400).json({ error: "Lỗi: Bạn phải đánh giá đầy đủ tất cả các thành viên trong nhóm." });
        }

        // 5. CHECK RULE LOGIC ĐIỂM SỐ
        for (const review of reviews) {
            if (review.rating < 0.5 || review.rating > 5.0) {
                return res.status(400).json({ error: "Điểm đánh giá phải từ 0.5 đến 5.0 sao." });
            }
            if (review.rating < 2.0 && (!review.comment || review.comment.trim() === '')) {
                return res.status(400).json({ error: `Lỗi: Bạn phải ghi lý do cho thành viên bị đánh giá ${review.rating} sao.` });
            }
        }

        // 6. Map dữ liệu và Lưu vào Database
        const reviewDocs = reviews.map(r => ({
            team_id: teamId,
            evaluator_id: evaluatorId,
            evaluated_id: r.evaluated_id,
            rating: r.rating,
            comment: r.comment
        }));

        await PeerReview.insertMany(reviewDocs);

        return res.json({ message: "✅ Gửi đánh giá cuối kỳ thành công! Dữ liệu đã được lưu và khóa." });

    } catch (error) {
        console.error("❌ Lỗi submit peer review:", error);
        return res.status(500).json({ error: "Lỗi Server nội bộ" });
    }
};

// ==========================================
// 2. GIẢNG VIÊN XEM KẾT QUẢ ĐÁNH GIÁ CỦA NHÓM
// ==========================================
exports.getTeamReviewsForLecturer = async (req, res) => {
    try {
        const teamId = req.params.teamId || req.query.team_id || req.query.teamId;

        if (!teamId || teamId === 'undefined' || teamId === 'null' || String(teamId).trim() === '') {
            return res.status(400).json({ error: 'Team ID không hợp lệ hoặc bị thiếu!' });
        }
        if (!mongoose.Types.ObjectId.isValid(teamId)) {
            return res.status(400).json({ error: 'Team ID không hợp lệ hoặc bị thiếu!' });
        }

        // Phân quyền: Chỉ Giảng viên hoặc Admin mới được xem
        if (req.role !== 'LECTURER' && req.role !== 'ADMIN') {
            return res.status(403).json({ error: "Từ chối truy cập. Chỉ Giảng viên và Quản trị viên mới được xem dữ liệu này." });
        }

        // Lấy tất cả đánh giá của nhóm, móc nối thông tin sinh viên
        const reviews = await PeerReview.find({ team_id: teamId })
            .populate('evaluator_id', 'full_name student_code email avatar_url')
            .populate('evaluated_id', 'full_name student_code email avatar_url')
            .lean();

        if (!reviews || reviews.length === 0) {
            return res.json({
                team_id: teamId,
                message: "Chưa có đánh giá chéo nào được nộp cho nhóm này.",
                total_reviews: 0,
                evaluation_summary: []
            });
        }

        // Gom nhóm dữ liệu theo "Người được đánh giá" (Evaluated Student)
        const summaryMap = {};

        reviews.forEach(review => {
            // Đề phòng trường hợp sinh viên bị xóa khỏi database làm null tham chiếu
            if (!review.evaluated_id || !review.evaluator_id) return;

            const evaluatedId = review.evaluated_id._id.toString();

            if (!summaryMap[evaluatedId]) {
                summaryMap[evaluatedId] = {
                    student: review.evaluated_id,
                    total_score: 0,
                    review_count: 0,
                    average_rating: 0,
                    feedbacks_received: []
                };
            }

            summaryMap[evaluatedId].total_score += review.rating;
            summaryMap[evaluatedId].review_count += 1;
            summaryMap[evaluatedId].feedbacks_received.push({
                evaluator: review.evaluator_id,
                rating: review.rating,
                comment: review.comment,
                submitted_at: review.submitted_at
            });
        });

        // Tính toán điểm trung bình cho từng sinh viên
        const evaluationSummary = Object.values(summaryMap).map(item => {
            // Làm tròn 2 chữ số thập phân
            item.average_rating = Number((item.total_score / item.review_count).toFixed(2));
            delete item.total_score; // Xóa field tạm thời cho code gọn gàng
            return item;
        });

        return res.json({
            team_id: teamId,
            total_reviews_submitted: reviews.length,
            evaluation_summary: evaluationSummary
        });

    } catch (error) {
        console.error("❌ Lỗi fetching team reviews:", error);
        return res.status(500).json({ error: "Lỗi Server nội bộ" });
    }
};

exports.calculateSprintGrades = async (req, res) => {
    try {
        // Đã bỏ sprintId đi, chỉ còn lấy teamId và groupGrade
        const { teamId, groupGrade } = req.body;

        // 1. Validation đầu vào
        if (!teamId || groupGrade === undefined) {
            return res.status(400).json({ error: 'Thiếu thông tin teamId hoặc groupGrade' });
        }

        // 2. Phân quyền: Thường chỉ LECTURER hoặc ADMIN mới được chốt điểm
        if (req.role !== 'LECTURER' && req.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Chỉ giảng viên mới có quyền chốt điểm.' });
        }

        // 3. Gọi Service để tính toán điểm tổng kết
        // Lưu ý: GradingService bây giờ chỉ nhận 2 tham số
        const results = await GradingService.calculateSprintGrades(teamId, Number(groupGrade));

        return res.status(200).json({
            message: '✅ Đã tính điểm Assignment cho toàn dự án thành công!',
            total_members_assessed: results.length,
            data: results
        });

    } catch (error) {
        console.error("❌ Lỗi tính điểm Assignment:", error);
        return res.status(500).json({ error: error.message });
    }
};

// ==========================================
// API 1: SINH VIÊN XEM ĐIỂM CÁ NHÂN CỦA MÌNH
// ==========================================
exports.getMyAssignmentGrades = async (req, res) => {
    try {
        const { teamId } = req.params;
        const userId = req.user._id;

        // 1. Tìm thông tin member của sinh viên trong nhóm
        const teamMember = await TeamMember.findOne({ 
            team_id: teamId, 
            student_id: userId 
        });

        if (!teamMember) {
            return res.status(404).json({ error: 'Bạn không phải là thành viên của nhóm này.' });
        }

        // 2. Lấy toàn bộ bảng điểm Assessment của member này
        const grades = await SprintAssessment.find({ member_id: teamMember._id })
            .sort({ created_at: 1 });

        return res.json({
            message: '✅ Lấy bảng điểm cá nhân thành công!',
            total_assignments: grades.length,
            data: grades.map(g => ({
                assignment_name: g.sprint_id?.name || 'Unknown',
                group_grade: g.group_grade,
                jira_percentage: g.jira_percentage,
                git_percentage: g.git_percentage,
                review_percentage: g.review_percentage,
                contribution_factor: g.contribution_factor,
                final_score: g.final_score,
                updated_at: g.updated_at
            }))
        });

    } catch (error) {
        console.error("❌ Lỗi getMyAssignmentGrades:", error);
        return res.status(500).json({ error: error.message });
    }
};

// ==========================================
// API 2: GIẢNG VIÊN XEM BẢNG ĐIỂM CỦA CẢ LỚP
// ==========================================
exports.getClassGrades = async (req, res) => {
    try {
        const { classId } = req.params;

        // 1. Kiểm tra Lớp học và Phân quyền
        const targetClass = await Class.findById(classId);
        if (!targetClass) {
            return res.status(404).json({ error: 'Không tìm thấy lớp học.' });
        }

        // Nếu là LECTURER, chỉ được xem lớp của mình dạy (ADMIN thì xem được hết)
        if (req.role === 'LECTURER' && targetClass.lecturer_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Bạn không có quyền xem điểm của lớp này.' });
        }

        // 2. Lấy tất cả các Nhóm trong lớp
        const teams = await Team.find({ class_id: classId });
        const teamIds = teams.map(t => t._id);

        // 3. Lấy tất cả Thành viên của các nhóm
        const members = await TeamMember.find({ team_id: { $in: teamIds } })
            .populate('student_id', 'student_code full_name email avatar_url')
            .populate('team_id', 'project_name');
        
        const memberIds = members.map(m => m._id);

        // 4. Lấy tất cả điểm số của các thành viên này (Đã bỏ populate sprint_id)
        const assessments = await SprintAssessment.find({ member_id: { $in: memberIds } });
        
        // 5. Gom nhóm dữ liệu theo từng Sinh viên để Frontend dễ vẽ bảng (Table)
        const result = members.map(member => {
            // Lọc ra các cột điểm của riêng sinh viên này
            const studentGrades = assessments.filter(a => a.member_id.toString() === member._id.toString());
            
            return {
                student: member.student_id,
                team: member.team_id,
                role_in_team: member.role_in_team,
                grades: studentGrades.map(g => ({
                    // Đã xóa sprint_id vì không còn sử dụng
                    assignment_name: 'Điểm tổng kết', // Cứng tên lại cho đẹp trên UI
                    group_grade: g.group_grade,
                    contribution_factor: g.contribution_factor,
                    final_score: g.final_score
                }))
            };
        });

        // Tùy chọn: Sắp xếp kết quả theo tên Nhóm (Team) rồi đến tên Sinh viên
        result.sort((a, b) => {
            const teamA = a.team?.project_name || '';
            const teamB = b.team?.project_name || '';
            return teamA.localeCompare(teamB);
        });

        return res.json({
            message: '✅ Lấy bảng điểm tổng hợp thành công!',
            class_id: classId,
            total_students: result.length,
            data: result
        });

    } catch (error) {
        console.error("❌ Lỗi getClassGrades:", error);
        return res.status(500).json({ error: error.message });
    }
};
