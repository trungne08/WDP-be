const admin = require('firebase-admin');
require('dotenv').config();

let serviceAccount;

try {
    // Ưu tiên 1: Lấy từ biến môi trường (Dùng cho Render/Production)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } 
    // Ưu tiên 2: Lấy từ file local (Dùng cho Local Development)
    else {
        serviceAccount = require('./firebase-service-account.json');
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('🔥 Firebase Admin Initialized successfully');
} catch (error) {
    console.error('❌ Firebase Admin Initialization Error:', error.message);
    console.error('⚠️  Lưu ý: Trên Render, hãy copy nội dung file firebase-service-account.json vào biến môi trường tên là FIREBASE_SERVICE_ACCOUNT');
}

module.exports = admin;