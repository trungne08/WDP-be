/**
 * Script debug Jira Connect flow
 * Chạy: node scripts/debug-jira-connect.js
 */

require('dotenv').config();
const JiraAuthService = require('../services/JiraAuthService');

console.log('\n🔍 DEBUG JIRA CONNECTION FLOW\n');
console.log('='.repeat(70));

// 1. Check Environment
console.log('\n📋 Step 1: Environment Variables');
console.log('-'.repeat(70));

const clientId = process.env.ATLASSIAN_CLIENT_ID;
const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
const callbackUrl = process.env.ATLASSIAN_CALLBACK_URL;
const clientUrl = process.env.CLIENT_URL;

console.log(`ATLASSIAN_CLIENT_ID:      ${clientId || '❌ THIẾU'}`);
console.log(`ATLASSIAN_CLIENT_SECRET:  ${clientSecret ? '✅ (***hidden***)' : '❌ THIẾU'}`);
console.log(`ATLASSIAN_CALLBACK_URL:   ${callbackUrl || '⚠️  Sẽ dùng default'}`);
console.log(`CLIENT_URL (frontend):    ${clientUrl || '⚠️  Sẽ dùng default'}`);

if (!clientId || !clientSecret) {
  console.log('\n❌ THIẾU CLIENT_ID hoặc CLIENT_SECRET!');
  console.log('   Vui lòng thêm vào file .env');
  process.exit(1);
}

// 2. Check Callback URLs
console.log('\n📍 Step 2: Callback URLs');
console.log('-'.repeat(70));

const webCallbackUrl = callbackUrl || 'http://localhost:5000/auth/atlassian/callback';
const mobileCallbackUrl = 'syncapp://connections';

console.log('Web callback URL:    ', webCallbackUrl);
console.log('Mobile callback URL: ', mobileCallbackUrl);

console.log('\n⚠️  QUAN TRỌNG: Callback URL trên Atlassian Console PHẢI CHÍNH XÁC:');
console.log(`   ${webCallbackUrl}`);
console.log('\nCác routes backend hỗ trợ (tất cả đều OK):');
console.log('   - /api/integrations/jira/callback');
console.log('   - /auth/jira/callback');
console.log('   - /auth/atlassian/callback');

// 3. Check Scopes
console.log('\n📦 Step 3: Required Scopes');
console.log('-'.repeat(70));

const scopes = JiraAuthService.JIRA_SCOPES;
console.log('Code yêu cầu scopes:', scopes);
console.log('\nScopes chi tiết:');

const scopeList = scopes.split(' ');
scopeList.forEach((scope, idx) => {
  const desc = {
    'offline_access': 'Lấy refresh token (BẮT BUỘC)',
    'read:issue:jira': 'Đọc issues',
    'write:issue:jira': 'Tạo/sửa issues',
    'delete:issue:jira': 'Xóa issues',
    'read:project:jira': 'Đọc projects',
    'write:project:jira': 'Tạo/sửa projects',
    'read:user:jira': 'Đọc user info',
    'read:me': 'Đọc profile'
  }[scope] || '';
  
  console.log(`   ${idx + 1}. ${scope.padEnd(25)} → ${desc}`);
});

// 4. Simulate Auth URL
console.log('\n🔗 Step 4: Authorization URL (mẫu)');
console.log('-'.repeat(70));

try {
  // Tạo mock request object
  const mockReq = {
    protocol: 'http',
    get: (header) => {
      if (header === 'host') return 'localhost:5000';
      return null;
    }
  };

  const authUrl = JiraAuthService.buildAuthorizationUrl({
    clientId,
    platform: 'web',
    userId: 'test-user-id',
    role: 'STUDENT',
    frontendRedirectUri: clientUrl || 'http://localhost:3000',
    req: mockReq
  });

  console.log('Authorization URL được tạo:');
  console.log(authUrl);
  
  // Parse URL
  const url = new URL(authUrl);
  console.log('\nCác parameters:');
  console.log('   - audience:', url.searchParams.get('audience'));
  console.log('   - client_id:', url.searchParams.get('client_id'));
  console.log('   - redirect_uri:', url.searchParams.get('redirect_uri'));
  console.log('   - response_type:', url.searchParams.get('response_type'));
  console.log('   - scope:', url.searchParams.get('scope'));
  console.log('   - prompt:', url.searchParams.get('prompt'));
  console.log('   - state: (JWT token - chứa user info)');

} catch (error) {
  console.log('❌ Lỗi tạo Authorization URL:', error.message);
}

// 5. Common Issues
console.log('\n🐛 Step 5: Common Issues & Solutions');
console.log('='.repeat(70));

console.log('\n❌ LỖI 1: "redirect_uri_mismatch"');
console.log('   Nguyên nhân: Callback URL không khớp giữa code và Atlassian Console');
console.log('   Giải pháp:');
console.log('   1. Vào https://developer.atlassian.com/console/myapps/');
console.log(`   2. Chọn app với Client ID: ${clientId}`);
console.log('   3. Vào tab "Settings" → "Authorization"');
console.log(`   4. Thêm callback URL: ${webCallbackUrl}`);
console.log('   5. Save và thử lại');

console.log('\n❌ LỖI 2: "invalid_client" hoặc 401');
console.log('   Nguyên nhân: Client ID hoặc Secret sai');
console.log('   Giải pháp:');
console.log('   1. Vào https://developer.atlassian.com/console/myapps/');
console.log('   2. Check Client ID và Secret có khớp với .env không');
console.log('   3. Nếu không, copy lại từ console vào .env');
console.log('   4. Restart server');

console.log('\n❌ LỖI 3: "access_denied" khi user authorize');
console.log('   Nguyên nhân: Scopes chưa được cấu hình trên console');
console.log('   Giải pháp:');
console.log('   1. Vào https://developer.atlassian.com/console/myapps/');
console.log('   2. Vào tab "Permissions"');
console.log('   3. Add TẤT CẢ 8 scopes ở trên');
console.log('   4. Save và thử lại');

console.log('\n❌ LỖI 4: "invalid_grant" khi exchange code');
console.log('   Nguyên nhân: Code đã được dùng hoặc hết hạn (10 phút)');
console.log('   Giải pháp:');
console.log('   1. Code OAuth chỉ dùng được 1 lần');
console.log('   2. Phải authorize lại để lấy code mới');
console.log('   3. Exchange code ngay lập tức (trong 10 phút)');

// 6. Testing Steps
console.log('\n🧪 Step 6: Testing Instructions');
console.log('='.repeat(70));

console.log('\n1️⃣  Kiểm tra Atlassian Developer Console:');
console.log('   Link: https://developer.atlassian.com/console/myapps/');
console.log(`   App Client ID: ${clientId}`);
console.log('');
console.log('   ✅ Tab "Settings" → "Authorization":');
console.log(`      - Callback URL có: ${webCallbackUrl} ?`);
console.log('');
console.log('   ✅ Tab "Permissions":');
console.log('      - Có đủ 8 scopes (xem list ở trên) ?');
console.log('');
console.log('   ✅ Tab "Settings" → "Client credentials":');
console.log(`      - Client ID: ${clientId}`);
console.log('      - Client secret: (check khớp với .env)');

console.log('\n2️⃣  Test Connect Flow:');
console.log('   a. Start server: npm start hoặc node server.js');
console.log('   b. Call API (với Bearer token):');
console.log('      GET http://localhost:5000/api/integrations/jira/connect');
console.log('   c. Response sẽ trả về: { "redirectUrl": "..." }');
console.log('   d. Mở redirectUrl trong browser');
console.log('   e. Đăng nhập Atlassian và cho phép permissions');
console.log('   f. Atlassian sẽ redirect về callback URL');
console.log('   g. Backend exchange code → token và lưu vào DB');
console.log('   h. Redirect về frontend với success=true');

console.log('\n3️⃣  Check Server Logs:');
console.log('   Tìm các log sau khi test:');
console.log('   - 🔐 [Jira Connect] Authorization URL created');
console.log('   - 🔐 [Jira Callback] Đang exchange code → token...');
console.log('   - ✅ [Jira Auth] Exchange token thành công!');
console.log('   - ✅ [Jira Connect] Đã lưu integration cho user...');
console.log('');
console.log('   Nếu có lỗi, log sẽ báo chi tiết nguyên nhân');

console.log('\n4️⃣  Verify Connection:');
console.log('   Sau khi connect thành công, test token:');
console.log('   node scripts/check-jira-scopes.js');

console.log('\n' + '='.repeat(70));
console.log('📚 Xem docs chi tiết: docs/FIX_JIRA_401_ERROR.md');
console.log('💬 Nếu vẫn lỗi, copy lại CHÍNH XÁC error message để debug\n');
