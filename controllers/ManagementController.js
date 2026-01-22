const bcrypt = require('bcryptjs');
const models = require('../models');
const Semester = require('../models/Semester');
const Class = require('../models/Class');
const Student = require('../models/Student');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');

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

// ==========================================
// QUẢN LÝ USER (USER MANAGEMENT)
// ==========================================

/**
 * POST /management/users
 * Tạo user (Admin, Lecturer, Mentor)
 */
const createUser = async (req, res) => {
    try {
        const { full_name, email, role } = req.body;

        // Validate required fields
        if (!full_name || !email || !role) {
            return res.status(400).json({
                error: 'full_name, email và role là bắt buộc'
            });
        }

        // Validate role
        if (!['ADMIN', 'LECTURER', 'MENTOR'].includes(role.toUpperCase())) {
            return res.status(400).json({
                error: 'role phải là ADMIN, LECTURER hoặc MENTOR'
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
        } else if (roleUpper === 'MENTOR') {
            // Mentor có thể là Lecturer với role đặc biệt hoặc tạo model riêng
            // Tạm thời tạo như Lecturer
            newUser = await models.Lecturer.create({
                email,
                full_name,
                password: hashedPassword,
                is_verified: true
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

        if (roleUpper === 'LECTURER' || roleUpper === 'MENTOR') {
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
        } else {
            // Lấy tất cả (Admin + Lecturer)
            const admins = await models.Admin.find()
                .select('_id email full_name')
                .lean();
            const lecturers = await models.Lecturer.find()
                .select('_id email full_name avatar_url')
                .lean();
            users = [...admins.map(u => ({ ...u, role: 'ADMIN' })), ...lecturers.map(u => ({ ...u, role: 'LECTURER' }))];
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
        const { name, semester_id, lecturer_id } = req.body;

        // Validate required fields
        if (!name || !semester_id || !lecturer_id) {
            return res.status(400).json({
                error: 'name, semester_id và lecturer_id là bắt buộc'
            });
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

        const newClass = await Class.create({
            name,
            semester_id,
            lecturer_id,
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

/**
 * GET /management/classes?semester_id=...
 * Lấy danh sách lớp (theo học kỳ)
 */
const getClasses = async (req, res) => {
    try {
        const { semester_id } = req.query;

        let query = {};
        if (semester_id) {
            if (!require('mongoose').Types.ObjectId.isValid(semester_id)) {
                return res.status(400).json({
                    error: 'semester_id không hợp lệ'
                });
            }
            query.semester_id = semester_id;
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

        const results = {
            success: [],
            errors: [],
            created_teams: 0,
            created_members: 0,
            not_found: [] // Sinh viên chưa đăng ký
        };

        // Map để lưu team theo Group number
        const teamMap = new Map(); // groupNumber -> teamId

        // Xử lý từng student
        for (let i = 0; i < students.length; i++) {
            const studentData = students[i];
            const rowNumber = i + 1;

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
                    results.errors.push({
                        row: rowNumber,
                        error: 'Thiếu RollNumber (mã số sinh viên)'
                    });
                    continue;
                }

                // Validate Group
                const groupNumber = Group ? parseInt(Group) : null;
                if (!groupNumber || isNaN(groupNumber)) {
                    results.errors.push({
                        row: rowNumber,
                        student: FullName || RollNumber,
                        error: 'Group không hợp lệ'
                    });
                    continue;
                }

                // Kiểm tra Leader (nếu có 'x' hoặc 'X' thì là leader)
                const isLeader = Leader && (Leader.toString().toLowerCase().trim() === 'x' || Leader.toString().toLowerCase().trim() === 'leader');

                // Tìm Student đã đăng ký
                // Logic: Ưu tiên tìm theo Email (K18 trở về trước), nếu không có thì tìm theo RollNumber (K19+)
                let student = null;
                
                if (Email && Email.trim()) {
                    // K18 trở về trước: Tìm theo email
                    student = await Student.findOne({
                        email: Email.toLowerCase().trim()
                    });
                }
                
                // Nếu không tìm thấy theo email, tìm theo student_code (K19+)
                if (!student) {
                    student = await Student.findOne({
                        student_code: RollNumber.trim()
                    });
                }

                // Nếu vẫn không tìm thấy → sinh viên chưa đăng ký
                if (!student) {
                    results.not_found.push({
                        row: rowNumber,
                        rollNumber: RollNumber,
                        email: Email || 'N/A',
                        fullName: FullName || 'N/A',
                        message: 'Sinh viên chưa đăng ký tài khoản. Vui lòng yêu cầu sinh viên đăng ký trước.'
                    });
                    continue;
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
                    results.created_members++;
                    results.success.push({
                        row: rowNumber,
                        student: student.full_name || FullName,
                        student_code: student.student_code,
                        action: 'enrolled',
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
                not_found: results.not_found // Danh sách sinh viên chưa đăng ký
            }
        });

    } catch (error) {
        console.error('Import students error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    createSemester,
    getSemesters,
    createUser,
    getUsers,
    createClass,
    getClasses,
    importStudents
};
