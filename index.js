const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
require('dotenv').config(); // Cái này để đọc file .env

const app = express();

// Cho phép các web khác gọi vào API của mình (CORS)
app.use(cors());
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

// API Test thử xem server sống hay chết
app.get('/', (req, res) => {
  res.send('Backend WDP đang chạy ngon lành cành đào!<br><a href="/api-docs">📚 Xem Swagger Documentation</a>');
});

// Chạy server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});