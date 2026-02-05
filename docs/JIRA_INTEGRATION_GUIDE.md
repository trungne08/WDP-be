# 🔐 Hướng Dẫn Tích Hợp Jira OAuth 2.0

## ✨ Tính năng mới

✅ **Granular Scopes** - Scopes chi tiết theo chuẩn Atlassian mới nhất  
✅ **Auto-Refresh Token** - Tự động làm mới token khi hết hạn (401)  
✅ **Mobile Support** - Hỗ trợ deep link cho mobile app  
✅ **Retry Mechanism** - Tự động retry request khi token expired  
✅ **Better Error Handling** - Xử lý lỗi chi tiết và thông báo rõ ràng  

---

## 📋 Yêu Cầu

### 1. Tạo Atlassian OAuth App

1. Truy cập: https://developer.atlassian.com/console/myapps/
2. Click **Create** → **OAuth 2.0 integration**
3. Nhập tên app (VD: `WDP Backend`)
4. Click **Create**

### 2. Cấu Hình Authorization

**Callback URLs (quan trọng!):**

Trong tab **Authorization** → **OAuth 2.0 (3LO)**, thêm các callback URLs:

- **Web**: `http://localhost:5000/auth/atlassian/callback`
- **Mobile**: `syncapp://connections` *(nếu có mobile app)*

**⚠️ Lưu ý:**
- Phải khớp 100% (không có dấu `/` ở cuối)
- Localhost cho development, domain thật cho production

### 3. Cấu Hình Permissions (Scopes)

Trong tab **Permissions** → **Jira API**, tick các scopes sau:

✅ **Classic Scopes** (nếu app cũ):
- View user profiles
- View Jira issue data
- View project data
- View user data

✅ **Granular Scopes** (khuyến nghị - app mới):
- `offline_access` - **BẮT BUỘC** để lấy refresh_token
- `read:issue:jira` - Đọc issues
- `write:issue:jira` - Tạo/sửa issues
- `delete:issue:jira` - Xóa issues
- `read:project:jira` - Đọc projects
- `write:project:jira` - Tạo/sửa projects
- `read:user:jira` - Đọc thông tin users
- `read:me` - Đọc thông tin user hiện tại

Click **Save changes**!

### 4. Lấy Credentials

Trong tab **Settings**:
- Copy **Client ID**
- Copy **Secret**

---

## 🛠️ Cấu Hình Backend

### 1. Update `.env`

```env
# Atlassian OAuth Credentials
ATLASSIAN_CLIENT_ID=<YOUR_CLIENT_ID>
ATLASSIAN_CLIENT_SECRET=<YOUR_SECRET>
ATLASSIAN_CALLBACK_URL=http://localhost:5000/auth/atlassian/callback

# JWT Secret (để sign state)
JWT_SECRET=your-secret-key

# Frontend URL (callback redirect)
CLIENT_URL=http://localhost:3000
```

### 2. Restart Server

```bash
npm start
```

---

## 🚀 Test OAuth Flow

### Option 1: Test trên Swagger

1. Mở: http://localhost:5000/api-docs
2. Login để lấy access token
3. Click **Authorize**, paste token
4. Test endpoint: **GET /api/integrations/jira/connect**
5. Copy `redirectUrl` và mở trên browser
6. Accept authorization trên Jira
7. Kiểm tra terminal logs

### Option 2: Test với cURL

```bash
# 1. Get authorization URL
curl -X GET "http://localhost:5000/api/integrations/jira/connect" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# 2. Mở URL trên browser, accept

# 3. Test lấy projects
curl -X GET "http://localhost:5000/api/integrations/jira/projects" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## 🔄 Auto-Refresh Token Flow

```
┌─────────────────────────────────────────────────────────┐
│  Client Request                                         │
│  (với accessToken cũ)                                   │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  Backend gọi Jira API                                   │
└───────────────┬─────────────────────────────────────────┘
                │
                ├──────► ✅ Success (200) ────► Return data
                │
                └──────► ❌ 401 Unauthorized
                                │
                                ▼
                    ┌───────────────────────────┐
                    │  Auto Refresh Token       │
                    │  POST /oauth/token        │
                    └───────┬───────────────────┘
                            │
                            ├──► ✅ Refresh OK
                            │      │
                            │      ├─► Update DB
                            │      └─► Retry Request ──► Return data
                            │
                            └──► ❌ Refresh Failed (401/404)
                                      │
                                      └─► Throw Error
                                           "Token hết hạn, đăng nhập lại"
```

---

## 📱 Mobile Support

### Deep Link Configuration

**Mobile app phải register deep link:**

```xml
<!-- iOS: Info.plist -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>syncapp</string>
    </array>
  </dict>
</array>

<!-- Android: AndroidManifest.xml -->
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="syncapp" android:host="connections" />
</intent-filter>
```

### Connect từ Mobile

```javascript
// Frontend gọi API với header/query
fetch('http://localhost:5000/api/integrations/jira/connect?platform=mobile', {
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'x-platform': 'mobile' // Hoặc dùng header
  }
})
.then(res => res.json())
.then(data => {
  // Mở redirectUrl trong browser
  window.open(data.redirectUrl);
});

// Sau khi accept, Jira sẽ redirect về:
// syncapp://connections?success=true&accountId=xxx
```

---

## 🌐 API Endpoints Reference

### User Identity API (scope: `read:me`)

**Get Current User Profile:**
```
GET https://api.atlassian.com/me
Headers: Authorization: Bearer {accessToken}

Response:
{
  "account_id": "5b10ac8d82e05b22cc7d4ef5",
  "email": "user@example.com",
  "name": "John Doe",
  "picture": "https://avatar-cdn.atlassian.com/...",
  "account_type": "atlassian",
  "account_status": "active"
}
```

**⚠️ LƯU Ý QUAN TRỌNG:**
- Endpoint `/me` **KHÔNG cần `cloudId`**
- Trả về thông tin **account profile chung** (không phải user trong Jira)
- Field names: `account_id`, `email`, `name` (khác với Jira API)
- Yêu cầu scope: `read:me` (User Identity API scope)

### Jira REST API v3 (scope: Jira-specific)

**Get User in Jira Context:**
```
GET https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/myself
Headers: Authorization: Bearer {accessToken}

Response:
{
  "accountId": "5b10ac8d82e05b22cc7d4ef5",
  "emailAddress": "user@example.com",
  "displayName": "John Doe",
  "avatarUrls": { ... }
}
```

**Search Issues:**
```
POST https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/search
Headers: Authorization: Bearer {accessToken}
Body: {
  "jql": "project = SCRUM",
  "fields": ["summary", "status", "assignee"]
}
```

**⚠️ Phân biệt 2 API:**
| Thuộc tính | User Identity API | Jira REST API |
|------------|-------------------|---------------|
| Endpoint base | `https://api.atlassian.com/me` | `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...` |
| CloudID required? | ❌ Không | ✅ Có |
| Scope | `read:me` | `read:jira-user`, `read:issue:jira`, etc. |
| Field names | `account_id`, `email`, `name` | `accountId`, `emailAddress`, `displayName` |
| Use case | Lấy profile chung | Lấy data trong Jira context |

---

## 🐛 Troubleshooting

### Lỗi 400: "Something went wrong"

**Nguyên nhân:**
- Client ID không hợp lệ (app không tồn tại)
- Callback URL không khớp
- Scopes không hợp lệ

**Giải pháp:**
1. Kiểm tra app còn tồn tại: https://developer.atlassian.com/console/myapps/
2. Kiểm tra callback URL trong Authorization settings
3. Kiểm tra permissions đã được save chưa

### Lỗi 401: "Unauthorized" khi exchange code

**Nguyên nhân:**
- Client Secret sai
- `redirect_uri` khi exchange code không khớp với lúc tạo auth URL

**Giải pháp:**
1. Kiểm tra `.env` có đúng Client ID + Secret không
2. Check logs: `redirect_uri` phải giống nhau ở 2 bước (authorize và exchange)

### Lỗi 401: "Unauthorized" khi fetch user info (sau khi exchange thành công)

**Logs:**
```
✅ [Jira Auth] Exchange token thành công!
✅ [Jira Auth] Tìm thấy 1 Jira site(s)
👤 [Jira Auth] Fetching current user info...
❌ [Jira Auth] Lỗi lấy user info: Request failed with status code 401
```

**Nguyên nhân:**
- Thiếu scope `read:me` trong authorization URL
- Hoặc đang dùng sai endpoint (Jira API thay vì User Identity API)

**Giải pháp:**
1. Kiểm tra scope có `read:me` không:
   ```javascript
   // JiraAuthService.js
   const JIRA_SCOPES = '... read:me';
   ```

2. Kiểm tra endpoint đang dùng:
   - ✅ **ĐÚNG**: `GET https://api.atlassian.com/me`
   - ❌ **SAI**: `GET https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/myself`

3. Trong Atlassian Console → **Permissions** → **User Identity API**:
   - Tick ✅ **View user profile** (`read:me`)
   - Click **Save changes**
   
4. Sau khi sửa: **Ngắt kết nối** và **Kết nối lại** để lấy token mới với scope đầy đủ

### Lỗi 401: Token hết hạn (khi gọi API)

**Nguyên nhân:**
- Access token expire sau ~1 giờ
- Refresh token hết hạn (sau ~90 ngày không dùng)

**Giải pháp:**
- Nếu có refresh token: Backend tự động refresh
- Nếu không có refresh token hoặc refresh failed: User phải đăng nhập lại

### Không nhận được refresh_token

**Nguyên nhân:**
- Thiếu scope `offline_access`
- Param `prompt=consent` bị thiếu

**Giải pháp:**
1. Kiểm tra JiraAuthService có scope `offline_access` không
2. Check param `prompt=consent` trong authorization URL
3. Trong Atlassian Console, đảm bảo app có quyền `offline_access`

---

## 📚 API Endpoints

### Connect Jira

```
GET /api/integrations/jira/connect
Headers: Authorization: Bearer <token>
Query: ?platform=web|mobile (optional)
       ?redirect_uri=http://localhost:3000 (optional)

Response:
{
  "redirectUrl": "https://auth.atlassian.com/authorize?..."
}
```

### Get Projects

```
GET /api/integrations/jira/projects
Headers: Authorization: Bearer <token>

Response:
{
  "total": 5,
  "projects": [
    { "id": "10000", "key": "SCRUM", "name": "Scrum Project" }
  ]
}
```

### Get Boards

```
GET /api/integrations/jira/boards?projectKey=SCRUM
Headers: Authorization: Bearer <token>

Response:
{
  "projectKey": "SCRUM",
  "total": 2,
  "boards": [
    { "id": 1, "name": "Scrum Board", "type": "scrum" }
  ]
}
```

### Sync Project Data

```
POST /api/integrations/projects/:projectId/sync
Headers: Authorization: Bearer <token>

Response:
{
  "message": "✅ Đồng bộ dữ liệu hoàn tất!",
  "stats": {
    "github": 120,
    "jira": 45,
    "errors": []
  }
}
```

### Disconnect Jira

```
DELETE /api/integrations/jira/disconnect
Headers: Authorization: Bearer <token>

Response:
{
  "message": "✅ Đã ngắt kết nối Jira thành công!",
  "jira": null
}
```

---

## 🔒 Security Notes

1. **Never commit `.env`** - Luôn add vào `.gitignore`
2. **Rotate secrets định kỳ** - Regenerate Client Secret mỗi 90 ngày
3. **HTTPS in production** - Bắt buộc dùng HTTPS cho callback URL production
4. **Validate state JWT** - Backend đã tự động validate, không cần làm gì thêm
5. **Encrypt tokens in DB** - Backend đã tự động encrypt trong pre-save hook

---

## 📞 Support

Nếu gặp vấn đề:
1. Check terminal logs để xem chi tiết lỗi
2. Kiểm tra Atlassian Console settings
3. Test với Swagger để debug
4. Xem file `JiraAuthService.js` và `JiraSyncService.js` để hiểu flow

---

**Happy Coding! 🚀**
