# 🐛 Debug Guide: 401 Unauthorized After Reconnect

## 🚨 Issue Description

**Symptom**: User reconnect Jira thành công, nhưng gọi API `/integrations/jira/projects` vẫn bị 401.

**Error Response**:
```json
{
  "error": "Unauthorized",
  "status": 401
}
```

---

## 🔍 Root Causes & Solutions

### ✅ Cause 1: Base URL Sai (FIXED)

**Vấn đề**: Dùng domain thường thay vì API endpoint chuẩn OAuth

```javascript
// ❌ SAI - Không hoạt động với OAuth token
https://{domain}.atlassian.net/rest/api/3/project

// ✅ ĐÚNG - Bắt buộc cho OAuth 2.0 (3LO)
https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/project
```

**Status**: ✅ **ĐÃ FIX** - JiraSyncService đã dùng đúng format

```23:23:d:\WDP - BE\WDP-be\services\JiraSyncService.js
    baseURL: `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`,
```

---

### ⚠️ Cause 2: Double Encryption (FIXED)

**Vấn đề**: Token bị mã hóa 2 lần

**Scenario**:
```
1. User reconnect → Atlassian trả về plaintext token
2. Save to DB → Pre-save hook encrypt → Encrypted token (OK)
3. Read từ DB → Post-find hook decrypt → Plaintext token (OK)
4. Auto-refresh trong JiraSyncService → Get new token (plaintext)
5. Save lại → Pre-save hook encrypt → Encrypted
6. Read lại → Decrypt → Plaintext (OK)
7. Save lại (vì lý do gì đó) → Encrypt LẠI → DOUBLE ENCRYPTED! ❌
```

**Fix**: Thêm check trong `encrypt()` function

```javascript
// utils/encryption.js - UPDATED
function encrypt(text) {
  if (!text) return null;
  
  // ✅ Check nếu đã encrypted rồi → skip
  if (isEncrypted(text)) {
    console.log('🔍 Text đã được mã hóa rồi, skip encryption');
    return text;
  }
  
  // Proceed with encryption...
}
```

**Status**: ✅ **ĐÃ FIX** - Thêm `isEncrypted()` check

---

### ⚠️ Cause 3: CloudId Bị Null/Undefined

**Vấn đề**: CloudId không được lưu đúng sau reconnect

**Debug**:
```javascript
// IntegrationController.getJiraProjects - line 454-458
console.log('   - Has cloudId?', jira?.cloudId);
console.log('   - CloudId:', jira.cloudId);
console.log('   - CloudId type:', typeof jira.cloudId);
```

**Possible Issues**:
- CloudId bị null/undefined trong DB
- CloudId bị overwrite khi save
- CloudId không được fetch đúng từ Atlassian

**Check trong callback**:
```javascript
// IntegrationController.jiraCallback - line 282-296
const resources = await JiraAuthService.fetchAccessibleResources(accessToken);
const selectedResource = resources[0];
const cloudId = selectedResource.id;  // ← Đảm bảo có giá trị

console.log('CloudId from Atlassian:', cloudId);

// Save to DB
user.integrations.jira = {
  cloudId,  // ← Đảm bảo được lưu
  jiraUrl,
  accessToken,
  refreshToken,
  // ...
};
```

**Status**: ✅ **ĐÃ CÓ LOGS** - Thêm validation trong IntegrationController

---

### ⚠️ Cause 4: AccessToken Format Sai

**Vấn đề**: Token không đúng format Bearer token

**Debug**:
```javascript
// Check token format
console.log('Token prefix:', accessToken.substring(0, 20));
console.log('Token length:', accessToken.length);
console.log('Auth header:', `Bearer ${accessToken}`.substring(0, 30));
```

**Expected**: 
- Token length: ~400-600 characters
- Format: Alphanumeric + dashes/underscores
- NO spaces, NO "Bearer" prefix (sẽ add khi gọi API)

**Status**: ✅ **ĐÃ CÓ LOGS** - JiraSyncService log chi tiết

---

### ⚠️ Cause 5: Token Bị Revoked

**Vấn đề**: User reconnect nhưng revoke token ngay sau đó (trên Atlassian Console)

**Check**: 
1. User vào https://id.atlassian.com/manage-profile/security/connected-apps
2. Check xem app có bị revoked không

**Solution**: User reconnect lại (không revoke)

---

## 🔧 Enhanced Debug Logs

### JiraSyncService.js

**Added**:
- ✅ Log cloudId, accessToken details khi tạo client
- ✅ Validate cloudId và accessToken format
- ✅ Request interceptor: Log mọi request đi ra
- ✅ Response interceptor: Log response và errors chi tiết

**Example Output**:
```
🔧 [Jira API Client] Creating client...
   - CloudId: abc123-def456-ghi789
   - CloudId type: string
   - CloudId length: 36
   - AccessToken present? true
   - AccessToken type: string
   - AccessToken length: 542
   - AccessToken prefix: eyJhbGciOiJSUzI1NiI...
   - Base URL: https://api.atlassian.com/ex/jira/abc123-def456-ghi789/rest/api/3

📤 [Jira API] Outgoing Request:
   - Method: GET
   - URL: /project/search
   - Full URL: https://api.atlassian.com/ex/jira/abc123-def456-ghi789/rest/api/3/project/search
   - Auth header: Bearer eyJhbGciOiJSUzI1NiI...

📥 [Jira API] Response received:
   - Status: 200
   - URL: /project/search
```

### IntegrationController.js

**Added**:
- ✅ Log user email, ID
- ✅ Log full Jira integration details (cloudId, URLs, etc.)
- ✅ Validate cloudId và accessToken format
- ✅ Log expected API URL
- ✅ Log OAuth config (clientId, clientSecret)

---

## 🧪 Testing Steps

### Step 1: Check User Integrations in DB

```javascript
// MongoDB shell hoặc Compass
db.students.findOne(
  { email: "user@example.com" },
  { "integrations.jira": 1 }
)

// Expected output:
{
  integrations: {
    jira: {
      jiraAccountId: "xxx",
      cloudId: "abc-def-ghi",        // ← Phải có giá trị
      jiraUrl: "https://...",
      accessToken: "xxx:xxx:xxx",    // ← Encrypted format
      refreshToken: "xxx:xxx:xxx",   // ← Encrypted format
      linkedAt: ISODate("2024-02-25...")
    }
  }
}
```

**Red Flags**:
- ❌ `cloudId: null` hoặc `cloudId: undefined`
- ❌ `accessToken: null`
- ❌ `accessToken` không có dấu `:` (không phải encrypted)
- ❌ `accessToken` quá ngắn (< 100 chars sau encrypt)

### Step 2: Test với Postman/cURL

```bash
# Get user info
GET http://localhost:5000/api/users/me
Authorization: Bearer YOUR_JWT_TOKEN

# Check response - integrations.jira field
# Copy cloudId và check format

# Test Jira API trực tiếp
curl -X GET \
  "https://api.atlassian.com/ex/jira/YOUR_CLOUD_ID/rest/api/3/project/search" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Accept: application/json"

# Nếu trả về 200 → Token OK, vấn đề ở backend logic
# Nếu trả về 401 → Token invalid, cần reconnect
```

### Step 3: Check Backend Logs

```bash
# Run backend với logs
npm start

# Gọi API
GET /api/integrations/jira/projects

# Check console output:
🔍 [Get Jira Projects] Request from user: user@example.com
   - User ID: 507f1f77bcf86cd799439011
   - Has Jira integration? true
   - Has accessToken? true
   - Has refreshToken? true
   - Has cloudId? true
   📊 Jira Integration Details:
      - CloudId: abc-123-def
      - CloudId type: string
      - CloudId length: 36
      - AccessToken type: string
      - AccessToken length: 542
      - Expected API URL: https://api.atlassian.com/ex/jira/abc-123-def/rest/api/3/project/search

🔧 [Jira API Client] Creating client...
   (Same details as above)

📤 [Jira API] Outgoing Request:
   - Full URL: https://api.atlassian.com/ex/jira/abc-123-def/rest/api/3/project/search
   - Auth header: Bearer eyJhbGciOiJSUzI1NiI...

# Nếu 401:
❌ [Jira API] Response Error:
   - Status: 401
   - Response data: { "message": "Unauthorized; scope does not match" }
```

**Red Flags**:
- ❌ CloudId: `undefined` hoặc `null`
- ❌ AccessToken length quá ngắn (< 400 chars)
- ❌ Auth header không có "Bearer" prefix
- ❌ Response: "scope does not match" → Token thiếu scopes

---

## 🔧 Debugging Checklist

### Backend Debug

- [x] ✅ Base URL đúng format (with cloudId)
- [x] ✅ Authorization header: `Bearer ${token}`
- [x] ✅ Thêm logs chi tiết (cloudId, token, URL)
- [x] ✅ Validate cloudId và accessToken
- [x] ✅ Fix double encryption issue
- [ ] ⏳ Test với real user data

### Database Debug

- [ ] Check `user.integrations.jira.cloudId` có giá trị
- [ ] Check `user.integrations.jira.accessToken` có giá trị
- [ ] Check token format (encrypted: `xxx:xxx:xxx`)
- [ ] Check token length (sau encrypt: ~600-800 chars)

### Network Debug

- [ ] Test API với Postman/cURL
- [ ] Verify token trực tiếp với Atlassian API
- [ ] Check request headers (Authorization, Accept, Content-Type)
- [ ] Check response body (error details)

---

## 💡 Quick Fixes

### Fix 1: Reconnect Jira (30s)

```
1. Settings → Integrations
2. Jira → [Ngắt kết nối]
3. [Kết nối Jira]
4. Authorize
5. Done!
```

### Fix 2: Clear Corrupted Integration (Dev Only)

```javascript
// MongoDB shell
db.students.updateOne(
  { email: "user@example.com" },
  { $unset: { "integrations.jira": "" } }
)

// Sau đó user reconnect
```

### Fix 3: Check Encryption Key

```bash
# .env file
ENCRYPTION_KEY=your_64_character_hex_key_here

# Verify length
echo -n "$ENCRYPTION_KEY" | wc -c
# Should output: 64
```

---

## 📊 Common Scenarios & Solutions

### Scenario 1: "Unauthorized; scope does not match"

**Cause**: Token thiếu scopes

**Solution**: Reconnect Jira để grant scopes mới

**Status**: Backend đã handle đúng (INSUFFICIENT_SCOPES error code)

---

### Scenario 2: "Invalid cloudId"

**Cause**: CloudId bị null/corrupted trong DB

**Solution**: 
```javascript
// Force user reconnect
DELETE /api/integrations/jira/disconnect
GET /api/integrations/jira/connect
```

---

### Scenario 3: "Invalid accessToken"

**Cause**: Token bị double-encrypted hoặc corrupted

**Solution**: 
- ✅ Code fix: Thêm `isEncrypted()` check
- 🔧 Manual fix: User reconnect

---

### Scenario 4: Token hết hạn (Expected - Should Auto-Refresh)

**Expected Flow**:
```
1. API call → 401
2. JiraSyncService intercept → Refresh token
3. Save new token → Retry request
4. Return success
```

**If Still 401**:
- Check: RefreshToken có trong DB không
- Check: RefreshToken có hợp lệ không
- Solution: Reconnect nếu refresh token hết hạn (90 days)

---

## 🎯 Action Items

### For Backend Team (Done)

- [x] Fix base URL format
- [x] Add detailed logs
- [x] Fix double encryption
- [x] Add validation cho cloudId và accessToken
- [x] Document debug guide

### For Frontend Team

- [ ] Implement error UI cho các error codes
- [ ] Add reconnect modal cho INSUFFICIENT_SCOPES
- [ ] Test reconnect flow thoroughly
- [ ] Monitor 401 errors in production

### For DevOps/Support

- [ ] Monitor error logs
- [ ] Track 401 error rate
- [ ] Identify users với corrupted integrations
- [ ] Assist users with reconnect

---

## 📞 Next Steps If Still 401

### Step 1: Check Logs

```bash
# Backend console output
🔍 [Get Jira Projects] Request from user: xxx
📊 Jira Integration Details:
   - CloudId: ???
   - AccessToken length: ???
   
🔧 [Jira API Client] Creating client...
   - Base URL: ???
   
📤 [Jira API] Outgoing Request:
   - Full URL: ???
   - Auth header: ???
   
❌ [Jira API] Response Error:
   - Status: 401
   - Response data: ???
```

**What to check**:
- CloudId có giá trị? (36 chars UUID format)
- AccessToken length hợp lý? (500-600 chars)
- URL đúng format? (`https://api.atlassian.com/ex/jira/{cloudId}/...`)
- Auth header có "Bearer" prefix?

### Step 2: Test Token Manually

```bash
# Copy cloudId và accessToken từ logs

# Test trực tiếp
curl -X GET \
  "https://api.atlassian.com/ex/jira/{CLOUD_ID}/rest/api/3/project/search" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Accept: application/json"

# Nếu 200 OK → Backend logic có vấn đề
# Nếu 401 → Token invalid → User cần reconnect
```

### Step 3: Check Database

```javascript
// MongoDB
db.students.findOne(
  { email: "user@example.com" },
  { 
    "integrations.jira.cloudId": 1,
    "integrations.jira.accessToken": 1,
    "integrations.jira.jiraAccountId": 1
  }
)

// Check:
// - cloudId có giá trị?
// - accessToken có giá trị?
// - accessToken format: "xxx:xxx:xxx" (encrypted)?
```

### Step 4: Force Clean Reconnect

```javascript
// Option A: Via API
DELETE /api/integrations/jira/disconnect
GET /api/integrations/jira/connect

// Option B: Direct DB (Dev only)
db.students.updateOne(
  { email: "user@example.com" },
  { $unset: { "integrations.jira": "" } }
)
```

---

## 📝 Logs To Collect

### When Reporting Issue

Please provide:

1. **User Info**:
   - Email
   - Role (Student/Lecturer/Admin)
   - When reconnect was done

2. **Console Logs**:
   - Full output from `🔍 [Get Jira Projects]`
   - Full output from `🔧 [Jira API Client]`
   - Full output from `📤 [Jira API] Outgoing Request`
   - Full output from `❌ [Jira API] Response Error`

3. **Database Data** (sanitized):
   ```javascript
   {
     cloudId: "...",
     accessToken: "first 50 chars...",
     jiraAccountId: "...",
     linkedAt: "..."
   }
   ```

4. **Error Response**:
   ```json
   {
     "error": "...",
     "code": "...",
     "details": "..."
   }
   ```

---

## ✅ Expected Behavior

### Successful Request

```
🔍 [Get Jira Projects] Request from user: user@example.com
   - Has Jira integration? true
   - Has accessToken? true
   - Has cloudId? true
   📊 Jira Integration Details:
      - CloudId: abc-123-def (36 chars) ✅
      - AccessToken length: 542 chars ✅
      - Expected API URL: https://api.atlassian.com/ex/jira/abc-123-def/... ✅

🔧 [Jira API Client] Creating client...
   - CloudId: abc-123-def ✅
   - AccessToken present? true ✅
   - Base URL: https://api.atlassian.com/ex/jira/abc-123-def/rest/api/3 ✅

📤 [Jira API] Outgoing Request:
   - Method: GET
   - Full URL: https://api.atlassian.com/ex/jira/abc-123-def/rest/api/3/project/search ✅
   - Auth header: Bearer eyJhbGciOiJSUzI1NiI... ✅

📥 [Jira API] Response received:
   - Status: 200 ✅
   - URL: /project/search

✅ [Get Jira Projects] Success: 5 projects
```

---

## 🎯 Summary

### Root Cause Analysis

| Issue | Status | Solution |
|-------|--------|----------|
| ❌ Base URL sai | ✅ Fixed | Dùng `api.atlassian.com/ex/jira/{cloudId}` |
| ❌ Double encryption | ✅ Fixed | Thêm `isEncrypted()` check |
| ⚠️ CloudId null/invalid | ✅ Logged | User reconnect |
| ⚠️ Token format sai | ✅ Logged | User reconnect |
| ⚠️ Token thiếu scopes | ✅ Handled | User reconnect (INSUFFICIENT_SCOPES) |

### If Still 401 After All Fixes

**Most Likely Causes**:
1. User chưa reconnect properly (chưa authorize đủ scopes)
2. Atlassian OAuth app config sai (missing scopes/permissions)
3. Token bị revoked manually trên Atlassian Console
4. Database có corrupted data (cần clean + reconnect)

**Solution**: User disconnect + reconnect lại, check logs chi tiết

---

**Last Updated**: 2024-02-25  
**Status**: ✅ Enhanced Logging | ✅ Fixed Encryption | ⏳ Testing Needed
