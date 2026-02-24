/**
 * Script kiểm tra cấu hình Jira OAuth
 * Chạy: node scripts/verify-jira-config.js
 */

require('dotenv').config();

console.log('\n🔍 KIỂM TRA CẤU HÌNH JIRA OAUTH\n');
console.log('='.repeat(60));

// 1. Check Environment Variables
console.log('\n📋 Environment Variables:');
console.log('-'.repeat(60));

const clientId = process.env.ATLASSIAN_CLIENT_ID;
const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
const callbackUrl = process.env.ATLASSIAN_CALLBACK_URL;
const jwtSecret = process.env.JWT_SECRET;

console.log(`ATLASSIAN_CLIENT_ID:      ${clientId ? '✅ OK (' + clientId.substring(0, 10) + '...' + ')' : '❌ THIẾU'}`);
console.log(`ATLASSIAN_CLIENT_SECRET:  ${clientSecret ? '✅ OK (***hidden***)' : '❌ THIẾU'}`);
console.log(`ATLASSIAN_CALLBACK_URL:   ${callbackUrl || '⚠️  KHÔNG CÓ (sẽ dùng default)'}`);
console.log(`JWT_SECRET:               ${jwtSecret ? '✅ OK (***hidden***)' : '⚠️  KHÔNG CÓ (sẽ dùng default)'}`);

// 2. Check Required Scopes
console.log('\n📦 Required Scopes:');
console.log('-'.repeat(60));

const JiraAuthService = require('../services/JiraAuthService');
const requiredScopes = JiraAuthService.JIRA_SCOPES.split(' ');

console.log('Code yêu cầu các scopes sau:');
requiredScopes.forEach((scope, idx) => {
  const description = {
    'offline_access': 'Lấy refresh token (BẮT BUỘC)',
    'read:issue:jira': 'Đọc issues',
    'write:issue:jira': 'Tạo/sửa issues',
    'delete:issue:jira': 'Xóa issues',
    'read:project:jira': 'Đọc projects',
    'write:project:jira': 'Tạo/sửa projects',
    'read:user:jira': 'Đọc user info',
    'read:me': 'Đọc profile user hiện tại'
  }[scope] || '';
  
  console.log(`   ${idx + 1}. ${scope.padEnd(25)} → ${description}`);
});

// 3. Validation Summary
console.log('\n📊 VALIDATION SUMMARY:');
console.log('='.repeat(60));

const issues = [];

if (!clientId) {
  issues.push('❌ THIẾU ATLASSIAN_CLIENT_ID trong .env');
}

if (!clientSecret) {
  issues.push('❌ THIẾU ATLASSIAN_CLIENT_SECRET trong .env');
}

if (!callbackUrl) {
  issues.push('⚠️  Không có ATLASSIAN_CALLBACK_URL (sẽ dùng default)');
}

if (callbackUrl && !callbackUrl.match(/^(https?:\/\/|syncapp:\/\/)/)) {
  issues.push('⚠️  ATLASSIAN_CALLBACK_URL không hợp lệ (phải bắt đầu bằng http://, https://, hoặc syncapp://)');
}

if (!jwtSecret) {
  issues.push('⚠️  Không có JWT_SECRET (sẽ dùng default - KHÔNG AN TOÀN cho production!)');
}

if (issues.length === 0) {
  console.log('✅ Environment variables OK!');
} else {
  console.log('Có vấn đề cần fix:');
  issues.forEach(issue => console.log(`   ${issue}`));
}

// 4. Next Steps
console.log('\n🎯 NEXT STEPS:');
console.log('='.repeat(60));

if (issues.some(i => i.includes('❌'))) {
  console.log('1. ❌ Fix các biến env thiếu trong file .env');
  console.log('2. Restart server sau khi update .env');
  console.log('3. Chạy lại script này để verify');
} else {
  console.log('✅ Environment variables OK!');
  console.log('');
  console.log('Bước tiếp theo:');
  console.log('');
  console.log('1. 🌐 Truy cập Atlassian Developer Console:');
  console.log('   https://developer.atlassian.com/console/myapps/');
  console.log('');
  console.log('2. 🔧 Kiểm tra OAuth App của bạn:');
  console.log(`   - Client ID khớp: ${clientId ? clientId : 'N/A'}`);
  console.log(`   - Callback URL khớp: ${callbackUrl || 'default'}`);
  console.log('');
  console.log('3. ✅ Vào tab "Permissions" và add TẤT CẢ 8 scopes trên');
  console.log('');
  console.log('4. 💾 Save changes và chờ 1-2 phút');
  console.log('');
  console.log('5. 🔄 Users phải DISCONNECT và RECONNECT Jira:');
  console.log('   - API: DELETE /api/integrations/jira/disconnect');
  console.log('   - API: GET /api/integrations/jira/connect');
  console.log('');
  console.log('6. 🧪 Test token với script:');
  console.log('   node scripts/check-jira-scopes.js');
}

console.log('\n' + '='.repeat(60));
console.log('📚 Xem hướng dẫn chi tiết: docs/FIX_JIRA_401_ERROR.md\n');
