const bcrypt = require('bcryptjs');
const models = require('../models');
const Semester = require('../models/Semester');
const Subject = require('../models/Subject');
const Class = require('../models/Class');
const Student = require('../models/Student');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const PendingEnrollment = require('../models/PendingEnrollment');
const { sendPendingEnrollmentEmail } = require('../services/EmailService');
const NotificationService = require('../services/NotificationService');

// ==========================================
// QUẢN LÝ HỌC KỲ (SEMESTER MANAGEMENT)
// ==========================================

/**
 * POST /management/semesters
 * Tạo học kỳ mới
 */
const createSemester = async (req, res) => {
    try {
        const { name, code, start_date, end_date } = req.body;

        // Validate required fields
        if (!name || !code || !start_date || !end_date) {
            return res.status(400).json({
                error: 'name, code, start_date và end_date là bắt buộc'
            });
        }

        // Validate dates
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);
        
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({
                error: 'start_date và end_date phải là định dạng ngày hợp lệ'
            });
        }

        if (startDate >= endDate) {
            return res.status(400).json({
                error: 'end_date phải sau start_date'
            });
        }

        // Kiểm tra code đã tồn tại chưa
        const existingSemester = await Semester.findOne({ code });
        if (existingSemester) {
            return res.status(400).json({
                error: `Học kỳ với code "${code}" đã tồn tại`
            });
        }

        // Lấy admin_id từ token (giả sử có middleware auth)
        // Tạm thời dùng admin đầu tiên hoặc từ req.user nếu có
        const admin = await models.Admin.findOne();
        if (!admin) {
            return res.status(500).json({
                error: 'Không tìm thấy admin để tạo học kỳ'
            });
        }

        const semester = await Semester.create({
            name,
            code,
            start_date: startDate,
            end_date: endDate,
            created_by_admin: admin._id,
            status: 'Open'
        });

        res.status(201).json({
            message: '✅ Tạo học kỳ thành công!',
            semester: {
                _id: semester._id,
                name: semester.name,
                code: semester.code,
                start_date: semester.start_date,
                end_date: semester.end_date,
                status: semester.status
            }
        });
    } catch (error) {
        console.error('Create semester error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /management/semesters
 * Lấy danh sách học kỳ (để hiển thị dropdown)
 */
const getSemesters = async (req, res) => {
    try {
        const semesters = await Semester.find()
            .select('_id name code start_date end_date status')
            .sort({ start_date: -1 }) // Mới nhất trước
            .lean();

        res.json({
            total: semesters.length,
            semesters
        });
    } catch (error) {
        console.error('Get semesters error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /management/semesters/:semesterId
 * Lấy chi tiết học kỳ (kèm danh sách lớp trong học kỳ)
 */
const getSemesterById = async (req, res) => {
    try {
        const { semesterId } = req.params;
        const mongoose = require('mongoose');

        if (!mongoose.Types.ObjectId.isValid(semesterId)) {
            return res.status(400).json({ error: 'semesterId không hợp lệ' });
        }

        const semester = await Semester.findById(semesterId)
            .populate('created_by_admin', 'email full_name')
            .lean();

        if (!semester) {
            return res.status(404).json({ error: 'Không tìm thấy học kỳ' });
        }

        // Lấy danh sách lớp trong học kỳ này
        const classes = await Class.find({ semester_id: semesterId })
            .populate('lecturer_id', 'email full_name avatar_url')
            .populate('subject_id', 'name code')
            .select('_id name class_code subjectName subject_id lecturer_id status gradeStructure contributionConfig')
            .lean();

        // Thống kê
        const stats = {
            total_classes: classes.length,
            active_classes: classes.filter(c => c.status === 'Active').length,
            archived_classes: classes.filter(c => c.status === 'Archived').length,
            total_lecturers: new Set(classes.map(c => c.lecturer_id?._id?.toString()).filter(Boolean)).size
        };

        res.json({
            semester,
            classes,
            stats
        });
    } catch (error) {
        console.error('Get semester by id error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// QUẢN LÝ MÔN HỌC (SUBJECT MANAGEMENT)
// ==========================================

/**
 * POST /management/subjects
 * Tạo môn học mới
 */
const createSubject = async (req, res) => {
    try {
        const { name, code, description, credits } = req.body;

        // Validate required fields
        if (!name || !code) {
            return res.status(400).json({
                error: 'name và code là bắt buộc'
            });
        }

        // Kiểm tra code đã tồn tại chưa
        const existingSubject = await Subject.findOne({ 
            $or: [
                { code: code.trim() },
                { name: name.trim() }
            ]
        });
        if (existingSubject) {
            return res.status(400).json({
                error: `Môn học với code "${code}" hoặc name "${name}" đã tồn tại`
            });
        }

        // Lấy admin_id từ token (giả sử có middleware auth)
        // Tạm thời dùng admin đầu tiên hoặc từ req.user nếu có
        const admin = await models.Admin.findOne();
        if (!admin) {
            return res.status(404).json({
                error: 'Không tìm thấy admin để tạo môn học'
            });
        }

        const subject = await Subject.create({
            name: name.trim(),
            code: code.trim().toUpperCase(), // Mã môn học viết hoa
            description: description || '',
            credits: credits || 0,
            created_by_admin: admin._id,
            status: 'Active'
        });

        res.status(201).json({
            message: '✅ Tạo môn học thành công!',
            subject: {
                _id: subject._id,
                name: subject.name,
                code: subject.code,
                description: subject.description,
                credits: subject.credits,
                status: subject.status
            }
        });
    } catch (error) {
        console.error('Create subject error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /management/subjects
 * Lấy danh sách môn học (để hiển thị dropdown)
 */
const getSubjects = async (req, res) => {
    try {
        const { status } = req.query;
        
        let query = {};
        if (status) {
            query.status = status; // 'Active' hoặc 'Archived'
        }

        const subjects = await Subject.find(query)
            .select('_id name code description credits status')
            .sort({ name: 1 }) // Sắp xếp theo tên
            .lean();

        res.json({
            total: subjects.length,
            subjects
        });
    } catch (error) {
        console.error('Get subjects error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /management/subjects/:subjectId
 * Lấy chi tiết môn học (kèm danh sách lớp dạy môn này)
 */
const getSubjectById = async (req, res) => {
    try {
        const { subjectId } = req.params;
        const mongoose = require('mongoose');

        if (!mongoose.Types.ObjectId.isValid(subjectId)) {
            return res.status(400).json({ error: 'subjectId không hợp lệ' });
        }

        const subject = await Subject.findById(subjectId)
            .populate('created_by_admin', 'email full_name')
            .lean();

        if (!subject) {
            return res.status(404).json({ error: 'Không tìm thấy môn học' });
        }

        // Lấy danh sách lớp dạy môn này (có thể có nhiều lớp, nhiều giảng viên)
        const classes = await Class.find({ subject_id: subjectId })
            .populate('lecturer_id', 'email full_name avatar_url')
            .populate('semester_id', 'name code start_date end_date')
            .select('_id name class_code subjectName lecturer_id semester_id status')
            .lean();

        // Thống kê
        const stats = {
            total_classes: classes.length,
            active_classes: classes.filter(c => c.status === 'Active').length,
            archived_classes: classes.filter(c => c.status === 'Archived').length,
            total_lecturers: new Set(classes.map(c => c.lecturer_id?._id?.toString()).filter(Boolean)).size,
            total_semesters: new Set(classes.map(c => c.semester_id?._id?.toString()).filter(Boolean)).size
        };

        res.json({
            subject,
            classes,
            stats
        });
    } catch (error) {
        console.error('Get subject by id error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// QUẢN LÝ USER (USER MANAGEMENT)
// ==========================================

/**
 * POST /management/users
 * Tạo user (Admin, Lecturer, Mentor)
 */
const createUser = async (req, res) => {
    try {
        const { full_name, role } = req.body;
        // Normalize email
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

        // Validate required fields
        if (!full_name || !email || !role) {
            return res.status(400).json({
                error: 'full_name, email và role là bắt buộc'
            });
        }

        // Validate role
        if (!['ADMIN', 'LECTURER'].includes(role.toUpperCase())) {
            return res.status(400).json({
                error: 'role phải là ADMIN hoặc LECTURER'
            });
        }

        const roleUpper = role.toUpperCase();

        // Kiểm tra email đã tồn tại chưa
        const existingAdmin = await models.Admin.findOne({ email });
        const existingLecturer = await models.Lecturer.findOne({ email });
        const existingStudent = await models.Student.findOne({ email });

        if (existingAdmin || existingLecturer || existingStudent) {
            return res.status(400).json({
                error: 'Email đã được sử dụng'
            });
        }

        // Tạo password mặc định (có thể random hoặc yêu cầu user đổi sau)
        const defaultPassword = '123456'; // Hoặc generate random
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(defaultPassword, salt);

        let newUser;

        if (roleUpper === 'ADMIN') {
            newUser = await models.Admin.create({
                email,
                full_name,
                password: hashedPassword
            });
        } else if (roleUpper === 'LECTURER') {
            newUser = await models.Lecturer.create({
                email,
                full_name,
                password: hashedPassword,
                is_verified: true // Admin tạo thì auto verify
            });
        }

        // Trả về user (không trả password)
        const userResponse = newUser.toObject();
        delete userResponse.password;

        res.status(201).json({
            message: `✅ Tạo ${roleUpper} thành công!`,
            user: userResponse,
            default_password: defaultPassword // Trả về password mặc định để admin biết
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /management/users?role=lecturer
 * Lấy danh sách user (lọc theo role để gán vào lớp)
 */
const getUsers = async (req, res) => {
    try {
        const { role } = req.query;
        const roleUpper = role ? role.toUpperCase() : null;

        let users = [];

        if (roleUpper === 'LECTURER') {
            const lecturers = await models.Lecturer.find()
                .select('_id email full_name avatar_url')
                .sort({ full_name: 1 })
                .lean();
            users = lecturers;
        } else if (roleUpper === 'ADMIN') {
            const admins = await models.Admin.find()
                .select('_id email full_name')
                .sort({ full_name: 1 })
                .lean();
            users = admins;
        } else if (roleUpper === 'STUDENT') {
            const students = await models.Student.find()
                .select('_id email full_name student_code avatar_url major ent')
                .sort({ student_code: 1 })
                .lean();
            users = students;
        } else {
            // Lấy tất cả (Admin + Lecturer + Student)
            const admins = await models.Admin.find().select('_id email full_name').lean();
            const lecturers = await models.Lecturer.find().select('_id email full_name avatar_url').lean();
            const students = await models.Student.find().select('_id email full_name student_code avatar_url').lean();
            
            users = [
                ...admins.map(u => ({ ...u, role: 'ADMIN' })), 
                ...lecturers.map(u => ({ ...u, role: 'LECTURER' })),
                ...students.map(u => ({ ...u, role: 'STUDENT' }))
            ];
        }

        res.json({
            total: users.length,
            users
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// QUẢN LÝ LỚP HỌC (CLASS MANAGEMENT)
// ==========================================

/**
 * POST /management/classes
 * Tạo lớp học (gắn vào học kỳ & giảng viên)
 */
const createClass = async (req, res) => {
    try {
        const { name, semester_id, lecturer_id, subjectName, subject_id } = req.body;

        // Validate required fields
        // Có thể dùng subject_id (link đến Subject model) hoặc subjectName (text)
        if (!name || !semester_id || !lecturer_id) {
            return res.status(400).json({
                error: 'name, semester_id và lecturer_id là bắt buộc'
            });
        }

        // Phải có ít nhất một trong hai: subject_id hoặc subjectName
        if (!subject_id && !subjectName) {
            return res.status(400).json({
                error: 'subject_id hoặc subjectName là bắt buộc'
            });
        }

        // Nếu có subject_id, validate và lấy subjectName từ Subject model
        let finalSubjectName = subjectName;
        if (subject_id) {
            if (!require('mongoose').Types.ObjectId.isValid(subject_id)) {
                return res.status(400).json({
                    error: 'subject_id không hợp lệ'
                });
            }
            
            const subject = await Subject.findById(subject_id);
            if (!subject) {
                return res.status(404).json({
                    error: 'Không tìm thấy môn học với subject_id này'
                });
            }
            
            // Dùng name từ Subject model
            finalSubjectName = subject.name;
        }

        // Validate ObjectId
        if (!require('mongoose').Types.ObjectId.isValid(semester_id)) {
            return res.status(400).json({
                error: 'semester_id không hợp lệ'
            });
        }

        if (!require('mongoose').Types.ObjectId.isValid(lecturer_id)) {
            return res.status(400).json({
                error: 'lecturer_id không hợp lệ'
            });
        }

        // Kiểm tra semester tồn tại
        const semester = await Semester.findById(semester_id);
        if (!semester) {
            return res.status(404).json({
                error: 'Không tìm thấy học kỳ'
            });
        }

        // Kiểm tra lecturer tồn tại
        const lecturer = await models.Lecturer.findById(lecturer_id);
        if (!lecturer) {
            return res.status(404).json({
                error: 'Không tìm thấy giảng viên'
            });
        }

        // Tạo class_code tự động từ name hoặc yêu cầu input
        // Tạm thời dùng name để generate code
        const classCode = name.toUpperCase().replace(/\s+/g, '').substring(0, 10) || `CLASS${Date.now()}`;

        // Kiểm tra duplicate: Cùng giảng viên + cùng môn học + cùng mã lớp
        const existingClass = await Class.findOne({
            lecturer_id: lecturer_id,
            subjectName: finalSubjectName,
            class_code: classCode
        });

        if (existingClass) {
            return res.status(400).json({
                error: `Lớp học với mã "${classCode}" đã tồn tại cho môn "${finalSubjectName}" của giảng viên này. Vui lòng chọn mã lớp khác hoặc môn học khác.`
            });
        }

        const newClass = await Class.create({
            name,
            semester_id,
            lecturer_id,
            subjectName: finalSubjectName, // Tên môn học (từ subject_id hoặc từ input)
            subject_id: subject_id || null, // Link đến Subject model (optional, để backward compatible)
            class_code: classCode
        });

        // Populate để trả về thông tin đầy đủ
        const classWithDetails = await Class.findById(newClass._id)
            .populate('semester_id', 'name code')
            .populate('lecturer_id', 'email full_name')
            .lean();

        res.status(201).json({
            message: '✅ Tạo lớp học thành công!',
            class: classWithDetails
        });
    } catch (error) {
        console.error('Create class error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getClasses = async (req, res) => {
    try {
        const { semester_id, lecturer_id } = req.query;

        let query = {};
        if (semester_id) {
            if (!require('mongoose').Types.ObjectId.isValid(semester_id)) {
                return res.status(400).json({
                    error: 'semester_id không hợp lệ'
                });
            }
            query.semester_id = semester_id;
        }

        if (lecturer_id) {
            if (!require('mongoose').Types.ObjectId.isValid(lecturer_id)) {
                return res.status(400).json({
                    error: 'lecturer_id không hợp lệ'
                });
            }
            query.lecturer_id = lecturer_id;
        }

        const classes = await Class.find(query)
            .populate('semester_id', 'name code')
            .populate('lecturer_id', 'email full_name')
            .sort({ created_at: -1 })
            .lean();

        res.json({
            total: classes.length,
            classes
        });
    } catch (error) {
        console.error('Get classes error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /management/classes/:classId
 * Lấy chi tiết lớp học (kèm thông tin đầy đủ)
 */
const getClassById = async (req, res) => {
    try {
        const { classId } = req.params;
        const mongoose = require('mongoose');

        if (!mongoose.Types.ObjectId.isValid(classId)) {
            return res.status(400).json({ error: 'classId không hợp lệ' });
        }

        const classInfo = await Class.findById(classId)
            .populate('semester_id', '_id name code start_date end_date status')
            .populate('lecturer_id', '_id email full_name avatar_url')
            .populate('subject_id', '_id name code description credits')
            .lean();

        if (!classInfo) {
            return res.status(404).json({ error: 'Không tìm thấy lớp học' });
        }

        // Lấy danh sách team trong lớp
        const teams = await Team.find({ class_id: classId })
            .select('_id project_name jira_project_key github_repo_url last_sync_at')
            .lean();

        // Lấy số lượng sinh viên trong lớp (qua TeamMember)
        const teamIds = teams.map(t => t._id);
        const studentCount = await TeamMember.countDocuments({
            team_id: { $in: teamIds },
            is_active: true
        });

        // Lấy số lượng project trong lớp
        const projectCount = await models.Project.countDocuments({
            class_id: classId
        });

        // Thống kê
        const stats = {
            total_teams: teams.length,
            total_students: studentCount,
            total_projects: projectCount
        };

        res.json({
            class: classInfo,
            teams,
            stats
        });
    } catch (error) {
        console.error('Get class by id error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /management/lecturers/:lecturerId/classes
 * Lấy danh sách lớp giảng viên đang dạy
 */
const getLecturerClasses = async (req, res) => {
    try {
        const { lecturerId } = req.params;
        const mongoose = require('mongoose');

        if (!mongoose.Types.ObjectId.isValid(lecturerId)) {
            return res.status(400).json({ error: 'lecturerId không hợp lệ' });
        }

        // Kiểm tra giảng viên tồn tại
        const lecturer = await models.Lecturer.findById(lecturerId)
            .select('_id email full_name avatar_url')
            .lean();

        if (!lecturer) {
            return res.status(404).json({ error: 'Không tìm thấy giảng viên' });
        }

        // Lấy danh sách lớp giảng viên đang dạy
        const classes = await Class.find({ lecturer_id: lecturerId })
            .populate('semester_id', '_id name code start_date end_date status')
            .populate('subject_id', '_id name code description')
            .select('_id name class_code subjectName subject_id semester_id status gradeStructure contributionConfig')
            .sort({ created_at: -1 })
            .lean();

        // Thống kê
        const stats = {
            total_classes: classes.length,
            active_classes: classes.filter(c => c.status === 'Active').length,
            archived_classes: classes.filter(c => c.status === 'Archived').length,
            total_subjects: new Set(classes.map(c => c.subject_id?._id?.toString() || c.subjectName).filter(Boolean)).size,
            total_semesters: new Set(classes.map(c => c.semester_id?._id?.toString()).filter(Boolean)).size
        };

        res.json({
            lecturer,
            classes,
            stats
        });
    } catch (error) {
        console.error('Get lecturer classes error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// IMPORT SINH VIÊN VÀO LỚP (IMPORT STUDENTS)
// ==========================================

/**
 * POST /management/classes/:classId/import-students
 * Import danh sách sinh viên vào lớp từ template
 * Template format: [{ Class, RollNumber, Email, MemberCode, FullName, Group, Leader }]
 * 
 * Logic:
 * - Sinh viên phải tự đăng ký tài khoản trước
 * - K18 trở về trước: Tìm sinh viên dựa vào Email (có email trường cung cấp)
 * - K19 trở về sau: Tìm sinh viên dựa vào RollNumber (student_code)
 * - Nếu không tìm thấy → báo lỗi (sinh viên chưa đăng ký)
 * - Tự động enroll vào lớp và team
 */
const importStudents = async (req, res) => {
    try {
        const { classId } = req.params;
        const { students } = req.body; // Array of students from template

        // Validate classId
        if (!require('mongoose').Types.ObjectId.isValid(classId)) {
            return res.status(400).json({
                error: 'classId không hợp lệ'
            });
        }

        // Validate input
        if (!students || !Array.isArray(students) || students.length === 0) {
            return res.status(400).json({
                error: 'students phải là một array không rỗng'
            });
        }

        // Kiểm tra class tồn tại
        const classExists = await Class.findById(classId);
        if (!classExists) {
            return res.status(404).json({
                error: 'Không tìm thấy lớp học'
            });
        }

        // ==================================================================
        // LOGIC MỚI: XÓA CŨ THAY MỚI (RESET CLASS ROSTER)
        // Khi import lại, hệ thống sẽ xóa sạch dữ liệu cũ của lớp đó để tránh trùng lặp
        // ==================================================================
        
        // 1. Xóa danh sách chờ (PendingEnrollment) cũ của lớp này
        await PendingEnrollment.deleteMany({ class_id: classId });

        // 2. Xóa thành viên (TeamMember) và Nhóm (Team) cũ
        // Tìm các team thuộc lớp này
        const existingTeams = await models.Team.find({ class_id: classId }).select('_id');
        const existingTeamIds = existingTeams.map(t => t._id);

        if (existingTeamIds.length > 0) {
            // Xóa tất cả thành viên trong các team của lớp này
            await models.TeamMember.deleteMany({ team_id: { $in: existingTeamIds } });
            
            // Xóa luôn các team cũ (để tạo lại team theo group mới trong file import)
            await models.Team.deleteMany({ class_id: classId });
        }

        console.log(`🧹 Đã dọn dẹp dữ liệu cũ của lớp ${classExists.name} trước khi import mới.`);
        // ==================================================================

        const results = {
            success: [],
            errors: [],
            created_teams: 0,
            created_members: 0,
            not_found: [] // Sinh viên chưa đăng ký
        };

        // Map để lưu team theo Group number
        const teamMap = new Map(); // groupNumber -> teamId

        console.log(`📥 Bắt đầu xử lý import ${students.length} sinh viên cho lớp ${classExists.name}...`);

        // Xử lý từng student
        for (let i = 0; i < students.length; i++) {
            const studentData = students[i];
            const rowNumber = i + 1;
            
            console.log(`🔍 Đang xử lý dòng ${rowNumber}:`, JSON.stringify(studentData));

            try {
                const {
                    RollNumber,
                    Email,
                    MemberCode,
                    FullName,
                    Group,
                    Leader
                } = studentData;

                // Validate required fields
                if (!RollNumber) {
                    console.log(`❌ Dòng ${rowNumber}: Thiếu RollNumber`);
                    results.errors.push({
                        row: rowNumber,
                        error: 'Thiếu RollNumber (mã số sinh viên)'
                    });
                    continue;
                }

                // Normalize data
                const normalizedRollNumber = RollNumber.toString().trim().toUpperCase();
                const normalizedEmail = Email ? Email.toString().trim().toLowerCase() : null;

                // Validate Group
                const groupNumber = Group ? parseInt(Group) : null;
                if (!groupNumber || isNaN(groupNumber)) {
                    console.log(`❌ Dòng ${rowNumber} (${normalizedRollNumber}): Group không hợp lệ: ${Group}`);
                    results.errors.push({
                        row: rowNumber,
                        student: FullName || normalizedRollNumber,
                        error: 'Group không hợp lệ'
                    });
                    continue;
                }

                // Kiểm tra Leader (nếu có 'x' hoặc 'X' thì là leader)
                // Fix: Ép kiểu boolean rõ ràng để tránh lỗi CastError khi lưu vào DB
                const leaderVal = Leader ? Leader.toString().trim().toLowerCase() : '';
                const isLeader = (leaderVal === 'x' || leaderVal === 'leader');

                // Tìm Student đã đăng ký
                // Logic: Ưu tiên tìm theo Email (K18 trở về trước), nếu không có thì tìm theo RollNumber (K19+)
                let student = null;
                
                if (normalizedEmail) {
                    student = await Student.findOne({ email: normalizedEmail });
                }
                
                if (!student) {
                    student = await Student.findOne({ student_code: normalizedRollNumber });
                }

                // Nếu vẫn không tìm thấy → sinh viên chưa đăng ký
                // Lưu vào PendingEnrollment và gửi email thông báo
                if (!student) {
                    console.log(`⚠️ Dòng ${rowNumber} (${normalizedRollNumber}): Chưa có tài khoản -> Tạo Pending Enrollment`);
                    
                    // Kiểm tra xem đã có pending enrollment chưa (tránh duplicate)
                    const existingPending = await PendingEnrollment.findOne({
                        class_id: classId,
                        roll_number: normalizedRollNumber,
                        enrolled: false
                    });

                    let emailSent = false;
                    let emailErrorMsg = '';

                    if (!existingPending) {
                        try {
                            const newPending = await PendingEnrollment.create({
                                class_id: classId,
                                roll_number: normalizedRollNumber,
                                email: normalizedEmail,
                                full_name: FullName || '',
                                group: groupNumber,
                                is_leader: isLeader,
                                subjectName: classExists.subjectName,
                                semester_id: classExists.semester_id,
                                lecturer_id: classExists.lecturer_id,
                                enrolled: false
                            });
                            console.log(`✅ Đã tạo Pending Enrollment: ${newPending._id}`);
                        } catch (dbError) {
                            console.error(`❌ Lỗi tạo PendingEnrollment dòng ${rowNumber}:`, dbError);
                            results.errors.push({
                                row: rowNumber,
                                error: 'Lỗi database khi tạo danh sách chờ: ' + dbError.message
                            });
                            continue;
                        }

                        // Gửi email thông báo cho sinh viên chưa đăng ký (nếu có email)
                        if (normalizedEmail) {
                            console.log(`📧 Đang thử gửi email đến: ${normalizedEmail}`);
                            try {
                                const emailResult = await sendPendingEnrollmentEmail(
                                    normalizedEmail,
                                    FullName || normalizedRollNumber,
                                    classExists.name,
                                    normalizedRollNumber
                                );
                                
                                if (emailResult && emailResult.success) {
                                    emailSent = true;
                                    console.log(`✅ Đã gửi email thành công đến ${normalizedEmail}`);
                                } else {
                                    emailErrorMsg = emailResult?.error || 'Lỗi gửi email';
                                    console.error(`❌ Gửi email thất bại đến ${normalizedEmail}:`, emailErrorMsg);
                                }
                            } catch (emailError) {
                                emailErrorMsg = emailError.message;
                                console.error(`❌ Exception gửi email dòng ${rowNumber}:`, emailError.message);
                            }
                        } else {
                            console.log(`ℹ️ Dòng ${rowNumber}: Không có email để gửi thông báo`);
                        }
                    } else {
                         // Logic gửi lại email như cũ...
                         if (!existingPending.enrolled && normalizedEmail) {
                            console.log(`📧 Pending tồn tại, thử gửi lại email đến: ${normalizedEmail}`);
                            try {
                                const emailResult = await sendPendingEnrollmentEmail(
                                    normalizedEmail,
                                    FullName || normalizedRollNumber,
                                    classExists.name,
                                    normalizedRollNumber
                                );
                                if (emailResult && emailResult.success) {
                                    emailSent = true;
                                    console.log(`✅ Đã gửi LẠI email thành công đến ${normalizedEmail}`);
                                } else {
                                    console.error(`❌ Gửi lại email thất bại: ${emailResult?.error}`);
                                }
                            } catch (e) {
                                console.error(`❌ Lỗi gửi lại email: ${e.message}`);
                            }
                         }
                    }

                    let message = 'Sinh viên chưa đăng ký tài khoản.';
                    if (normalizedEmail) {
                        if (emailSent) {
                            message += ' Đã gửi email thông báo.';
                        } else {
                            message += ` Gửi email thất bại: ${emailErrorMsg || 'Không rõ lỗi'}.`;
                        }
                    } else {
                        message += ' Không có email để gửi thông báo.';
                    }
                    message += ' Sẽ tự động join lớp khi đăng ký.';

                    results.not_found.push({
                        row: rowNumber,
                        rollNumber: normalizedRollNumber,
                        email: normalizedEmail || 'N/A',
                        fullName: FullName || 'N/A',
                        status: 'Pending', // Explicit status
                        message: message
                    });
                    continue;
                } else {
                    console.log(`✅ Dòng ${rowNumber} (${normalizedRollNumber}): Đã có tài khoản -> Enroll vào lớp`);
                }

                // Tìm hoặc tạo Team theo Group
                let teamId = teamMap.get(groupNumber);
                
                if (!teamId) {
                    // Tìm team đã tồn tại với class_id và project_name = "Group {groupNumber}"
                    let team = await Team.findOne({
                        class_id: classId,
                        project_name: `Group ${groupNumber}`
                    });

                    if (!team) {
                        // Tạo team mới
                        team = await Team.create({
                            class_id: classId,
                            project_name: `Group ${groupNumber}`
                        });
                        results.created_teams++;
                    }

                    teamId = team._id.toString();
                    teamMap.set(groupNumber, teamId);
                }

                // Kiểm tra TeamMember đã tồn tại chưa
                const existingMember = await TeamMember.findOne({
                    team_id: teamId,
                    student_id: student._id
                });

                if (existingMember) {
                    // Cập nhật role nếu là leader
                    if (isLeader && existingMember.role_in_team !== 'Leader') {
                        existingMember.role_in_team = 'Leader';
                        await existingMember.save();
                    }
                    results.success.push({
                        row: rowNumber,
                        student: student.full_name || FullName,
                        student_code: student.student_code,
                        action: 'updated',
                        status: 'Enrolled', // Thêm status explicit
                        group: groupNumber,
                        role: isLeader ? 'Leader' : 'Member'
                    });
                } else {
                    // Tạo TeamMember mới (enroll vào lớp)
                    await TeamMember.create({
                        team_id: teamId,
                        student_id: student._id,
                        role_in_team: isLeader ? 'Leader' : 'Member',
                        is_active: true
                    });

                    // Gửi thông báo cho sinh viên
                    NotificationService.sendNotification(
                        student._id,
                        'STUDENT',
                        '🎉 Bạn đã được thêm vào lớp mới',
                        `Bạn đã được thêm vào lớp ${classExists.name} - Nhóm ${groupNumber}`,
                        {
                            class_id: classId,
                            team_id: teamId,
                            type: 'CLASS_ENROLLMENT'
                        },
                        'SYSTEM'
                    );

                    results.created_members++;
                    results.success.push({
                        row: rowNumber,
                        student: student.full_name || FullName,
                        student_code: student.student_code,
                        action: 'enrolled',
                        status: 'Enrolled', // Thêm status explicit
                        group: groupNumber,
                        role: isLeader ? 'Leader' : 'Member'
                    });
                }

            } catch (error) {
                results.errors.push({
                    row: rowNumber,
                    student: studentData.FullName || studentData.RollNumber || 'Unknown',
                    error: error.message
                });
            }
        }

        // Bắn Socket refresh nếu có sinh viên mới (cả Enrolled và Pending)
        if (global._io && (results.created_members > 0 || results.not_found.length > 0)) {
            global._io.to(classId.toString()).emit('refresh_class', {
                message: `Đã import ${results.created_members + results.not_found.length} sinh viên vào lớp (${results.created_members} đã tham gia, ${results.not_found.length} đang chờ đăng ký).`,
                created_count: results.created_members,
                pending_count: results.not_found.length
            });
            console.log(`📡 Đã bắn Socket refresh: Import ${results.created_members} enrolled + ${results.not_found.length} pending vào lớp ${classId}`);
        }

        res.status(200).json({
            message: `✅ Import hoàn tất!`,
            summary: {
                total_rows: students.length,
                success: results.success.length,
                errors: results.errors.length,
                not_found: results.not_found.length, // Sinh viên chưa đăng ký
                created_teams: results.created_teams,
                created_members: results.created_members
            },
            details: {
                success: results.success,
                errors: results.errors,
                not_found: results.not_found.map(nf => ({ ...nf, status: 'Pending' })) // Thêm status cho not_found
            }
        });

    } catch (error) {
        console.error('Import students error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// LẤY DANH SÁCH SINH VIÊN TRONG LỚP
// ==========================================

/**
 * GET /management/classes/:classId/students
 * Lấy danh sách sinh viên trong lớp (bao gồm cả enrolled và pending)
 */
const getStudentsInClass = async (req, res) => {
    try {
        const { classId } = req.params;

        // Validate classId
        if (!require('mongoose').Types.ObjectId.isValid(classId)) {
            return res.status(400).json({ error: 'classId không hợp lệ' });
        }

        // 1. Lấy danh sách sinh viên đã vào lớp (thông qua TeamMember -> Team -> Class)
        // Tìm tất cả Team thuộc Class này
        const teams = await models.Team.find({ class_id: classId }).select('_id project_name');
        const teamIds = teams.map(t => t._id);

        // Tìm tất cả thành viên trong các Team đó (chỉ lấy is_active: true, bỏ qua xóa mềm)
        const members = await models.TeamMember.find({
            team_id: { $in: teamIds },
            is_active: true
        })
            .populate('student_id', 'student_code full_name email avatar_url')
            .populate('team_id', 'project_name')
            .lean();

        // Format lại data cho đẹp
        const enrolledStudents = members.map(m => {
            // Kiểm tra null safety cho student_id (trường hợp data cũ bị lỗi)
            if (!m.student_id) return null;
            
            return {
                _id: m.student_id._id,
                student_code: m.student_id.student_code,
                full_name: m.student_id.full_name,
                email: m.student_id.email,
                avatar_url: m.student_id.avatar_url,
                team: m.team_id ? m.team_id.project_name : 'Unknown Team', // Group 1, Group 2...
                role: m.role_in_team,         // Leader / Member
                status: 'Enrolled'
            };
        }).filter(item => item !== null); // Lọc bỏ null

        // 2. Lấy danh sách sinh viên chưa có tài khoản (PendingEnrollment)
        const pendingStudents = await PendingEnrollment.find({ 
            class_id: classId,
            enrolled: false // Chỉ lấy những người chưa enroll
        }).lean();

        const pendingList = pendingStudents.map(p => ({
            _id: null, // Chưa có account ID
            pending_id: p._id, // <--- THÊM ID của Pending để thao tác Sửa/Xóa
            student_code: p.roll_number,
            full_name: p.full_name,
            email: p.email,
            avatar_url: null,
            team: `Group ${p.group}`,
            role: p.is_leader ? 'Leader' : 'Member',
            status: 'Pending' // Chưa đăng ký tài khoản
        }));

        // 3. Gộp lại
        const allStudents = [...enrolledStudents, ...pendingList];

        // Sắp xếp theo Group rồi đến MSSV
        allStudents.sort((a, b) => {
            if (a.team === b.team) {
                return (a.student_code || '').localeCompare(b.student_code || '');
            }
            return (a.team || '').localeCompare(b.team || '');
        });

        res.json({
            total: allStudents.length,
            enrolled_count: enrolledStudents.length,
            pending_count: pendingList.length,
            students: allStudents
        });

    } catch (error) {
        console.error('Get students in class error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Helper function để tìm hoặc tạo Team
const findOrCreateTeam = async (classId, groupNumber) => {
    let team = await models.Team.findOne({
        class_id: classId,
        project_name: `Group ${groupNumber}`
    });
    if (!team) {
        team = await models.Team.create({
            class_id: classId,
            project_name: `Group ${groupNumber}`
        });
    }
    return team;
};

/**
 * POST /management/classes/:classId/students/add
 * Thêm 1 sinh viên vào lớp thủ công
 */
const addStudentToClass = async (req, res) => {
    try {
        const { classId } = req.params;
        const { full_name, group, is_leader } = req.body;
        // Normalize email and student_code
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const student_code = req.body.student_code ? req.body.student_code.toString().trim().toUpperCase() : '';

        // Validation
        if (!classId || !student_code || !group) {
            return res.status(400).json({ error: 'classId, student_code và group là bắt buộc' });
        }

        const classExists = await models.Class.findById(classId);
        if (!classExists) return res.status(404).json({ error: 'Không tìm thấy lớp học' });

        // Tìm Student
        let student = null;
        if (email) student = await models.Student.findOne({ email });
        if (!student) student = await models.Student.findOne({ student_code });

        if (student) {
            // -- ĐÃ CÓ TÀI KHOẢN --
            // 1. Tìm/Tạo Team
            const team = await findOrCreateTeam(classId, group);

            // 2. Check xem đã vào lớp chưa (thông qua bất kỳ team nào của lớp đó)
            // NOTE: This check is CLASS-SCOPED - students can join teams in different classes
            const classTeams = await models.Team.find({ class_id: classId }).select('_id');
            const classTeamIds = classTeams.map(t => t._id);
            
            console.log(`   🔍 [AddStudent] Checking if student already in THIS class (class_id: ${classId})`);
            console.log(`      - Found ${classTeams.length} team(s) in this class`);
            console.log(`      - Student CAN be in teams in OTHER classes`);
            
            const existingMember = await models.TeamMember.findOne({
                team_id: { $in: classTeamIds },
                student_id: student._id
            });

            if (existingMember) {
                if (existingMember.is_active) {
                    console.log(`   ❌ [AddStudent] Student is already in THIS class`);
                    return res.status(400).json({ error: 'Sinh viên này đã có trong lớp rồi!' });
                }
                // Đã xóa mềm trước đó -> Khôi phục (soft restore)
                let role = 'Member';
                if (is_leader) {
                    await models.TeamMember.updateMany(
                        { team_id: team._id, role_in_team: 'Leader', _id: { $ne: existingMember._id } },
                        { role_in_team: 'Member' }
                    );
                    role = 'Leader';
                }
                await models.TeamMember.findByIdAndUpdate(existingMember._id, {
                    team_id: team._id,
                    role_in_team: role,
                    is_active: true
                });
                
                // ==========================================
                // TỰ ĐỘNG THÊM VÀO PROJECT: Nếu nhóm đã có project
                // ==========================================
                const teamProject = await models.Project.findOne({
                    team_id: team._id
                }).lean();
                
                if (teamProject) {
                    // Kiểm tra xem student đã có trong members chưa
                    const isAlreadyMember = teamProject.members.some(
                        m => m.toString() === student._id.toString()
                    );
                    
                    if (!isAlreadyMember) {
                        await models.Project.updateOne(
                            { _id: teamProject._id },
                            { $addToSet: { members: student._id } }
                        );
                        console.log(`   ✅ [RestoreStudent] Đã thêm student ${student._id} vào project "${teamProject.name}" của nhóm (team ${team._id})`);
                    }
                }
                
                return res.status(200).json({ message: '✅ Đã khôi phục sinh viên vào lớp (Enrolled)!' });
            }

            // 3. Nếu set Leader, check xem team có Leader chưa
            let role = 'Member';
            if (is_leader) {
                await models.TeamMember.updateMany(
                    { team_id: team._id, role_in_team: 'Leader', is_active: true },
                    { role_in_team: 'Member' }
                );
                role = 'Leader';
            }

            // 4. Enroll (tạo mới)
            await models.TeamMember.create({
                team_id: team._id,
                student_id: student._id,
                role_in_team: role,
                is_active: true
            });

            // ==========================================
            // TỰ ĐỘNG THÊM VÀO PROJECT: Nếu nhóm đã có project
            // ==========================================
            const teamProject = await models.Project.findOne({
                team_id: team._id
            }).lean();
            
            if (teamProject) {
                // Kiểm tra xem student đã có trong members chưa
                const isAlreadyMember = teamProject.members.some(
                    m => m.toString() === student._id.toString()
                );
                
                if (!isAlreadyMember) {
                    await models.Project.updateOne(
                        { _id: teamProject._id },
                        { $addToSet: { members: student._id } }
                    );
                    console.log(`   ✅ [AddStudent] Đã thêm student ${student._id} vào project "${teamProject.name}" của nhóm (team ${team._id})`);
                }
            }

            return res.status(201).json({ message: '✅ Đã thêm sinh viên vào lớp thành công (Enrolled)!' });
        } else {
            // -- CHƯA CÓ TÀI KHOẢN (PENDING) --
            // Check duplicate pending
            const existingPending = await PendingEnrollment.findOne({
                class_id: classId,
                roll_number: student_code.trim(),
                enrolled: false
            });

            if (existingPending) {
                return res.status(400).json({ error: 'Sinh viên này đang nằm trong danh sách chờ (Pending) rồi!' });
            }

            await PendingEnrollment.create({
                class_id: classId,
                roll_number: student_code.trim(),
                email: email ? email.toLowerCase().trim() : null,
                full_name: full_name || '',
                group: parseInt(group),
                is_leader: is_leader || false,
                subjectName: classExists.subjectName,
                semester_id: classExists.semester_id,
                lecturer_id: classExists.lecturer_id,
                enrolled: false
            });

            // Gửi email mời (nếu có email)
            if (email) {
                try {
                    await sendPendingEnrollmentEmail(email, full_name, classExists.name, student_code);
                } catch (e) { console.error('Error sending email:', e.message); }
            }

            return res.status(201).json({ message: '✅ Đã thêm vào danh sách chờ (Pending)!' });
        }

    } catch (error) {
        console.error('Add student error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * PUT /management/classes/:classId/students/update
 * Cập nhật thông tin sinh viên (Nhóm, Role)
 */
const updateStudentInClass = async (req, res) => {
    try {
        const { classId } = req.params;
        const { student_id, pending_id, group, is_leader } = req.body;

        if (!group) return res.status(400).json({ error: 'Group là bắt buộc' });
        if (!student_id && !pending_id) return res.status(400).json({ error: 'Cần student_id hoặc pending_id' });

        const classExists = await models.Class.findById(classId);
        if (!classExists) return res.status(404).json({ error: 'Lớp không tồn tại' });

        if (student_id) {
            // -- ENROLLED STUDENT --
            // Tìm tất cả team của lớp
            const classTeams = await models.Team.find({ class_id: classId }).select('_id');
            const classTeamIds = classTeams.map(t => t._id);

            const member = await models.TeamMember.findOne({
                team_id: { $in: classTeamIds },
                student_id: student_id,
                is_active: true
            }).populate('team_id');

            if (!member) return res.status(404).json({ error: 'Không tìm thấy sinh viên trong lớp (hoặc đã bị xóa).' });

            // Check xem có đổi nhóm không
            const currentGroup = parseInt(member.team_id.project_name.replace('Group ', ''));
            const newGroup = parseInt(group);
            
            let targetTeamId = member.team_id._id;

            const oldTeamId = member.team_id._id.toString();
            
            if (currentGroup !== newGroup) {
                // Chuyển nhóm -> Tìm/Tạo team mới
                const newTeam = await findOrCreateTeam(classId, newGroup);
                targetTeamId = newTeam._id;
                member.team_id = newTeam._id; // Update reference
                
                // ==========================================
                // TỰ ĐỘNG CLEANUP PROJECT CŨ: Xóa student khỏi project của nhóm cũ
                // ==========================================
                const oldTeamProjects = await models.Project.find({
                    team_id: oldTeamId,
                    members: student_id
                }).lean();
                
                if (oldTeamProjects.length > 0) {
                    for (const oldProject of oldTeamProjects) {
                        await models.Project.updateOne(
                            { _id: oldProject._id },
                            { $pull: { members: student_id } }
                        );
                        console.log(`   🔧 [UpdateStudent] Đã xóa student ${student_id} khỏi project "${oldProject.name}" của nhóm cũ (team ${oldTeamId})`);
                    }
                }
                
                // ==========================================
                // TỰ ĐỘNG THÊM VÀO PROJECT MỚI: Nếu nhóm mới đã có project
                // ==========================================
                const newTeamProject = await models.Project.findOne({
                    team_id: targetTeamId
                }).lean();
                
                if (newTeamProject) {
                    // Kiểm tra xem student đã có trong members chưa
                    const isAlreadyMember = newTeamProject.members.some(
                        m => m.toString() === student_id.toString()
                    );
                    
                    if (!isAlreadyMember) {
                        await models.Project.updateOne(
                            { _id: newTeamProject._id },
                            { $addToSet: { members: student_id } }
                        );
                        console.log(`   ✅ [UpdateStudent] Đã thêm student ${student_id} vào project "${newTeamProject.name}" của nhóm mới (team ${targetTeamId})`);
                    }
                }
            }

            // Update Role
            if (is_leader !== undefined) {
                const newRole = is_leader ? 'Leader' : 'Member';
                
                // Nếu set lên Leader -> Hạ Leader cũ của targetTeam
                if (newRole === 'Leader') {
                    await models.TeamMember.updateMany(
                        { team_id: targetTeamId, role_in_team: 'Leader', is_active: true, _id: { $ne: member._id } },
                        { role_in_team: 'Member' }
                    );
                }
                member.role_in_team = newRole;
            }

            await member.save();

            // Không cần bắn Socket thủ công nữa - RealtimeService sẽ tự động bắt được
            // (Hybrid Strategy: Change Stream lo việc này)

            return res.json({ message: '✅ Cập nhật sinh viên thành công!' });

        } else if (pending_id) {
            // -- PENDING STUDENT --
            const pending = await PendingEnrollment.findById(pending_id);
            if (!pending) return res.status(404).json({ error: 'Không tìm thấy pending enrollment' });

            if (group) pending.group = parseInt(group);
            if (is_leader !== undefined) pending.is_leader = is_leader;

            await pending.save();
            return res.json({ message: '✅ Cập nhật pending student thành công!' });
        }

    } catch (error) {
        console.error('Update student error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * DELETE /management/classes/:classId/students
 * Xóa sinh viên khỏi lớp (Cascade Remove: TeamMember, Project, JiraTask)
 */
const removeStudentFromClass = async (req, res) => {
    try {
        const { classId } = req.params;
        const { student_id, pending_id } = req.body;

        if (!student_id && !pending_id) return res.status(400).json({ error: 'Cần student_id hoặc pending_id' });

        if (student_id) {
            const classTeamIds = (await models.Team.find({ class_id: classId }).select('_id').lean()).map(t => t._id);
            if (classTeamIds.length === 0) {
                return res.status(404).json({ error: 'Không tìm thấy lớp hoặc chưa có team.' });
            }

            // 1. Lấy danh sách TeamMember cần deactivate (để unassign JiraTask)
            const members = await models.TeamMember.find({
                team_id: { $in: classTeamIds },
                student_id,
                is_active: true
            }).select('_id').lean();

            if (members.length === 0) {
                return res.status(404).json({ error: 'Không tìm thấy sinh viên trong lớp hoặc đã bị xóa trước đó.' });
            }

            const teamMemberIds = members.map(m => m._id);

            // 2. Deactivate tất cả TeamMember của sinh viên trong lớp
            await models.TeamMember.updateMany(
                { _id: { $in: teamMemberIds } },
                { $set: { is_active: false } }
            );

            // 3. $pull student khỏi members của mọi Project trong lớp
            const pullRes = await models.Project.updateMany(
                { class_id: classId, members: student_id },
                { $pull: { members: student_id } }
            );
            if (pullRes.modifiedCount > 0) {
                console.log(`   🔧 [RemoveStudent] Đã xóa student ${student_id} khỏi ${pullRes.modifiedCount} project(s)`);
            }

            // 4. Nếu sinh viên là leader: set leader_id = null
            await models.Project.updateMany(
                { class_id: classId, leader_id: student_id },
                { $set: { leader_id: null } }
            );

            // 5. Unassign JiraTask: gán assignee_id = null cho task đang assign vào TeamMember bị xóa
            const { JiraTask } = require('../models/JiraData');
            const unassignRes = await JiraTask.updateMany(
                { assignee_id: { $in: teamMemberIds } },
                { $set: { assignee_id: null } }
            );
            if (unassignRes.modifiedCount > 0) {
                console.log(`   🔧 [RemoveStudent] Đã unassign ${unassignRes.modifiedCount} JiraTask(s)`);
            }

            // RealtimeService bắt event update TeamMember → bắn action: 'delete'
            return res.json({ message: '✅ Đã xóa sinh viên khỏi lớp!' });

        } else if (pending_id) {
            // -- PENDING --
            await PendingEnrollment.findByIdAndDelete(pending_id);
            return res.json({ message: '✅ Đã xóa sinh viên khỏi danh sách chờ!' });
        }

    } catch (error) {
        console.error('Remove student error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * PUT /api/academic/classes/:classId/contribution-config
 * Cập nhật cấu hình trọng số tính điểm Assignment (Jira, Git, Review)
 */
const updateContributionConfig = async (req, res) => {
    try {
        const { classId } = req.params;
        const { jiraWeight, gitWeight, reviewWeight, allowOverCeiling } = req.body;

        // 1. Validation đầu vào
        if (jiraWeight === undefined || gitWeight === undefined || reviewWeight === undefined) {
            return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ trọng số: jiraWeight, gitWeight, reviewWeight' });
        }

        // 2. Kiểm tra tổng trọng số = 1.0 (Dùng Math.abs để tránh lỗi làm tròn số thập phân của JS)
        const totalWeight = Number(jiraWeight) + Number(gitWeight) + Number(reviewWeight);
        if (Math.abs(totalWeight - 1.0) > 0.01) {
            return res.status(400).json({ 
                error: 'Tổng trọng số (Jira + Git + Review) phải bằng chính xác 1.0 (100%)' 
            });
        }

        // 3. Cập nhật vào Database (Chỉ Giảng viên sở hữu lớp này mới được sửa)
        const updatedClass = await Class.findOneAndUpdate(
            { _id: classId, lecturer_id: req.user._id },
            {
                $set: {
                    contributionConfig: {
                        jiraWeight: Number(jiraWeight),
                        gitWeight: Number(gitWeight),
                        reviewWeight: Number(reviewWeight),
                        allowOverCeiling: Boolean(allowOverCeiling)
                    }
                }
            },
            { new: true } // Trả về document sau khi update
        );

        if (!updatedClass) {
            return res.status(404).json({ error: 'Không tìm thấy lớp học hoặc bạn không có quyền chỉnh sửa lớp này.' });
        }

        res.json({ 
            message: '✅ Đã cập nhật cấu hình trọng số Assignment thành công!', 
            data: updatedClass.contributionConfig 
        });

    } catch (error) {
        console.error('Update Contribution Config Error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    createSemester,
    getSemesters,
    getSemesterById,
    createSubject,
    getSubjects,
    getSubjectById,
    createUser,
    getUsers,
    createClass,
    getClasses,
    getClassById,
    getLecturerClasses,
    importStudents,
    getStudentsInClass,
    addStudentToClass,
    updateStudentInClass,
    removeStudentFromClass,
    updateContributionConfig
};
