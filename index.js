const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config(); // Cái này để đọc file .env

const app = express();

// Cho phép các web khác gọi vào API của mình (CORS)
app.use(cors());
app.use(express.json());

// Kết nối tới MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Đã kết nối MongoDB thành công!");
  } catch (err) {
    console.error("❌ Lỗi kết nối MongoDB:", err.message);
    process.exit(1); // Lỗi thì dừng server luôn
  }
};

connectDB();

// Import routes từ server.js
const setupRoutes = require('./server');
setupRoutes(app);

// API Test thử xem server sống hay chết
app.get('/', (req, res) => {
  res.send('Backend SWP đang chạy ngon lành cành đào!');
});

// Chạy server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});