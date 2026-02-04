const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const http = require('http'); // Import HTTP
const { Server } = require("socket.io"); // Import Socket.io

require('dotenv').config(); // Cái này để đọc file .env

// Log env OAuth (chỉ báo có/không, không in giá trị) để dễ check trên Render
const oauthEnv = {
  github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CLIENT_ID_WEB', 'GITHUB_CLIENT_SECRET_WEB', 'GITHUB_CLIENT_ID_MOBILE', 'GITHUB_CLIENT_SECRET_MOBILE'],
  atlassian: ['ATLASSIAN_CLIENT_ID', 'ATLASSIAN_CLIENT_SECRET', 'ATLASSIAN_CALLBACK_URL']
};
const has = (key) => !!(process.env[key] && process.env[key].trim());
const logEnv = (group, keys) => {
  const set = keys.filter(has);
  const miss = keys.filter(k => !has(k));
  if (set.length) console.log(`🔑 OAuth env ${group}: có ${set.join(', ')}`);
  if (miss.length) console.warn(`⚠️ OAuth env ${group} (chưa set): ${miss.join(', ')}`);
};
logEnv('GitHub', oauthEnv.github);
logEnv('Atlassian', oauthEnv.atlassian);

// Initialize Passport (cần import để load Google OAuth strategy)
require('./config/passport');

const app = express();

// 1. Tạo HTTP Server bọc lấy Express App
const server = http.createServer(app);

// 2. Cấu hình Socket.io
const io = new Server(server, {
  cors: {
    // Cho phép Frontend (tất cả origin) kết nối
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// 3. Lưu biến io ra biến toàn cục (Global) để dùng ở bất cứ file nào
global._io = io;

// 4. Lắng nghe kết nối từ Client
io.on('connection', (socket) => {
  console.log('⚡ Client connected:', socket.id);

  // Client sẽ gửi sự kiện 'join_class' kèm classId để vào phòng riêng
  socket.on('join_class', (classId) => {
    socket.join(classId);
    console.log(`Socket ${socket.id} đã join vào phòng lớp: ${classId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Cho phép các web khác gọi vào API của mình (CORS) - Full CORS enabled
app.use(cors({
    origin: function (origin, callback) {
        // Cho phép tất cả origins (bao gồm cả null cho same-origin requests)
        callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'], // Cho phép tất cả methods
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Access-Control-Request-Method', 'Access-Control-Request-Headers'], // Cho phép tất cả headers
    exposedHeaders: ['Content-Type', 'Authorization'], // Headers mà client có thể đọc được
    credentials: false, // Không cần credentials cho OAuth callbacks
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400 // Cache preflight requests trong 24 giờ
}));

app.use(express.json());

// Nếu MONGO_URI không chỉ rõ database name, Mongo sẽ mặc định dùng "test".
// Mặc định project này dùng DB "SWD" để đúng yêu cầu.
function normalizeMongoUri(uri) {
  const fallbackDb = 'WDP';
  if (!uri || typeof uri !== 'string') return `mongodb://localhost:27017/${fallbackDb}`;

  // If user already provides db name in path (e.g. mongodb://host:27017/mydb or .../mydb?x=y) => keep
  // If path is missing or just "/" => append /SWD before querystring
  const [base, query] = uri.split('?');
  const hasDbInPath = /mongodb(\+srv)?:\/\/[^/]+\/[^/?]+$/.test(base);
  const endsWithSlash = /mongodb(\+srv)?:\/\/[^/]+\/?$/.test(base);

  if (hasDbInPath) return uri;
  if (endsWithSlash) {
    const fixedBase = base.endsWith('/') ? `${base}${fallbackDb}` : `${base}/${fallbackDb}`;
    return query ? `${fixedBase}?${query}` : fixedBase;
  }

  return uri;
}

// Kết nối tới MongoDB
const connectDB = async () => {
  try {
    const mongoUri = normalizeMongoUri(process.env.MONGO_URI);
    await mongoose.connect(mongoUri);
    console.log("✅ Đã kết nối MongoDB thành công!");
    
    // Kích hoạt "Camera chạy bằng cơm" soi DB (Realtime Service)
    // Chỉ kích hoạt khi đã connect DB thành công
    require('./services/RealtimeService').watchTeamMembers();
    
  } catch (err) {
    console.error("❌ Lỗi kết nối MongoDB:", err.message);
    process.exit(1); // Lỗi thì dừng server luôn
  }
};

connectDB();

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'WDP API Documentation',
    swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true
    }
}));

// Import routes từ server.js
const setupRoutes = require('./server');
setupRoutes(app);

// Khởi chạy Cron Job (Tác vụ ngầm)
const { initScheduledJobs } = require('./services/CronService');
initScheduledJobs();

// API Test thử xem server sống hay chết
app.get('/', (req, res) => {
  res.send('Backend WDP đang chạy ngon lành cành đào!<br><a href="/api-docs">📚 Xem Swagger Documentation</a>');
});

// Chạy server
const PORT = process.env.PORT || 5000;
// SỬA: Dùng server.listen thay vì app.listen
server.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});