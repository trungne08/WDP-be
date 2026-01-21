const bcrypt = require('bcryptjs'); // Import thư viện
const models = require('./models');
const TeamController = require('./controllers/TeamController');
const SyncController = require('./controllers/SyncController');

// Export function để setup routes
module.exports = (app) => {
    // API tạo tất cả collections rỗng
    app.get('/api/create-collections', async (req, res) => {
        try {
            const mongoose = require('mongoose');
            const db = mongoose.connection.db;
            const results = [];
            
            // Danh sách tất cả collections cần tạo (theo tên collection thực tế)
            const collections = [
                'admins',
                'lecturers',
                'students',
                'semesters',
                'classes',
                'teams',
                'teammembers',
                'sprints',
                'jiratasks',
                'githubcommits',
                'peerreviews',
                'sprintassessments',
                'riskalerts'
            ];

            // Tạo collection cho từng tên
            for (const collectionName of collections) {
                try {
                    // Kiểm tra xem collection đã tồn tại chưa
                    const existingCollections = await db.listCollections().toArray();
                    const exists = existingCollections.some(c => c.name === collectionName);
                    
                    if (exists) {
                        results.push({ 
                            collection: collectionName, 
                            status: 'already exists',
                            message: `✅ Collection "${collectionName}" đã tồn tại`
                        });
                    } else {
                        // Tạo collection rỗng bằng MongoDB native API
                        await db.createCollection(collectionName);
                        results.push({ 
                            collection: collectionName, 
                            status: 'created',
                            message: `✅ Đã tạo collection rỗng "${collectionName}"`
                        });
                    }
                } catch (err) {
                    results.push({ 
                        collection: collectionName, 
                        status: 'error',
                        message: `❌ Lỗi: ${err.message}`
                    });
                }
            }

            res.json({ 
                msg: "✅ Hoàn thành tạo collections!",
                results: results,
                total: results.length,
                created: results.filter(r => r.status === 'created').length,
                existing: results.filter(r => r.status === 'already exists').length
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/seed-test', async (req, res) => {
        try {
            const count = await models.Admin.countDocuments();
            if (count > 0) return res.send('⚠️ Có Admin rồi, không tạo nữa.');

            // 1. Tạo mật khẩu mã hóa (Hash)
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('123456', salt); // Mật khẩu là 123456

            // 2. Lưu vào DB
            const newAdmin = await models.Admin.create({
                email: "admin@gmail.com",
                full_name: "Super Admin",
                password: hashedPassword, // Lưu chuỗi loằng ngoằng vào đây
                role: "ADMIN"
            });

            res.json({ msg: "✅ Tạo Admin thành công!", data: newAdmin });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.put('/api/teams/:teamId/config', TeamController.updateTeamConfig);

    // 2. API SYNC (User bấm nút Sync -> Server tự chạy)
    app.post('/api/teams/:teamId/sync', SyncController.syncTeamData);

    // API TẠO NHANH TEAM (Chạy cái này để lấy ID chuẩn)
    app.post('/api/seed-team', async (req, res) => {
        try {
            // 1. Import Mongoose rõ ràng
            const mongoose = require('mongoose'); 
            // 2. Import Model Team
            const Team = require('./models/Team'); 

            // 3. Tạo data với ID chuẩn
            const newTeam = await Team.create({
                project_name: "Nhóm Test API Mới Tinh",
                class_id: new mongoose.Types.ObjectId(), // <--- Cú pháp chuẩn là đây
                jira_project_key: "SWP",
                last_sync_at: null
            });
            
            res.json({
                message: "✅ Đã tạo nhóm thành công! Dùng ID này nha:",
                team_id: newTeam._id,
                data: newTeam
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    app.get('/api/check-db', async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const { JiraTask } = require('./models/JiraData'); // Sửa đường dẫn nếu file nằm chỗ khác
        
        const count = await JiraTask.countDocuments();
        const allTasks = await JiraTask.find({});

        res.json({
            message: "🔍 KẾT QUẢ ĐIỀU TRA:",
            database_name: mongoose.connection.name, // <--- ĐÂY LÀ CÁI CHÚNG TA CẦN
            host: mongoose.connection.host,
            total_tasks_found: count,
            data: allTasks
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }});
};