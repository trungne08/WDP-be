const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            // Các options này giúp tránh lỗi warning của driver mới
            // Nếu bạn dùng Mongoose v6 trở lên thì không cần dòng này cũng được, nhưng cứ để cho chắc
        });

        console.log(`✅ MongoDB Atlas Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1); // Dừng chương trình nếu lỗi
    }
};

module.exports = connectDB;