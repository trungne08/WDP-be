# Jira OAuth 2.0 Migration - Summary

## 🎯 Tổng Quan

Backend đã **HOÀN TOÀN** migrate từ Basic Auth sang OAuth 2.0 cho Jira integration.

### Tại Sao Phải Migrate?

| Vấn Đề với Basic Auth | Giải Pháp với OAuth 2.0 |
|------------------------|--------------------------|
| ❌ Token không tự refresh → User phải update manual | ✅ Auto-refresh token khi hết hạn |
| ❌ Admin phải setup token cho cả team | ✅ Mỗi user tự connect |
| ❌ Không có granular permissions | ✅ User control từng permission (scopes) |
| ❌ Token lưu plaintext hoặc Base64 (dễ leak) | ✅ Token được encrypt trong DB |
| ❌ Một token fail → cả team bị ảnh hưởng | ✅ Mỗi user có token riêng |

---

## 📂 Files Changed

### ✅ Updated Files

| File | Changes | Status |
|------|---------|--------|
| `services/JiraSyncService.js` | + Thêm CRUD operations (Sprint, Issue, Agile API) | ✅ Complete |
| `controllers/IntegrationController.js` | + Thêm helper `getJiraOAuthConfig()` | ✅ Complete |
| `controllers/JiraController.js` | 🔄 Refactor toàn bộ → dùng OAuth thay Basic Auth | ✅ Complete |
| `controllers/SyncController.js` | 🔄 Refactor `syncTeamData()` → dùng User OAuth | ✅ Complete |
| `controllers/TeamController.js` | 🔄 Refactor `updateTeamConfig()` → xóa `api_token_jira` | ✅ Complete |
| `services/JiraService.js` | ⚠️ Added deprecation warnings | ✅ Complete |

### 📄 New Files

- `docs/JIRA_OAUTH_FRONTEND_GUIDE.md` - Hướng dẫn Frontend integration
- `docs/JIRA_OAUTH_MIGRATION_SUMMARY.md` - File này

---

## 🔄 API Changes

### IntegrationController (Không đổi - đã support OAuth từ trước)

```javascript
// Connect Jira OAuth
GET /api/integrations/jira/connect
Response: { redirectUrl: "https://auth.atlassian.com/..." }

// Callback (tự động)
GET /api/integrations/jira/callback?code=xxx&state=xxx
Response: Redirect to frontend /callback/jira?success=true

// Get Projects (với auto-refresh)
GET /api/integrations/jira/projects
Response: { total: 5, projects: [...] }

// Get Boards (với auto-refresh)
GET /api/integrations/jira/boards?projectKey=SCRUM
Response: { total: 2, boards: [...] }

// Disconnect
DELETE /api/integrations/jira/disconnect
Response: { message: "✅ Đã ngắt kết nối Jira" }
```

### JiraController (Refactored - Yêu cầu OAuth)

```javascript
// Tạo Sprint
POST /api/sprints
Body: {
  team_id: "xxx",
  name: "Sprint 1",
  start_date: "2024-03-01T00:00:00Z",
  end_date: "2024-03-14T23:59:59Z"
}
⚠️ Yêu cầu: User phải connect Jira OAuth trước

// Start Sprint
POST /api/sprints/:id/start
Body: { start_date: "...", end_date: "..." }
⚠️ Yêu cầu: User phải connect Jira OAuth

// Update Sprint
PUT /api/sprints/:id
Body: { name: "Sprint 1 Updated", state: "active", ... }
⚠️ Yêu cầu: User phải connect Jira OAuth

// Tạo Task
POST /api/tasks
Body: {
  team_id: "xxx",
  summary: "Task title",
  description: "...",
  assignee_account_id: "jira_account_id",
  story_point: 5,
  sprint_id: "..." // optional
}
⚠️ Yêu cầu: User phải connect Jira OAuth

// Update Task
PUT /api/tasks/:id
Body: { summary: "Updated", status: "In Progress", ... }
⚠️ Yêu cầu: User phải connect Jira OAuth

// Delete Task
DELETE /api/tasks/:id
⚠️ Yêu cầu: User phải connect Jira OAuth
```

### SyncController (Refactored - Yêu cầu OAuth)

```javascript
// Sync Team Data (GitHub + Jira)
POST /api/sync/:teamId
⚠️ Yêu cầu: User phải connect Jira OAuth để sync Jira data

// Response
{
  message: "✅ Đồng bộ xong!",
  stats: {
    git: 150,           // số commits synced
    jira_sprints: 5,    // số sprints synced
    jira_tasks: 42,     // số tasks synced
    errors: []          // danh sách lỗi nếu có
  }
}

// Nếu user chưa connect Jira
{
  ...
  stats: {
    git: 150,
    jira_sprints: 0,
    jira_tasks: 0,
    errors: ["User chưa kết nối Jira OAuth. Vui lòng kết nối Jira trước."]
  }
}
```

### TeamController (Refactored - Xóa Basic Auth)

```javascript
// Update Team Config
PUT /api/teams/:teamId/config
Body: {
  jira_project_key: "SCRUM",  // Chỉ cần project key
  jira_board_id: 123,          // Chỉ cần board id
  github_repo_url: "...",
  api_token_github: "..."      // Optional (khuyến nghị dùng OAuth)
}

// ❌ REMOVED FIELDS:
// - api_token_jira (không cần nữa)
// - jira_url (lấy từ user OAuth connection)

⚠️ Yêu cầu: User phải connect Jira OAuth để auto-detect Story Point field
```

---

## 🔐 Authentication Flow

### Old Flow (❌ Deprecated)

```
1. Admin tạo Jira API Token
2. Admin encode "email:token" → Base64
3. Admin paste vào Team settings
4. Backend lưu token vào team.api_token_jira
5. Mọi API call dùng Basic Auth với token này
❌ Vấn đề: Token hết hạn → manual update
```

### New Flow (✅ Current)

```
1. User click "Connect Jira"
2. Redirect → Atlassian OAuth page
3. User authorize (grant permissions)
4. Callback → Backend exchange code → Access Token + Refresh Token
5. Lưu tokens vào user.integrations.jira (encrypted)
6. Mọi API call dùng Bearer Token
7. Token hết hạn (1h) → Backend TỰ ĐỘNG refresh
✅ User không cần làm gì cả!
```

---

## 🛠️ Backend Implementation Details

### Auto-Refresh Mechanism

```javascript
// JiraSyncService.js
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      // 1. Gọi Atlassian refresh endpoint
      const { accessToken, refreshToken } = await JiraAuthService.refreshAccessToken({
        clientId,
        clientSecret,
        refreshToken: user.integrations.jira.refreshToken
      });
      
      // 2. Update tokens trong DB
      user.integrations.jira.accessToken = accessToken;
      user.integrations.jira.refreshToken = refreshToken;
      await user.save();
      
      // 3. Retry request với token mới
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return client(originalRequest);
    }
    
    return Promise.reject(error);
  }
);
```

### OAuth Scopes

```javascript
// JiraAuthService.js
const JIRA_SCOPES = [
  'offline_access',              // Để lấy refresh_token (BẮT BUỘC)
  'read:issue:jira',             // Đọc issues
  'write:issue:jira',            // Tạo/sửa issues
  'delete:issue:jira',           // Xóa issues
  'read:project:jira',           // Đọc projects
  'read:user:jira',              // Đọc users
  'read:me',                     // Đọc thông tin user hiện tại
  'read:board-scope:jira-software',   // Đọc boards (Agile)
  'read:sprint:jira-software',   // Đọc sprints (Agile)
  'write:board-scope:jira-software'   // Tạo/sửa boards
].join(' ');
```

---

## 📊 Error Handling

### Error Codes

| Code | Meaning | Frontend Action |
|------|---------|-----------------|
| `JIRA_NOT_CONNECTED` | User chưa connect OAuth | Show "Connect Jira" prompt |
| `REFRESH_TOKEN_MISSING` | Không có refresh token | Yêu cầu reconnect |
| `REFRESH_TOKEN_EXPIRED` | Refresh token hết hạn | Yêu cầu reconnect |
| `TOKEN_EXPIRED` | Access token hết hạn (backend sẽ tự refresh) | Retry request |
| `INSUFFICIENT_SCOPES` | Thiếu permissions | Yêu cầu reconnect với đủ scopes |

### Example Error Response

```json
// User chưa connect
{
  "error": "Chưa kết nối Jira. Vui lòng kết nối Jira trước.",
  "code": "JIRA_NOT_CONNECTED",
  "requiresAuth": true
}

// Token hết hạn
{
  "error": "Jira token đã hết hạn. Vui lòng ngắt kết nối và kết nối lại Jira.",
  "code": "TOKEN_EXPIRED",
  "requiresReauth": true
}
```

---

## 🧪 Testing Checklist

### Backend Testing

- [x] OAuth connect flow
- [x] OAuth callback flow
- [x] Auto-refresh token khi 401
- [x] Create Sprint với OAuth
- [x] Create Task với OAuth
- [x] Update Sprint với OAuth
- [x] Update Task với OAuth
- [x] Delete Task với OAuth
- [x] Sync Team Data với OAuth
- [x] Error handling cho các cases

### Frontend Testing (TODO)

- [ ] Connect Jira button
- [ ] Callback page handling
- [ ] Disconnect Jira button
- [ ] Show connection status
- [ ] Get Projects dropdown
- [ ] Get Boards dropdown
- [ ] Create Sprint form
- [ ] Create Task form
- [ ] Sync Team button
- [ ] Error handling UI
- [ ] Re-auth prompt

---

## 📝 Migration Steps for Teams

### For Admins

1. **Thông báo cho team members**:
   - "Từ [ngày], mọi người cần connect Jira OAuth cá nhân"
   - "Không còn dùng team token chung nữa"

2. **Update Team Config**:
   - Xóa `api_token_jira` field trong Team settings UI
   - Giữ lại `jira_project_key` và `jira_board_id`

3. **Hướng dẫn team members connect**:
   - Vào Settings → Integrations
   - Click "Connect Jira"
   - Authorize trên Atlassian

### For Developers (Frontend)

1. **Phase 1**: Implement OAuth flow
   - Tạo Connect button
   - Tạo Callback page
   - Test end-to-end

2. **Phase 2**: Update existing features
   - Update Team Config form (remove api_token_jira field)
   - Update Sprint CRUD operations
   - Update Task CRUD operations
   - Update Sync button

3. **Phase 3**: Error handling
   - Implement error handler cho `requiresAuth`
   - Implement error handler cho `requiresReauth`
   - Show user-friendly messages

4. **Phase 4**: Testing
   - Test với connected user
   - Test với non-connected user
   - Test token refresh (wait 1h hoặc manual expire)
   - Test edge cases

### For End Users

1. **One-time setup**:
   - Navigate to Settings → Integrations
   - Click "Connect Jira"
   - Authorize on Atlassian
   - Done! Token tự động refresh sau này

2. **Daily usage**:
   - Không có gì thay đổi
   - Tất cả Jira features hoạt động như cũ
   - Không cần quan tâm token management

---

## 🚨 Breaking Changes

### API Breaking Changes

```javascript
// ❌ CŨ - Team Basic Auth
PUT /api/teams/:teamId/config
{
  "api_token_jira": "dXNlckBleGFtcGxlLmNvbTp0b2tlbg==",
  "jira_url": "https://yourteam.atlassian.net"
}

// ✅ MỚI - User OAuth (không cần api_token_jira)
PUT /api/teams/:teamId/config
{
  "jira_project_key": "SCRUM",
  "jira_board_id": 123
}
```

### Database Schema Changes

```javascript
// Team model - KHÔNG CÒN CẦN
{
  api_token_jira: String,  // ❌ Deprecated
  jira_url: String,        // ❌ Deprecated
}

// User model - ĐÃ CÓ SẴN
{
  integrations: {
    jira: {
      jiraAccountId: String,
      cloudId: String,
      jiraUrl: String,
      email: String,
      displayName: String,
      accessToken: String,   // Encrypted
      refreshToken: String,  // Encrypted
      linkedAt: Date
    }
  }
}
```

---

## 📚 Documentation

### For Developers

- **Frontend Guide**: `docs/JIRA_OAUTH_FRONTEND_GUIDE.md`
- **Migration Summary**: `docs/JIRA_OAUTH_MIGRATION_SUMMARY.md` (this file)

### Source Code Reference

- **OAuth Flow**: `controllers/IntegrationController.js`
- **Auth Service**: `services/JiraAuthService.js`
- **Sync Service**: `services/JiraSyncService.js`
- **Jira Operations**: `controllers/JiraController.js`

### Deprecated Code

- **Old Service**: `services/JiraService.js` (⚠️ với deprecation warnings)

---

## 💬 FAQs

### Q: Tại sao phải migrate?

**A**: Basic Auth có nhiều vấn đề:
- Token không tự refresh
- Bảo mật thấp
- Admin phải manual manage token cho cả team
- Không có granular permissions

### Q: User cần làm gì?

**A**: Chỉ cần connect Jira OAuth 1 lần:
1. Settings → Integrations
2. Click "Connect Jira"
3. Authorize
4. Done!

### Q: Token hết hạn thì sao?

**A**: Backend TỰ ĐỘNG refresh. User không cần làm gì.

### Q: Nếu refresh token cũng hết hạn?

**A**: Rất hiếm xảy ra (chỉ khi lâu không dùng). Frontend sẽ show prompt để user reconnect.

### Q: Team có cần config gì không?

**A**: Team chỉ cần:
- `jira_project_key` (VD: "SCRUM")
- `jira_board_id` (VD: 123)

Không cần `api_token_jira` và `jira_url` nữa.

### Q: Có ảnh hưởng gì đến data cũ không?

**A**: Không. Tất cả Sprint và Task data vẫn giữ nguyên.

### Q: Phải update database schema không?

**A**: Không. `user.integrations.jira` đã có sẵn từ trước. Chỉ cần xóa UI field `api_token_jira` trong Team Config form.

---

## ✅ Completion Status

| Task | Status | Notes |
|------|--------|-------|
| Backend OAuth Flow | ✅ Done | IntegrationController |
| Backend Refactor - JiraController | ✅ Done | All functions migrated |
| Backend Refactor - SyncController | ✅ Done | syncTeamData() migrated |
| Backend Refactor - TeamController | ✅ Done | updateTeamConfig() migrated |
| Backend Services | ✅ Done | JiraSyncService extended |
| Backend Deprecation | ✅ Done | JiraService marked deprecated |
| Documentation - Frontend | ✅ Done | JIRA_OAUTH_FRONTEND_GUIDE.md |
| Documentation - Summary | ✅ Done | This file |
| Frontend Implementation | ⏳ Pending | Need frontend dev |
| End-to-End Testing | ⏳ Pending | After frontend done |
| Production Deployment | ⏳ Pending | After testing |

---

## 🎉 Next Steps

### For Backend Team

1. ✅ Code review
2. ✅ Merge to main branch
3. ⏳ Deploy to staging
4. ⏳ Monitor logs for errors
5. ⏳ Deploy to production

### For Frontend Team

1. ⏳ Read `docs/JIRA_OAUTH_FRONTEND_GUIDE.md`
2. ⏳ Implement OAuth flow
3. ⏳ Update Team Config form
4. ⏳ Update all Jira API calls
5. ⏳ Testing
6. ⏳ Deploy

### For Product Team

1. ⏳ Thông báo cho users về migration
2. ⏳ Tạo user guide/video tutorial
3. ⏳ Monitor user feedback
4. ⏳ Support users trong quá trình migrate

---

**Migration Date**: 2024-02-25  
**Version**: 2.0.0  
**Status**: Backend Complete ✅ | Frontend Pending ⏳
