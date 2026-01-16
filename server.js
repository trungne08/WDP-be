const bcrypt = require('bcryptjs'); // Import thư viện
const models = require('./models');

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
};