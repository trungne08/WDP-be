# Hướng Dẫn Frontend - Jira OAuth Integration

## 📋 Tổng Quan

Backend đã **HOÀN TOÀN** chuyển sang OAuth 2.0 cho Jira integration. Team Basic Auth **ĐÃ BỊ DEPRECATED**.

### Thay Đổi Quan Trọng

| Trước (❌ Old)                      | Sau (✅ New)                          |
| ----------------------------------- | ------------------------------------- |
| Team có `api_token_jira`            | User connect Jira OAuth               |
| Basic Auth (email:token Base64)     | OAuth 2.0 với auto-refresh            |
| Manual token management             | Tự động refresh khi hết hạn          |
| Admin setup token cho team          | Mỗi user tự connect                   |

---

## 🔐 Luồng Authentication

### 1. User Connect Jira

#### Step 1: Gọi API Connect

```javascript
// Frontend: Button "Connect Jira"
const connectJira = async () => {
  try {
    const response = await fetch('/api/integrations/jira/connect', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}` // User JWT token
      }
    });

    const data = await response.json();
    
    if (data.redirectUrl) {
      // Redirect user đến Atlassian OAuth page
      window.location.href = data.redirectUrl;
    }
  } catch (error) {
    console.error('Connect Jira error:', error);
  }
};
```

#### Step 2: Handle Callback

Sau khi user authorize trên Atlassian, họ sẽ được redirect về:

```
https://yourapp.com/callback/jira?success=true&accountId=xxx
```

Frontend cần handle callback này:

```javascript
// File: /pages/callback/jira.jsx (hoặc tương tự)
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function JiraCallback() {
  const router = useRouter();
  const { success, accountId } = router.query;

  useEffect(() => {
    if (success === 'true') {
      // Show success message
      toast.success(`Kết nối Jira thành công! Account: ${accountId}`);
      
      // Redirect về trang settings
      setTimeout(() => {
        router.push('/settings/integrations');
      }, 2000);
    } else {
      // Show error
      toast.error('Kết nối Jira thất bại. Vui lòng thử lại.');
      router.push('/settings/integrations');
    }
  }, [success, accountId]);

  return (
    <div>
      <h1>Đang xử lý...</h1>
      <p>Vui lòng đợi trong giây lát</p>
    </div>
  );
}
```

#### Step 3: Check Connection Status

```javascript
// Kiểm tra user đã connect Jira chưa
const checkJiraConnection = async () => {
  try {
    const response = await fetch('/api/users/me', {
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });

    const user = await response.json();
    
    if (user.integrations?.jira?.jiraAccountId) {
      console.log('User đã connect Jira:', user.integrations.jira);
      return true;
    } else {
      console.log('User chưa connect Jira');
      return false;
    }
  } catch (error) {
    console.error('Check connection error:', error);
    return false;
  }
};
```

---

## 🚀 Sử Dụng Jira APIs

### 2. Lấy Danh Sách Projects

```javascript
const getJiraProjects = async () => {
  try {
    const response = await fetch('/api/integrations/jira/projects', {
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });

    if (response.status === 400) {
      // User chưa connect Jira
      const error = await response.json();
      if (error.requiresAuth) {
        alert('Vui lòng kết nối Jira trước!');
        // Redirect to connect
        connectJira();
      }
      return [];
    }

    if (response.status === 401) {
      // Token hết hạn
      const error = await response.json();
      if (error.requiresReauth) {
        alert('Jira token đã hết hạn. Vui lòng kết nối lại!');
        // Trigger re-connect
        connectJira();
      }
      return [];
    }

    const data = await response.json();
    return data.projects;
  } catch (error) {
    console.error('Get projects error:', error);
    return [];
  }
};
```

### 3. Lấy Danh Sách Boards

```javascript
const getJiraBoards = async (projectKey) => {
  try {
    const response = await fetch(
      `/api/integrations/jira/boards?projectKey=${projectKey}`,
      {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      }
    );

    // Handle errors tương tự như getJiraProjects
    if (!response.ok) {
      const error = await response.json();
      if (error.requiresAuth || error.requiresReauth) {
        connectJira();
      }
      throw new Error(error.error);
    }

    const data = await response.json();
    return data.boards;
  } catch (error) {
    console.error('Get boards error:', error);
    return [];
  }
};
```

### 4. Tạo Sprint

```javascript
const createSprint = async (teamId, sprintData) => {
  try {
    const response = await fetch('/api/sprints', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        team_id: teamId,
        name: sprintData.name,
        start_date: sprintData.startDate, // ISO format
        end_date: sprintData.endDate
      })
    });

    if (!response.ok) {
      const error = await response.json();
      if (error.requiresAuth || error.requiresReauth) {
        alert('Vui lòng kết nối Jira!');
        connectJira();
        return null;
      }
      throw new Error(error.error);
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Create sprint error:', error);
    throw error;
  }
};
```

### 5. Tạo Task

```javascript
const createTask = async (taskData) => {
  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        team_id: taskData.teamId,
        summary: taskData.summary,
        description: taskData.description,
        assignee_account_id: taskData.assigneeId, // Jira Account ID
        story_point: taskData.storyPoint,
        due_date: taskData.dueDate, // YYYY-MM-DD
        sprint_id: taskData.sprintId // Optional, null = Backlog
      })
    });

    if (!response.ok) {
      const error = await response.json();
      if (error.requiresAuth || error.requiresReauth) {
        alert('Vui lòng kết nối Jira!');
        connectJira();
        return null;
      }
      throw new Error(error.error);
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Create task error:', error);
    throw error;
  }
};
```

### 6. Sync Team Data

```javascript
const syncTeamData = async (teamId) => {
  try {
    const response = await fetch(`/api/sync/${teamId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      
      // Check if user chưa connect Jira
      if (error.errors?.includes('User chưa kết nối Jira')) {
        alert('Vui lòng kết nối Jira trước khi sync!');
        connectJira();
        return null;
      }
      
      throw new Error(error.error);
    }

    const result = await response.json();
    console.log('Sync results:', result.stats);
    return result;
  } catch (error) {
    console.error('Sync error:', error);
    throw error;
  }
};
```

---

## 🎨 UI Component Examples

### Connect Button Component

```jsx
import { useState, useEffect } from 'react';

export default function JiraConnectButton() {
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jiraInfo, setJiraInfo] = useState(null);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const response = await fetch('/api/users/me', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      const user = await response.json();
      
      if (user.integrations?.jira) {
        setIsConnected(true);
        setJiraInfo(user.integrations.jira);
      }
    } catch (error) {
      console.error('Check connection error:', error);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/integrations/jira/connect', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      const data = await response.json();
      
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    } catch (error) {
      console.error('Connect error:', error);
      alert('Lỗi kết nối. Vui lòng thử lại.');
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Bạn có chắc muốn ngắt kết nối Jira?')) return;

    try {
      const response = await fetch('/api/integrations/jira/disconnect', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        setIsConnected(false);
        setJiraInfo(null);
        alert('Đã ngắt kết nối Jira!');
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      alert('Lỗi ngắt kết nối.');
    }
  };

  if (isConnected) {
    return (
      <div className="jira-connection-status">
        <div className="status-badge success">
          ✅ Đã kết nối Jira
        </div>
        <div className="connection-info">
          <p><strong>Account:</strong> {jiraInfo?.displayName}</p>
          <p><strong>Email:</strong> {jiraInfo?.email}</p>
          <p><strong>Jira Site:</strong> {jiraInfo?.jiraUrl}</p>
        </div>
        <button onClick={handleDisconnect} className="btn-danger">
          Ngắt kết nối
        </button>
      </div>
    );
  }

  return (
    <div className="jira-connection-status">
      <div className="status-badge warning">
        ⚠️ Chưa kết nối Jira
      </div>
      <p>Kết nối Jira để sync sprints và tasks</p>
      <button 
        onClick={handleConnect} 
        disabled={loading}
        className="btn-primary"
      >
        {loading ? 'Đang kết nối...' : 'Kết nối Jira'}
      </button>
    </div>
  );
}
```

### Team Config Form (Updated)

```jsx
import { useState, useEffect } from 'react';

export default function TeamConfigForm({ teamId }) {
  const [formData, setFormData] = useState({
    jira_project_key: '',
    jira_board_id: '',
    github_repo_url: '',
    api_token_github: ''
  });

  const [projects, setProjects] = useState([]);
  const [boards, setBoards] = useState([]);
  const [isJiraConnected, setIsJiraConnected] = useState(false);

  useEffect(() => {
    checkJiraConnection();
  }, []);

  const checkJiraConnection = async () => {
    try {
      const response = await fetch('/api/integrations/jira/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects);
        setIsJiraConnected(true);
      } else {
        setIsJiraConnected(false);
      }
    } catch (error) {
      setIsJiraConnected(false);
    }
  };

  const loadBoards = async (projectKey) => {
    try {
      const response = await fetch(
        `/api/integrations/jira/boards?projectKey=${projectKey}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setBoards(data.boards);
      }
    } catch (error) {
      console.error('Load boards error:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Check Jira connection trước khi save
    if (!isJiraConnected && (formData.jira_project_key || formData.jira_board_id)) {
      alert('Vui lòng kết nối Jira trước!');
      return;
    }

    try {
      const response = await fetch(`/api/teams/${teamId}/config`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const error = await response.json();
        
        if (error.requiresAuth) {
          alert('Vui lòng kết nối Jira trước!');
          // Redirect to connect
          window.location.href = '/settings/integrations';
          return;
        }
        
        throw new Error(error.error);
      }

      const result = await response.json();
      alert(result.message);
    } catch (error) {
      console.error('Update config error:', error);
      alert(`Lỗi: ${error.message}`);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h3>Team Configuration</h3>

      {/* Jira Section */}
      <fieldset>
        <legend>Jira Configuration</legend>
        
        {!isJiraConnected && (
          <div className="alert alert-warning">
            ⚠️ Bạn chưa kết nối Jira. 
            <a href="/settings/integrations">Kết nối ngay</a>
          </div>
        )}

        <div className="form-group">
          <label>Jira Project</label>
          <select
            value={formData.jira_project_key}
            onChange={(e) => {
              setFormData({ ...formData, jira_project_key: e.target.value });
              loadBoards(e.target.value);
            }}
            disabled={!isJiraConnected}
          >
            <option value="">-- Chọn Project --</option>
            {projects.map(p => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.key})
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Jira Board</label>
          <select
            value={formData.jira_board_id}
            onChange={(e) => setFormData({ ...formData, jira_board_id: e.target.value })}
            disabled={!formData.jira_project_key || boards.length === 0}
          >
            <option value="">-- Chọn Board --</option>
            {boards.map(b => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.type})
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      {/* GitHub Section */}
      <fieldset>
        <legend>GitHub Configuration</legend>
        
        <div className="form-group">
          <label>Repository URL</label>
          <input
            type="text"
            value={formData.github_repo_url}
            onChange={(e) => setFormData({ ...formData, github_repo_url: e.target.value })}
            placeholder="https://github.com/username/repo"
          />
        </div>

        <div className="form-group">
          <label>GitHub Token (Optional - dùng OAuth khuyến nghị)</label>
          <input
            type="password"
            value={formData.api_token_github}
            onChange={(e) => setFormData({ ...formData, api_token_github: e.target.value })}
            placeholder="ghp_xxxxxxxxxxxx"
          />
        </div>
      </fieldset>

      <button type="submit" className="btn-primary">
        Lưu cấu hình
      </button>
    </form>
  );
}
```

---

## 🔄 Error Handling Strategy

### Centralized Error Handler

```javascript
// utils/apiErrorHandler.js
export const handleJiraApiError = async (response, onReauth) => {
  if (!response.ok) {
    const error = await response.json();
    
    // Case 1: User chưa connect Jira
    if (error.requiresAuth || error.code === 'JIRA_NOT_CONNECTED') {
      console.warn('User chưa connect Jira');
      
      // Show modal/toast
      if (window.confirm('Bạn chưa kết nối Jira. Kết nối ngay?')) {
        // Redirect to connect
        window.location.href = '/settings/integrations';
      }
      
      throw new Error('JIRA_NOT_CONNECTED');
    }
    
    // Case 2: Token hết hạn
    if (error.requiresReauth || error.code === 'TOKEN_EXPIRED') {
      console.warn('Jira token hết hạn');
      
      // Show modal/toast
      if (window.confirm('Jira token đã hết hạn. Kết nối lại?')) {
        // Trigger re-authentication
        if (onReauth) {
          await onReauth();
        } else {
          window.location.href = '/settings/integrations';
        }
      }
      
      throw new Error('TOKEN_EXPIRED');
    }
    
    // Case 3: Other errors
    throw new Error(error.error || 'Unknown error');
  }
  
  return response;
};

// Usage:
const getJiraProjects = async () => {
  try {
    const response = await fetch('/api/integrations/jira/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    await handleJiraApiError(response);
    
    return await response.json();
  } catch (error) {
    if (error.message === 'JIRA_NOT_CONNECTED') {
      // Handle not connected
      return [];
    }
    if (error.message === 'TOKEN_EXPIRED') {
      // Handle expired
      return [];
    }
    throw error;
  }
};
```

---

## 📝 Checklist Migration Frontend

### Phase 1: Setup OAuth Flow

- [ ] Tạo page `/settings/integrations` với button "Connect Jira"
- [ ] Tạo callback page `/callback/jira`
- [ ] Implement `connectJira()` function
- [ ] Implement `disconnectJira()` function
- [ ] Test OAuth flow end-to-end

### Phase 2: Update API Calls

- [ ] Update `getJiraProjects()` với error handling
- [ ] Update `getJiraBoards()` với error handling
- [ ] Update `createSprint()` với auth check
- [ ] Update `createTask()` với auth check
- [ ] Update `syncTeamData()` với auth check

### Phase 3: Update UI Components

- [ ] Thêm JiraConnectButton component vào settings page
- [ ] Update Team Config Form (xóa api_token_jira field)
- [ ] Thêm connection status indicator
- [ ] Thêm re-auth prompt modal

### Phase 4: Error Handling

- [ ] Implement centralized error handler
- [ ] Handle `requiresAuth` errors
- [ ] Handle `requiresReauth` errors
- [ ] Show user-friendly error messages

### Phase 5: Testing

- [ ] Test connect flow
- [ ] Test disconnect flow
- [ ] Test API calls với connected user
- [ ] Test API calls với non-connected user
- [ ] Test token refresh (đợi 1h hoặc force expire)
- [ ] Test concurrent requests

---

## 🚨 Breaking Changes

### API Changes

#### ❌ REMOVED: Team Basic Auth Fields

```javascript
// ❌ CŨ - Không còn hoạt động
PUT /api/teams/:teamId/config
{
  "api_token_jira": "base64_encoded_token",  // ❌ REMOVED
  "jira_url": "https://yourteam.atlassian.net"  // ❌ REMOVED
}

// ✅ MỚI - Dùng User OAuth
PUT /api/teams/:teamId/config
{
  // Không cần api_token_jira và jira_url nữa
  "jira_project_key": "SCRUM",
  "jira_board_id": 123
}
```

#### ✅ REQUIRED: User OAuth Connection

Tất cả Jira APIs yêu cầu user phải connect OAuth trước:

```javascript
// ❌ Sẽ fail với 400 Bad Request
POST /api/sprints
// Response: { error: "Chưa kết nối Jira", requiresAuth: true }

// ✅ Sau khi user connect OAuth thành công
POST /api/sprints
// Response: { message: "✅ Tạo Sprint thành công", data: {...} }
```

---

## 💡 Best Practices

### 1. Always Check Connection Before Actions

```javascript
const performJiraAction = async (action) => {
  // Check connection first
  const isConnected = await checkJiraConnection();
  
  if (!isConnected) {
    // Prompt user to connect
    if (confirm('Vui lòng kết nối Jira trước')) {
      await connectJira();
    }
    return null;
  }
  
  // Proceed with action
  return await action();
};
```

### 2. Implement Retry Logic

```javascript
const fetchWithRetry = async (url, options, maxRetries = 1) => {
  try {
    const response = await fetch(url, options);
    
    // Nếu 401 và có requiresReauth, backend đã tự refresh
    // Retry 1 lần nữa
    if (response.status === 401) {
      const error = await response.json();
      
      if (error.requiresReauth && maxRetries > 0) {
        console.log('Token expired, backend will refresh. Retrying...');
        
        // Wait a bit for backend to refresh
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Retry
        return fetchWithRetry(url, options, maxRetries - 1);
      }
    }
    
    return response;
  } catch (error) {
    throw error;
  }
};
```

### 3. Show Connection Status Prominently

```jsx
// Dashboard header
<div className="header">
  <h1>Dashboard</h1>
  <div className="integrations-status">
    {isJiraConnected ? (
      <span className="badge badge-success">
        ✅ Jira Connected
      </span>
    ) : (
      <span className="badge badge-warning">
        ⚠️ Jira Not Connected
        <button onClick={() => router.push('/settings/integrations')}>
          Connect Now
        </button>
      </span>
    )}
  </div>
</div>
```

---

## 🆘 Troubleshooting

### Issue 1: "Chưa kết nối Jira" Error

**Cause**: User chưa connect OAuth

**Solution**:
1. Navigate to `/settings/integrations`
2. Click "Connect Jira"
3. Authorize trên Atlassian
4. Đợi redirect về `/callback/jira`

### Issue 2: "Token đã hết hạn" Error

**Cause**: Access token expired (sau 1h) và refresh token cũng hết hạn

**Solution**:
1. Click "Disconnect" để xóa connection cũ
2. Click "Connect Jira" lại
3. Re-authorize

### Issue 3: API Returns 401 Repeatedly

**Cause**: 
- Backend không lưu được refreshed token
- RefreshToken bị revoked

**Solution**:
1. Check backend logs
2. Disconnect và reconnect Jira
3. Clear cookies/localStorage nếu cần

### Issue 4: Callback Page Không Nhận Query Params

**Cause**: Routing config không match

**Solution**:

```javascript
// Next.js: pages/callback/jira.jsx
export default function JiraCallback() {
  const router = useRouter();
  
  useEffect(() => {
    // Wait for router to be ready
    if (!router.isReady) return;
    
    const { success, accountId } = router.query;
    // ... handle callback
  }, [router.isReady, router.query]);
}
```

---

## 📚 Additional Resources

### Backend APIs Documentation

- **OAuth Flow**: See `controllers/IntegrationController.js`
- **Jira Operations**: See `controllers/JiraController.js`
- **Sync Operations**: See `controllers/SyncController.js`

### Services Documentation

- **JiraAuthService**: OAuth 2.0 authentication helpers
- **JiraSyncService**: All Jira API operations with auto-refresh
- **JiraService**: ❌ DEPRECATED - Don't use

### Example Code

See `docs/JIRA_OAUTH_BACKEND_GUIDE.md` for backend implementation details.

---

## ✅ Summary

### Key Points

1. **User OAuth Required**: Mọi user phải connect Jira OAuth trước khi dùng Jira features
2. **No Team Token**: Không còn `api_token_jira` trong Team model
3. **Auto Refresh**: Backend tự động refresh token khi hết hạn
4. **Error Handling**: Frontend phải handle `requiresAuth` và `requiresReauth` errors
5. **Connection Status**: Luôn show connection status cho user

### Migration Timeline

| Phase | Task | Status |
|-------|------|--------|
| ✅ Backend | Refactor to OAuth | Completed |
| 🔄 Frontend | Implement OAuth flow | In Progress |
| ⏳ Testing | End-to-end testing | Pending |
| ⏳ Deployment | Production rollout | Pending |

### Support

Nếu có vấn đề, liên hệ:
- Backend team: Check logs trong `services/JiraAuthService.js`
- Frontend team: Check browser console và network tab
- Documentation: See this file + backend source code

---

**Last Updated**: 2024-02-25  
**Version**: 2.0.0 (OAuth Migration)
