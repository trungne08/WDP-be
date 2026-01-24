const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('🔥 Firebase Admin Initialized successfully');
} catch (error) {
    console.error('❌ Firebase Admin Initialization Error:', error);
}

module.exports = admin;
