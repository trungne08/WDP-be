const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

// 1. Load biến môi trường từ file .env
dotenv.config();

// 2. Kết nối Database
connectDB();

const app = express();

// Middleware để đọc JSON gửi lên
app.use(express.json());

// --- ROUTES CỦA BẠN SẼ NẰM Ở ĐÂY ---
app.get('/', (req, res) => {
    res.send('API is running...');
});

// 3. Chạy server với PORT từ .env (5000)
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on PORT ${PORT}`);
});