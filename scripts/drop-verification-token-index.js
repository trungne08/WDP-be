const mongoose = require('mongoose');
require('dotenv').config();

async function dropIndex() {
    try {
        // Kết nối MongoDB - đảm bảo database name là WDP
        let mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/WDP';
        
        // Normalize URI để đảm bảo database name là WDP
        // Nếu URI không có database name (chỉ có ? hoặc kết thúc bằng /), thêm /WDP
        if (mongoUri.includes('mongodb+srv://')) {
            // MongoDB Atlas URI
            if (!mongoUri.match(/\/[^\/?]+(\?|$)/)) {
                // Không có database name, thêm /WDP
                mongoUri = mongoUri.replace(/\/(\?|$)/, '/WDP$1');
            } else if (!mongoUri.includes('/WDP')) {
                // Có database name khác, thay bằng WDP
                mongoUri = mongoUri.replace(/\/[^\/?]+(\?|$)/, '/WDP$1');
            }
        } else {
            // Standard MongoDB URI
            if (!mongoUri.match(/\/[^\/?]+(\?|$)/)) {
                mongoUri = mongoUri.replace(/\/$/, '') + '/WDP';
            } else if (!mongoUri.includes('/WDP')) {
                mongoUri = mongoUri.replace(/\/[^\/?]+(\?|$)/, '/WDP$1');
            }
        }
        
        await mongoose.connect(mongoUri);
        console.log('✅ Đã kết nối MongoDB');
        console.log('📦 Database:', mongoose.connection.db.databaseName);

        // Lấy collection
        const db = mongoose.connection.db;
        const collection = db.collection('otps');

        // Liệt kê tất cả indexes
        const indexes = await collection.indexes();
        console.log('\n📋 Danh sách indexes hiện tại:');
        indexes.forEach(index => {
            console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
        });

        // Xóa index verification_token_1 nếu tồn tại
        try {
            await collection.dropIndex('verification_token_1');
            console.log('\n✅ Đã xóa index verification_token_1');
        } catch (err) {
            if (err.code === 27 || err.message.includes('index not found')) {
                console.log('\n⚠️  Index verification_token_1 không tồn tại (đã xóa rồi)');
            } else {
                throw err;
            }
        }

        // Liệt kê lại indexes sau khi xóa
        const indexesAfter = await collection.indexes();
        console.log('\n📋 Danh sách indexes sau khi xóa:');
        indexesAfter.forEach(index => {
            console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
        });

        console.log('\n✅ Hoàn tất!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Lỗi:', error);
        process.exit(1);
    }
}

dropIndex();
