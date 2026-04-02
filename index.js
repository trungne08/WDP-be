const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const http = require('http'); // Import HTTP
const { Server } = require("socket.io"); // Import Socket.io

require('dotenv').config(); // Cái này để đọc file .env

const { isOriginAllowed } = require('./utils/frontendUrl');

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
// Render / reverse proxy: để req.protocol và IP client đúng (ảnh hưởng URL public khi build từ request)
app.set('trust proxy', 1);

// 1. Tạo HTTP Server bọc lấy Express App
const server = http.createServer(app);

// 2. Cấu hình Socket.io — dùng cùng logic whitelist với Express (tránh FE Vercel preview / domain lệch bị chặn handshake)
const io = new Server(server, {
  // Mobile / WebView: ưu tiên polling trước khi upgrade websocket (một số mạng chặn WS)
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (isOriginAllowed(origin)) return callback(null, true);
      console.warn('⚠️ Socket.io CORS từ chối origin:', origin);
      return callback(null, false);
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

io.engine.on('connection_error', (err) => {
  console.warn('⚠️ Socket.io engine connection_error:', err?.message || err);
});

// 3. Lưu biến io ra biến toàn cục (Global) để dùng ở bất cứ file nào
global._io = io;
// Gắn vào Express app để controller lấy qua req.app.get('io')
app.set('io', io);

// 4. Lắng nghe kết nối từ Client
io.on('connection', (socket) => {
  console.log('🟢 Client connected to Socket.io');

  // Client gửi 'join_class' kèm classId để vào phòng lớp
  socket.on('join_class', (classId) => {
    const raw = String(classId || '').trim();
    const room = raw.startsWith('class:') ? raw.slice('class:'.length) : raw;
    if (!room) return;
    socket.join(room);
    console.log(`Socket ${socket.id} đã join vào phòng lớp: ${room}`);
  });

  // Client gửi 'join_user' kèm userId để vào phòng riêng (cho Real-time Notification)
  socket.on('join_user', (userId) => {
    const raw = String(userId || '').trim();
    const room = raw.startsWith('user:') ? raw.slice('user:'.length) : raw;
    if (!room) return;
    socket.join(room);
    console.log(`Socket ${socket.id} đã join vào phòng user: ${room}`);
  });

  // Client gửi 'join_project' kèm projectId để nhận realtime theo dự án
  socket.on('join_project', (projectId) => {
    const raw = String(projectId);
    // Đảm bảo format room thống nhất: "project:<projectId>"
    const room = raw.startsWith('project:') ? raw : `project:${raw}`;
    socket.join(room);
    console.log(`Socket ${socket.id} đã join vào phòng project: ${room}`);
  });

  /** Rời room project khi user chuyển trang (FE — gọi `socket.emit('leave_room', projectId)`). */
  socket.on('leave_room', (projectId) => {
    const raw = String(projectId || '').trim();
    if (!raw) return;
    const room = raw.startsWith('project:') ? raw : `project:${raw}`;
    socket.leave(room);
    console.log(`Socket ${socket.id} đã leave phòng project: ${room}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Chặn lỗi runtime khiến Node tự thoát (đặc biệt khi Mongo/ChangeStream lỗi mạng)
process.on('unhandledRejection', (reason) => {
  console.error('❌ [unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ [uncaughtException]', err);
});

// CORS: localhost + Vercel (kể cả *.vercel.app preview) + FRONTEND_URL + backend origin (Socket) — xem utils/frontendUrl.js
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (isOriginAllowed(origin)) return callback(null, origin);
        console.warn('⚠️ CORS từ chối origin:', origin);
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'X-Platform',
        'x-platform',
        'Cache-Control',
        'Pragma',
        'Access-Control-Request-Method',
        'Access-Control-Request-Headers'
    ],
    exposedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400
}));

app.use(express.json());

// File PDF báo cáo từ AI exportReport — GET /exports/<filename>.pdf
app.use('/exports', express.static(path.join(__dirname, 'public', 'exports'), { maxAge: '1h' }));

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
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });
    console.log("✅ Đã kết nối MongoDB thành công!");

    // TẮT ChangeStream (RealtimeService) - chuyển sang event-driven bằng Jira Webhook
    // (RealtimeService theo dõi DB thay đổi qua Mongo ChangeStream gây tải nặng/đứt kết nối trên Atlas Free Tier)
    
  } catch (err) {
    console.error("❌ Lỗi kết nối MongoDB:", err.message);
    // Không cho phép process tự thoát: server vẫn phải sống để nhận Webhook
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