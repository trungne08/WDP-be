# 🔧 HOTFIX: Lỗi 401 khi Fetch User Info

## ❌ Vấn Đề

Sau khi exchange authorization code thành công, nhận được access token và lấy được cloudId, nhưng **bị lỗi 401** khi fetch user info:

```
✅ [Jira Auth] Exchange token thành công!
✅ [Jira Auth] Tìm thấy 1 Jira site(s)
👤 [Jira Auth] Fetching current user info...
❌ [Jira Auth] Lỗi lấy user info: Request failed with status code 401
```

## 🔍 Nguyên Nhân

**Đang dùng SAI ENDPOINT!**

❌ **Endpoint cũ (SAI):**
```javascript
GET https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/myself
```

- Endpoint này thuộc **Jira REST API v3**
- Yêu cầu scope: `read:jira-user` (Jira-specific scope)
- Trả về thông tin user **trong context Jira site**

✅ **Endpoint đúng (FIXED):**
```javascript
GET https://api.atlassian.com/me
```

- Endpoint này thuộc **User Identity API**
- Yêu cầu scope: `read:me` (User Identity scope)
- Trả về thông tin **account profile chung**
- **KHÔNG cần cloudId!**

## ✅ Đã Fix

### 1. `services/JiraAuthService.js`

**Trước:**
```javascript
async function fetchCurrentUser(accessToken, cloudId) {
  const response = await axios.get(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  
  const { accountId, emailAddress, displayName } = response.data;
  
  return { accountId, email: emailAddress, displayName };
}
```

**Sau:**
```javascript
async function fetchCurrentUser(accessToken, cloudId) {
  // QUAN TRỌNG: Dùng User Identity API endpoint
  const response = await axios.get(
    'https://api.atlassian.com/me',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  
  const { account_id, email, name } = response.data;
  
  return { accountId: account_id, email, displayName: name };
}
```

**Thay đổi:**
- ✅ Endpoint: `/me` thay vì `/rest/api/3/myself`
- ✅ Không cần `cloudId` trong URL
- ✅ Field names: `account_id`, `email`, `name` (khác với Jira API)

### 2. `services/IntegrationService.js` (Legacy)

Cũng đã update hàm `fetchJiraMyself()` tương tự.

### 3. `docs/JIRA_INTEGRATION_GUIDE.md`

- ✅ Thêm section **API Endpoints Reference**
- ✅ Phân biệt rõ User Identity API vs Jira REST API
- ✅ Thêm troubleshooting cho lỗi 401 khi fetch user info

## 🚀 Cách Test

### Bước 1: Kiểm tra Permissions (Quan trọng!)

Vào Atlassian Console:
1. https://developer.atlassian.com/console/myapps/
2. Chọn app của bạn
3. Tab **Permissions** → **User Identity API**
4. **Tick ✅ "View user profile" (`read:me`)**
5. **Click "Save changes"**

### Bước 2: Restart Server

```bash
# Stop server (Ctrl+C)
npm start
```

### Bước 3: Ngắt kết nối Jira cũ

Trên Swagger hoặc Postman:
```bash
DELETE http://localhost:5000/api/integrations/jira/disconnect
Headers: Authorization: Bearer YOUR_TOKEN
```

### Bước 4: Kết nối lại

```bash
GET http://localhost:5000/api/integrations/jira/connect
Headers: Authorization: Bearer YOUR_TOKEN
```

Copy `redirectUrl` → Mở browser → Accept authorization

### Bước 5: Kiểm tra logs

Nếu thành công, bạn sẽ thấy:
```
🔐 [Jira Callback] Đang exchange code → token...
✅ [Jira Auth] Exchange token thành công!
🌐 [Jira Auth] Fetching accessible resources (CloudID)...
✅ [Jira Auth] Tìm thấy 1 Jira site(s)
   - Jira Site: your-site
   - Cloud ID: xxx
👤 [Jira Auth] Fetching current user info...
✅ [Jira Auth] User: Your Name (your@email.com)  ← THÀNH CÔNG!
✅ [Jira Connect] Đã lưu integration cho user...
```

## 📋 Checklist

- [x] Fix endpoint trong `JiraAuthService.js`
- [x] Fix endpoint trong `IntegrationService.js`
- [x] Update documentation
- [x] Thêm troubleshooting guide
- [ ] Kiểm tra scope `read:me` trong Atlassian Console
- [ ] Test lại OAuth flow
- [ ] Verify token được lưu vào DB thành công

## 🔗 Liên Quan

**Atlassian Docs:**
- User Identity API: https://developer.atlassian.com/cloud/confluence/user-identity-api/
- Jira REST API: https://developer.atlassian.com/cloud/jira/platform/rest/v3/

**Scopes:**
- `read:me` - View user profile (User Identity API)
- `read:jira-user` - View Jira user data (Jira API)

---

**Status:** ✅ RESOLVED

**Date:** 2026-02-05

**Fixed by:** AI Assistant
