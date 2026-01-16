const bcrypt = require('bcryptjs'); // Import thư viện
const Admin = require('./models/Admin');

app.get('/api/seed-test', async (req, res) => {
    try {
        const count = await Admin.countDocuments();
        if (count > 0) return res.send('⚠️ Có Admin rồi, không tạo nữa.');

        // 1. Tạo mật khẩu mã hóa (Hash)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('123456', salt); // Mật khẩu là 123456

        // 2. Lưu vào DB
        const newAdmin = await Admin.create({
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