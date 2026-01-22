const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const Student = require('../models/Student');
const GithubCommit = require('../models/GitData');
const { Sprint, JiraTask } = require('../models/JiraData');

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

function pick(obj, keys) {
    const out = {};
    for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
    return out;
}

function genStudentCode() {
    const num = Math.floor(100000 + Math.random() * 900000);
    return `SE${num}`;
}

// POST /teams - Tạo nhóm dự án (thay thế seed-team)
exports.createTeam = async (req, res) => {
    try {
        const { project_name, class_id } = req.body;

        // Validate required fields
        if (!project_name || !class_id) {
            return res.status(400).json({
                error: 'project_name và class_id là bắt buộc'
            });
        }

        // Validate class_id
        if (!isValidObjectId(class_id)) {
            return res.status(400).json({
                error: 'class_id không hợp lệ'
            });
        }

        // Kiểm tra class tồn tại
        const Class = require('../models/Class');
        const classExists = await Class.findById(class_id);
        if (!classExists) {
            return res.status(404).json({
                error: 'Không tìm thấy lớp học'
            });
        }

        const newTeam = await Team.create({
            project_name,
            class_id,
            jira_project_key: '',
            last_sync_at: null
        });

        // Populate để trả về thông tin đầy đủ
        const teamWithDetails = await Team.findById(newTeam._id)
            .populate('class_id', 'name class_code')
            .lean();

        res.status(201).json({
            message: '✅ Tạo nhóm dự án thành công!',
            team: teamWithDetails
        });
    } catch (error) {
        console.error('Create team error:', error);
        res.status(500).json({ error: error.message });
    }
};

// GET /teams?class_id=... - Lấy danh sách nhóm trong một lớp cụ thể
exports.getTeams = async (req, res) => {
    try {
        const { class_id } = req.query;

        let query = {};
        if (class_id) {
            if (!isValidObjectId(class_id)) {
                return res.status(400).json({
                    error: 'class_id không hợp lệ'
                });
            }
            query.class_id = class_id;
        }

        const teams = await Team.find(query)
            .populate('class_id', 'name class_code')
            .sort({ created_at: -1 })
            .lean();

        res.json({
            total: teams.length,
            teams
        });
    } catch (error) {
        console.error('Get teams error:', error);
        res.status(500).json({ error: error.message });
    }
};

// 3) GET /teams/:teamId
exports.getTeam = async (req, res) => {
    try {
        const { teamId } = req.params;
        if (!isValidObjectId(teamId)) return res.status(400).json({ error: 'teamId không hợp lệ' });

        const team = await Team.findById(teamId).lean();
        if (!team) return res.status(404).json({ error: 'Không tìm thấy team' });

        const [memberCount, sprintCount, githubCommits] = await Promise.all([
            TeamMember.countDocuments({ team_id: teamId }),
            Sprint.countDocuments({ team_id: teamId }),
            GithubCommit.countDocuments({ team_id: teamId })
        ]);

        const sprints = await Sprint.find({ team_id: teamId }).select('_id').lean();
        const sprintIds = sprints.map(s => s._id);
        const jiraTasks = sprintIds.length === 0 ? 0 : await JiraTask.countDocuments({ sprint_id: { $in: sprintIds } });

        res.json({
            team,
            counts: {
                members: memberCount,
                sprints: sprintCount,
                tasks: jiraTasks,
                commits: githubCommits
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 5) GET /teams/:teamId/sync-history
exports.getSyncHistory = async (req, res) => {
    try {
        const { teamId } = req.params;
        if (!isValidObjectId(teamId)) return res.status(400).json({ error: 'teamId không hợp lệ' });

        const team = await Team.findById(teamId).select('last_sync_at sync_history').lean();
        if (!team) return res.status(404).json({ error: 'Không tìm thấy team' });

        res.json({
            last_sync_at: team.last_sync_at || null,
            history: team.sync_history || []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 6) POST /teams/:teamId/seed-members
exports.seedMembers = async (req, res) => {
    try {
        const { teamId } = req.params;
        if (!isValidObjectId(teamId)) return res.status(400).json({ error: 'teamId không hợp lệ' });

        const team = await Team.findById(teamId);
        if (!team) return res.status(404).json({ error: 'Không tìm thấy team' });

        const count = Math.min(50, Math.max(1, Number(req.body?.count || 5)));
        const created = [];

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('123456', salt);

        for (let i = 0; i < count; i++) {
            // Create student
            let student_code = genStudentCode();
            // Ensure unique
            // Try a few times
            for (let t = 0; t < 5; t++) {
                const exists = await Student.findOne({ student_code }).select('_id');
                if (!exists) break;
                student_code = genStudentCode();
            }

            const email = `student${Date.now()}${i}@fpt.edu.vn`;
            const student = await Student.create({
                student_code,
                email,
                password: hashedPassword,
                full_name: `Student ${i + 1}`,
                avatar_url: '',
                major: 'Software Engineering'
            });

            const member = await TeamMember.create({
                team_id: teamId,
                student_id: student._id,
                role_in_team: i === 0 ? 'Leader' : 'Member',
                is_active: true
            });

            created.push({ student, member });
        }

        res.json({
            message: '✅ Seed members thành công!',
            created_count: created.length,
            default_password: '123456'
        });
    } catch (error) {
        // If unique email error, just return message
        res.status(500).json({ error: error.message });
    }
};

// 7) GET /teams/:teamId/members
exports.getMembers = async (req, res) => {
    try {
        const { teamId } = req.params;
        if (!isValidObjectId(teamId)) {
            return res.status(400).json({ error: 'teamId không hợp lệ' });
        }

        // Kiểm tra team có tồn tại không
        const team = await Team.findById(teamId).select('_id').lean();
        if (!team) {
            return res.status(404).json({ error: 'Không tìm thấy team' });
        }

        const members = await TeamMember.find({ team_id: teamId })
            .populate('student_id', 'student_code email full_name avatar_url major')
            .lean();

        const mapped = members.map(m => ({
            _id: m._id,
            role_in_team: m.role_in_team,
            is_active: m.is_active,
            jira_account_id: m.jira_account_id || null,
            github_username: m.github_username || null,
            mapping_status: {
                jira: Boolean(m.jira_account_id),
                github: Boolean(m.github_username)
            },
            student: m.student_id
        }));

        res.json({ total: mapped.length, members: mapped });
    } catch (error) {
        console.error('getMembers error:', error);
        res.status(500).json({ error: error.message });
    }
};

// 8) GET /teams/:teamId/jira-users
exports.getJiraUsers = async (req, res) => {
    try {
        const { teamId } = req.params;
        if (!isValidObjectId(teamId)) {
            return res.status(400).json({ error: 'teamId không hợp lệ' });
        }

        // Kiểm tra team có tồn tại không
        const team = await Team.findById(teamId).select('_id').lean();
        if (!team) {
            return res.status(404).json({ error: 'Không tìm thấy team' });
        }

        const sprints = await Sprint.find({ team_id: teamId }).select('_id').lean();
        const sprintIds = sprints.map(s => s._id);
        
        if (sprintIds.length === 0) {
            return res.json({ total: 0, users: [] });
        }

        const tasks = await JiraTask.find({ sprint_id: { $in: sprintIds } })
            .select('assignee_account_id assignee_name')
            .lean();

        const map = new Map();
        for (const t of tasks) {
            if (!t.assignee_account_id) continue;
            if (!map.has(t.assignee_account_id)) {
                map.set(t.assignee_account_id, {
                    jira_account_id: t.assignee_account_id,
                    display_name: t.assignee_name || 'Unknown'
                });
            }
        }

        res.json({ total: map.size, users: Array.from(map.values()) });
    } catch (error) {
        console.error('getJiraUsers error:', error);
        res.status(500).json({ error: error.message });
    }
};

// 9) PUT /members/:memberId/mapping
exports.updateMemberMapping = async (req, res) => {
    try {
        const { memberId } = req.params;
        if (!isValidObjectId(memberId)) return res.status(400).json({ error: 'memberId không hợp lệ' });

        const { jira_account_id, github_username } = req.body || {};
        if (!jira_account_id && !github_username) {
            return res.status(400).json({ error: 'Cần ít nhất jira_account_id hoặc github_username' });
        }

        const updated = await TeamMember.findByIdAndUpdate(
            memberId,
            pick(
                {
                    jira_account_id,
                    github_username
                },
                ['jira_account_id', 'github_username']
            ),
            { new: true }
        ).lean();

        if (!updated) return res.status(404).json({ error: 'Không tìm thấy member' });

        // Best-effort: update JiraTask.assignee_id for tasks already synced
        if (jira_account_id) {
            const sprints = await Sprint.find({ team_id: updated.team_id }).select('_id').lean();
            const sprintIds = sprints.map(s => s._id);
            await JiraTask.updateMany(
                { sprint_id: { $in: sprintIds }, assignee_account_id: jira_account_id },
                { assignee_id: updated._id }
            );
        }

        res.json({ message: '✅ Cập nhật mapping thành công!', member: updated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Helper to resolve sprint filter
async function resolveSprintIds(teamId, sprintId) {
    if (!sprintId) {
        const sprints = await Sprint.find({ team_id: teamId }).select('_id').lean();
        return sprints.map(s => s._id);
    }
    // sprintId can be mongo ObjectId or jira_sprint_id (number)
    if (isValidObjectId(sprintId)) return [new mongoose.Types.ObjectId(sprintId)];
    const num = Number(sprintId);
    if (!Number.isFinite(num)) return [];
    const sprints = await Sprint.find({ team_id: teamId, jira_sprint_id: num }).select('_id').lean();
    return sprints.map(s => s._id);
}

// 11) GET /teams/:teamId/tasks?sprintId=&status=
exports.getTasks = async (req, res) => {
    try {
        const { teamId } = req.params;
        if (!isValidObjectId(teamId)) return res.status(400).json({ error: 'teamId không hợp lệ' });

        const { sprintId, status } = req.query || {};
        const sprintIds = await resolveSprintIds(teamId, sprintId);
        if (sprintId && sprintIds.length === 0) return res.json({ total: 0, tasks: [] });

        const q = { sprint_id: { $in: sprintIds } };
        if (status) {
            q.$or = [{ status_category: status }, { status_name: status }];
        }

        const tasks = await JiraTask.find(q)
            .populate({
                path: 'assignee_id',
                select: 'jira_account_id github_username role_in_team student_id',
                populate: { path: 'student_id', select: 'student_code email full_name' }
            })
            .sort({ updated_at: -1 })
            .lean();

        res.json({ total: tasks.length, tasks });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 12) GET /teams/:teamId/commits?limit=10
exports.getCommits = async (req, res) => {
    try {
        const { teamId } = req.params;
        if (!isValidObjectId(teamId)) return res.status(400).json({ error: 'teamId không hợp lệ' });

        const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 10)));
        const commits = await GithubCommit.find({ team_id: teamId })
            .sort({ commit_date: -1 })
            .limit(limit)
            .lean();

        res.json({ total: commits.length, commits });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 10) GET /teams/:teamId/dashboard
exports.getDashboard = async (req, res) => {
    try {
        const { teamId } = req.params;
        if (!isValidObjectId(teamId)) return res.status(400).json({ error: 'teamId không hợp lệ' });

        const team = await Team.findById(teamId).lean();
        if (!team) return res.status(404).json({ error: 'Không tìm thấy team' });

        const sprints = await Sprint.find({ team_id: teamId }).lean();
        const sprintIds = sprints.map(s => s._id);

        const [tasks, commits] = await Promise.all([
            JiraTask.find({ sprint_id: { $in: sprintIds } }).select('status_category story_point').lean(),
            GithubCommit.find({ team_id: teamId }).select('is_counted commit_date').lean()
        ]);

        const totalTasks = tasks.length;
        const doneTasks = tasks.filter(t => t.status_category === 'Done').length;
        const spTotal = tasks.reduce((a, t) => a + (Number(t.story_point) || 0), 0);
        const spDone = tasks.filter(t => t.status_category === 'Done').reduce((a, t) => a + (Number(t.story_point) || 0), 0);

        const totalCommits = commits.length;
        const countedCommits = commits.filter(c => c.is_counted).length;
        const lastCommit = commits.sort((a, b) => new Date(b.commit_date) - new Date(a.commit_date))[0];

        const activeSprints = sprints.filter(s => (s.state || '').toLowerCase() === 'active');

        res.json({
            team: {
                _id: team._id,
                project_name: team.project_name,
                last_sync_at: team.last_sync_at || null
            },
            overview: {
                tasks: {
                    total: totalTasks,
                    done: doneTasks,
                    todo: totalTasks - doneTasks,
                    done_percent: totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100),
                    story_point_total: spTotal,
                    story_point_done: spDone
                },
                commits: {
                    total: totalCommits,
                    counted: countedCommits,
                    last_commit_date: lastCommit ? lastCommit.commit_date : null
                },
                sprints: {
                    total: sprints.length,
                    active: activeSprints.length
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 13) GET /teams/:teamId/ranking
exports.getRanking = async (req, res) => {
    try {
        const { teamId } = req.params;
        if (!isValidObjectId(teamId)) return res.status(400).json({ error: 'teamId không hợp lệ' });

        const members = await TeamMember.find({ team_id: teamId })
            .populate('student_id', 'student_code email full_name')
            .lean();

        const sprints = await Sprint.find({ team_id: teamId }).select('_id').lean();
        const sprintIds = sprints.map(s => s._id);

        const tasks = await JiraTask.find({ sprint_id: { $in: sprintIds } })
            .select('assignee_account_id status_category story_point')
            .lean();

        const commits = await GithubCommit.find({ team_id: teamId, is_counted: true })
            .select('author_email')
            .lean();

        const commitsByEmail = new Map();
        for (const c of commits) {
            const key = (c.author_email || '').toLowerCase();
            if (!key) continue;
            commitsByEmail.set(key, (commitsByEmail.get(key) || 0) + 1);
        }

        const taskAggByJiraId = new Map();
        for (const t of tasks) {
            const jiraId = t.assignee_account_id;
            if (!jiraId) continue;
            const prev = taskAggByJiraId.get(jiraId) || { done_count: 0, done_sp: 0, total_count: 0, total_sp: 0 };
            const sp = Number(t.story_point) || 0;
            prev.total_count += 1;
            prev.total_sp += sp;
            if (t.status_category === 'Done') {
                prev.done_count += 1;
                prev.done_sp += sp;
            }
            taskAggByJiraId.set(jiraId, prev);
        }

        const rows = members.map(m => {
            const email = (m.student_id?.email || '').toLowerCase();
            const jiraId = m.jira_account_id || null;
            const taskAgg = jiraId ? taskAggByJiraId.get(jiraId) : null;

            return {
                member_id: m._id,
                student: m.student_id,
                role_in_team: m.role_in_team,
                mapping: {
                    jira_account_id: m.jira_account_id || null,
                    github_username: m.github_username || null
                },
                jira: {
                    done_tasks: taskAgg ? taskAgg.done_count : 0,
                    done_story_points: taskAgg ? taskAgg.done_sp : 0,
                    total_tasks: taskAgg ? taskAgg.total_count : 0,
                    total_story_points: taskAgg ? taskAgg.total_sp : 0
                },
                github: {
                    counted_commits: email ? commitsByEmail.get(email) || 0 : 0
                }
            };
        });

        // Sort: done_story_points desc, then counted_commits desc
        rows.sort((a, b) => {
            if (b.jira.done_story_points !== a.jira.done_story_points) return b.jira.done_story_points - a.jira.done_story_points;
            return b.github.counted_commits - a.github.counted_commits;
        });

        res.json({ total: rows.length, ranking: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// CHECK ROLE CỦA USER TRONG TEAM
// ==========================================
/**
 * GET /api/teams/:teamId/my-role
 * Kiểm tra role của user hiện tại trong team (Leader hoặc Member)
 * Dùng cho FE để check quyền (chức năng chỉ Leader mới có)
 */
exports.getMyRoleInTeam = async (req, res) => {
    try {
        const { teamId } = req.params;
        
        if (!isValidObjectId(teamId)) {
            return res.status(400).json({ error: 'teamId không hợp lệ' });
        }

        // req.user và req.role đã được set bởi authenticateToken middleware
        const user = req.user;
        const role = req.role;

        // Chỉ cho phép STUDENT
        if (role !== 'STUDENT') {
            return res.status(403).json({
                error: 'Chỉ sinh viên mới có thể check role trong team'
            });
        }

        // Kiểm tra team tồn tại
        const team = await Team.findById(teamId).select('_id').lean();
        if (!team) {
            return res.status(404).json({ error: 'Không tìm thấy team' });
        }

        // Tìm TeamMember
        const teamMember = await TeamMember.findOne({
            team_id: teamId,
            student_id: user._id,
            is_active: true
        }).lean();

        if (!teamMember) {
            return res.status(404).json({
                error: 'Bạn không phải là thành viên của team này'
            });
        }

        res.json({
            team_id: teamId,
            role_in_team: teamMember.role_in_team, // 'Leader' hoặc 'Member'
            is_leader: teamMember.role_in_team === 'Leader',
            is_member: teamMember.role_in_team === 'Member'
        });
    } catch (error) {
        console.error('getMyRoleInTeam error:', error);
        res.status(500).json({ error: error.message });
    }
};

