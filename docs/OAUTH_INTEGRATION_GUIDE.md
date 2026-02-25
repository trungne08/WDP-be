# 🔐 OAuth Integration Guide - GitHub & Jira

**Hướng dẫn tích hợp OAuth 2.0 cho GitHub và Jira**

> ⚠️ **QUAN TRỌNG**: Backend đã chuyển sang **HOÀN TOÀN OAuth 2.0** cho cả GitHub và Jira. Team tokens (Basic Auth) **ĐÃ BỊ DEPRECATED**.

---

## 📋 Tổng Quan

### Thay Đổi Quan Trọng

| Aspect | Trước (❌ Old) | Sau (✅ New) |
|--------|----------------|--------------|
| **GitHub Auth** | Team token (`api_token_github`) | User OAuth |
| **Jira Auth** | Team token (`api_token_jira`) + Basic Auth | User OAuth 2.0 |
| **Token Management** | Admin setup manual | User tự connect |
| **Token Refresh** | Manual update khi expire | Auto-refresh (invisible) |
| **Security** | Token lưu trong Team (shared) | Token encrypted trong User (isolated) |
| **Permissions** | Full access | Granular scopes |

### Lợi Ích OAuth

✅ **Bảo mật**: Token được encrypt, không share giữa users  
✅ **User Control**: Mỗi user tự quản lý connections  
✅ **Auto Refresh**: Token tự động refresh khi hết hạn  
✅ **Granular Permissions**: User chọn permissions cụ thể  
✅ **Better UX**: Không cần copy-paste tokens  
✅ **Compliance**: Đúng best practices OAuth 2.0  

---

## 🔑 Authentication Flows

### GitHub OAuth Flow

```
┌─────────────────────────────────────────────────────┐
│  1. User clicks "Connect GitHub"                    │
│     Frontend → GET /api/integrations/github/connect │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  2. Backend returns GitHub OAuth URL                │
│     { redirectUrl: "https://github.com/login/..." }│
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  3. User authorizes on GitHub                       │
│     (Grants repo & user permissions)                │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  4. GitHub redirects to callback                    │
│     /api/integrations/github/callback?code=xxx      │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  5. Backend exchanges code → access token           │
│     Saves to user.integrations.github               │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  6. Redirect to frontend callback page              │
│     /callback/github?success=true&username=xxx      │
└─────────────────────────────────────────────────────┘
```

### Jira OAuth Flow

```
┌─────────────────────────────────────────────────────┐
│  1. User clicks "Connect Jira"                      │
│     Frontend → GET /api/integrations/jira/connect   │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  2. Backend returns Atlassian OAuth URL             │
│     { redirectUrl: "https://auth.atlassian.com/..." }│
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  3. User authorizes on Atlassian                    │
│     (Grants Jira permissions with scopes)           │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  4. Atlassian redirects to callback                 │
│     /api/integrations/jira/callback?code=xxx        │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  5. Backend exchanges code → tokens                 │
│     - Access token (expires in 1h)                  │
│     - Refresh token (long-lived)                    │
│     Saves to user.integrations.jira                 │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  6. Redirect to frontend callback page              │
│     /callback/jira?success=true&accountId=xxx       │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 Frontend Implementation

### 1. Create Integration Settings Page

```jsx
// pages/settings/integrations.jsx
import { useState, useEffect } from 'react';
import GitHubConnectButton from '@/components/GitHubConnectButton';
import JiraConnectButton from '@/components/JiraConnectButton';

export default function IntegrationsPage() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    const response = await fetch('/api/users/me', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    const data = await response.json();
    setUser(data);
  };

  return (
    <div className="integrations-page">
      <h1>Integrations</h1>
      
      <section className="integration-section">
        <h2>🐙 GitHub</h2>
        <p>Connect GitHub to sync commits and repositories</p>
        <GitHubConnectButton user={user} onUpdate={loadUserData} />
      </section>

      <section className="integration-section">
        <h2>📊 Jira</h2>
        <p>Connect Jira to sync sprints and tasks</p>
        <JiraConnectButton user={user} onUpdate={loadUserData} />
      </section>
    </div>
  );
}
```

### 2. GitHub Connect Button Component

```jsx
// components/GitHubConnectButton.jsx
import { useState } from 'react';

export default function GitHubConnectButton({ user, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const github = user?.integrations?.github;
  const isConnected = !!github?.githubId;

  const handleConnect = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/integrations/github/connect', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      const data = await response.json();
      
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    } catch (error) {
      console.error('Connect GitHub error:', error);
      alert('Lỗi kết nối GitHub. Vui lòng thử lại.');
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Bạn có chắc muốn ngắt kết nối GitHub?')) return;

    try {
      const response = await fetch('/api/integrations/github/disconnect', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        alert('Đã ngắt kết nối GitHub!');
        onUpdate?.();
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      alert('Lỗi ngắt kết nối.');
    }
  };

  if (isConnected) {
    return (
      <div className="connection-card connected">
        <div className="status-badge success">
          ✅ Đã kết nối
        </div>
        <div className="connection-info">
          <p><strong>Username:</strong> {github.username}</p>
          <p><strong>GitHub ID:</strong> {github.githubId}</p>
          <p><strong>Linked:</strong> {new Date(github.linkedAt).toLocaleDateString()}</p>
        </div>
        <button onClick={handleDisconnect} className="btn-danger">
          Ngắt kết nối
        </button>
      </div>
    );
  }

  return (
    <div className="connection-card disconnected">
      <div className="status-badge warning">
        ⚠️ Chưa kết nối
      </div>
      <p>Kết nối GitHub để sync commits và repositories</p>
      <button 
        onClick={handleConnect} 
        disabled={loading}
        className="btn-primary"
      >
        {loading ? 'Đang kết nối...' : 'Kết nối GitHub'}
      </button>
    </div>
  );
}
```

### 3. Jira Connect Button Component

```jsx
// components/JiraConnectButton.jsx
import { useState } from 'react';

export default function JiraConnectButton({ user, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const jira = user?.integrations?.jira;
  const isConnected = !!jira?.jiraAccountId;

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
      console.error('Connect Jira error:', error);
      alert('Lỗi kết nối Jira. Vui lòng thử lại.');
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
        alert('Đã ngắt kết nối Jira!');
        onUpdate?.();
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      alert('Lỗi ngắt kết nối.');
    }
  };

  if (isConnected) {
    return (
      <div className="connection-card connected">
        <div className="status-badge success">
          ✅ Đã kết nối
        </div>
        <div className="connection-info">
          <p><strong>Display Name:</strong> {jira.displayName}</p>
          <p><strong>Email:</strong> {jira.email}</p>
          <p><strong>Jira Site:</strong> {jira.jiraUrl}</p>
          <p><strong>Account ID:</strong> {jira.jiraAccountId}</p>
          <p><strong>Linked:</strong> {new Date(jira.linkedAt).toLocaleDateString()}</p>
        </div>
        <button onClick={handleDisconnect} className="btn-danger">
          Ngắt kết nối
        </button>
      </div>
    );
  }

  return (
    <div className="connection-card disconnected">
      <div className="status-badge warning">
        ⚠️ Chưa kết nối
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

### 4. Callback Pages

#### GitHub Callback

```jsx
// pages/callback/github.jsx
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function GitHubCallback() {
  const router = useRouter();
  const { success, username } = router.query;

  useEffect(() => {
    if (!router.isReady) return;
    
    if (success === 'true') {
      alert(`✅ Kết nối GitHub thành công! Username: ${username}`);
      setTimeout(() => {
        router.push('/settings/integrations');
      }, 1500);
    } else {
      alert('❌ Kết nối GitHub thất bại. Vui lòng thử lại.');
      router.push('/settings/integrations');
    }
  }, [router.isReady, router.query]);

  return (
    <div className="callback-page">
      <h1>Đang xử lý kết nối GitHub...</h1>
      <p>Vui lòng đợi trong giây lát</p>
    </div>
  );
}
```

#### Jira Callback

```jsx
// pages/callback/jira.jsx
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function JiraCallback() {
  const router = useRouter();
  const { success, accountId } = router.query;

  useEffect(() => {
    if (!router.isReady) return;
    
    if (success === 'true') {
      alert(`✅ Kết nối Jira thành công! Account ID: ${accountId}`);
      setTimeout(() => {
        router.push('/settings/integrations');
      }, 1500);
    } else {
      alert('❌ Kết nối Jira thất bại. Vui lòng thử lại.');
      router.push('/settings/integrations');
    }
  }, [router.isReady, router.query]);

  return (
    <div className="callback-page">
      <h1>Đang xử lý kết nối Jira...</h1>
      <p>Vui lòng đợi trong giây lát</p>
    </div>
  );
}
```

### 5. Team Config Form (Updated)

```jsx
// components/TeamConfigForm.jsx
import { useState, useEffect } from 'react';

export default function TeamConfigForm({ teamId, user }) {
  const [formData, setFormData] = useState({
    jira_project_key: '',
    jira_board_id: '',
    github_repo_url: ''
  });

  const [jiraProjects, setJiraProjects] = useState([]);
  const [jiraBoards, setJiraBoards] = useState([]);
  const [githubRepos, setGithubRepos] = useState([]);

  const isGitHubConnected = !!user?.integrations?.github?.accessToken;
  const isJiraConnected = !!user?.integrations?.jira?.accessToken;

  useEffect(() => {
    if (isJiraConnected) {
      loadJiraProjects();
    }
    if (isGitHubConnected) {
      loadGitHubRepos();
    }
  }, [isGitHubConnected, isJiraConnected]);

  const loadJiraProjects = async () => {
    try {
      const response = await fetch('/api/integrations/jira/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setJiraProjects(data.projects);
      }
    } catch (error) {
      console.error('Load Jira projects error:', error);
    }
  };

  const loadJiraBoards = async (projectKey) => {
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
        setJiraBoards(data.boards);
      }
    } catch (error) {
      console.error('Load Jira boards error:', error);
    }
  };

  const loadGitHubRepos = async () => {
    try {
      const response = await fetch('/api/integrations/github/repos', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setGithubRepos(data.repos);
      }
    } catch (error) {
      console.error('Load GitHub repos error:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate connections
    if (formData.github_repo_url && !isGitHubConnected) {
      alert('❌ Vui lòng kết nối GitHub trước!');
      return;
    }

    if ((formData.jira_project_key || formData.jira_board_id) && !isJiraConnected) {
      alert('❌ Vui lòng kết nối Jira trước!');
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
          alert('❌ Vui lòng kết nối GitHub/Jira trước!');
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
    <form onSubmit={handleSubmit} className="team-config-form">
      <h3>Team Configuration</h3>

      {/* Connection Status */}
      <div className="connection-status">
        <div className={`status-item ${isGitHubConnected ? 'connected' : 'disconnected'}`}>
          {isGitHubConnected ? '✅' : '⚠️'} GitHub: {isGitHubConnected ? 'Connected' : 'Not Connected'}
        </div>
        <div className={`status-item ${isJiraConnected ? 'connected' : 'disconnected'}`}>
          {isJiraConnected ? '✅' : '⚠️'} Jira: {isJiraConnected ? 'Connected' : 'Not Connected'}
        </div>
        {(!isGitHubConnected || !isJiraConnected) && (
          <a href="/settings/integrations" className="connect-link">
            → Đi đến Integrations
          </a>
        )}
      </div>

      {/* GitHub Section */}
      <fieldset>
        <legend>🐙 GitHub Configuration</legend>
        
        {!isGitHubConnected && (
          <div className="alert alert-warning">
            ⚠️ Bạn chưa kết nối GitHub. 
            <a href="/settings/integrations">Kết nối ngay</a>
          </div>
        )}

        <div className="form-group">
          <label>Repository URL *</label>
          <input
            type="text"
            value={formData.github_repo_url}
            onChange={(e) => setFormData({ ...formData, github_repo_url: e.target.value })}
            placeholder="https://github.com/username/repo"
            disabled={!isGitHubConnected}
            required
          />
          <small>Hoặc chọn từ danh sách:</small>
          <select
            value=""
            onChange={(e) => setFormData({ ...formData, github_repo_url: e.target.value })}
            disabled={!isGitHubConnected || githubRepos.length === 0}
          >
            <option value="">-- Chọn Repository --</option>
            {githubRepos.map(repo => (
              <option key={repo.id} value={repo.clone_url}>
                {repo.full_name} ({repo.private ? 'Private' : 'Public'})
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      {/* Jira Section */}
      <fieldset>
        <legend>📊 Jira Configuration</legend>
        
        {!isJiraConnected && (
          <div className="alert alert-warning">
            ⚠️ Bạn chưa kết nối Jira. 
            <a href="/settings/integrations">Kết nối ngay</a>
          </div>
        )}

        <div className="form-group">
          <label>Jira Project *</label>
          <select
            value={formData.jira_project_key}
            onChange={(e) => {
              setFormData({ ...formData, jira_project_key: e.target.value });
              loadJiraBoards(e.target.value);
            }}
            disabled={!isJiraConnected}
            required
          >
            <option value="">-- Chọn Project --</option>
            {jiraProjects.map(p => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.key})
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Jira Board *</label>
          <select
            value={formData.jira_board_id}
            onChange={(e) => setFormData({ ...formData, jira_board_id: e.target.value })}
            disabled={!formData.jira_project_key || jiraBoards.length === 0}
            required
          >
            <option value="">-- Chọn Board --</option>
            {jiraBoards.map(b => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.type})
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <button type="submit" className="btn-primary">
        💾 Lưu cấu hình
      </button>
    </form>
  );
}
```

---

## 🔄 Using APIs After Connection

### Sync Team Data

```javascript
const syncTeamData = async (teamId) => {
  try {
    const response = await fetch(`/api/sync/${teamId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      
      // Check errors
      if (error.errors) {
        const hasGitHubError = error.errors.some(e => e.includes('GitHub'));
        const hasJiraError = error.errors.some(e => e.includes('Jira'));
        
        if (hasGitHubError || hasJiraError) {
          const missing = [];
          if (hasGitHubError) missing.push('GitHub');
          if (hasJiraError) missing.push('Jira');
          
          alert(`⚠️ Vui lòng kết nối ${missing.join(' và ')} trước khi sync!`);
          window.location.href = '/settings/integrations';
          return null;
        }
      }
      
      throw new Error(error.error);
    }

    const result = await response.json();
    console.log('✅ Sync results:', result.stats);
    return result;
  } catch (error) {
    console.error('Sync error:', error);
    throw error;
  }
};
```

### Get GitHub Repositories

```javascript
const getGitHubRepos = async () => {
  try {
    const response = await fetch('/api/integrations/github/repos', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (response.status === 400) {
      alert('⚠️ Vui lòng kết nối GitHub trước!');
      window.location.href = '/settings/integrations';
      return [];
    }

    if (response.status === 401) {
      alert('⚠️ GitHub token đã hết hạn. Vui lòng kết nối lại!');
      window.location.href = '/settings/integrations';
      return [];
    }

    const data = await response.json();
    return data.repos;
  } catch (error) {
    console.error('Get repos error:', error);
    return [];
  }
};
```

### Get Jira Projects

```javascript
const getJiraProjects = async () => {
  try {
    const response = await fetch('/api/integrations/jira/projects', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (response.status === 400) {
      const error = await response.json();
      if (error.requiresAuth) {
        alert('⚠️ Vui lòng kết nối Jira trước!');
        window.location.href = '/settings/integrations';
      }
      return [];
    }

    if (response.status === 401) {
      const error = await response.json();
      if (error.requiresReauth) {
        alert('⚠️ Jira token đã hết hạn. Vui lòng kết nối lại!');
        window.location.href = '/settings/integrations';
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

---

## 🎨 CSS Styles

```css
/* integrations.css */

.integrations-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.integration-section {
  margin-bottom: 3rem;
  padding: 2rem;
  background: #f8f9fa;
  border-radius: 12px;
}

.integration-section h2 {
  margin-bottom: 0.5rem;
  font-size: 1.8rem;
}

.connection-card {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  margin-top: 1rem;
}

.connection-card.connected {
  border-left: 4px solid #28a745;
}

.connection-card.disconnected {
  border-left: 4px solid #ffc107;
}

.status-badge {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  font-weight: 600;
  margin-bottom: 1rem;
}

.status-badge.success {
  background: #d4edda;
  color: #155724;
}

.status-badge.warning {
  background: #fff3cd;
  color: #856404;
}

.connection-info {
  margin: 1rem 0;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 4px;
}

.connection-info p {
  margin: 0.5rem 0;
}

.btn-primary {
  background: #007bff;
  color: white;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  transition: background 0.3s;
}

.btn-primary:hover:not(:disabled) {
  background: #0056b3;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-danger {
  background: #dc3545;
  color: white;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  transition: background 0.3s;
}

.btn-danger:hover {
  background: #c82333;
}

.callback-page {
  text-align: center;
  padding: 4rem 2rem;
}

.callback-page h1 {
  font-size: 2rem;
  margin-bottom: 1rem;
}

/* Team Config Form */

.team-config-form {
  max-width: 800px;
  margin: 2rem auto;
  padding: 2rem;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
}

.connection-status {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
  margin-bottom: 2rem;
  flex-wrap: wrap;
  align-items: center;
}

.status-item {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-weight: 600;
}

.status-item.connected {
  background: #d4edda;
  color: #155724;
}

.status-item.disconnected {
  background: #fff3cd;
  color: #856404;
}

.connect-link {
  margin-left: auto;
  padding: 0.5rem 1rem;
  background: #007bff;
  color: white;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
}

.connect-link:hover {
  background: #0056b3;
}

fieldset {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 2rem;
}

legend {
  font-size: 1.3rem;
  font-weight: 600;
  padding: 0 0.5rem;
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
  color: #333;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
  font-size: 1rem;
}

.form-group input:disabled,
.form-group select:disabled {
  background: #e9ecef;
  cursor: not-allowed;
}

.form-group small {
  display: block;
  margin-top: 0.5rem;
  margin-bottom: 0.25rem;
  color: #6c757d;
}

.alert {
  padding: 1rem;
  border-radius: 6px;
  margin-bottom: 1rem;
}

.alert-warning {
  background: #fff3cd;
  border: 1px solid #ffeaa7;
  color: #856404;
}

.alert a {
  color: #004085;
  font-weight: 600;
  text-decoration: underline;
  margin-left: 0.5rem;
}
```

---

## 🚨 Error Handling

### Centralized Error Handler

```javascript
// utils/integrationErrorHandler.js

export const handleIntegrationError = async (response, integration) => {
  if (!response.ok) {
    const error = await response.json();
    
    // Case 1: Not connected
    if (error.requiresAuth || error.code?.includes('NOT_CONNECTED')) {
      const msg = integration === 'github' 
        ? 'Bạn chưa kết nối GitHub. Kết nối ngay?'
        : 'Bạn chưa kết nối Jira. Kết nối ngay?';
      
      if (window.confirm(msg)) {
        window.location.href = '/settings/integrations';
      }
      
      throw new Error(`${integration.toUpperCase()}_NOT_CONNECTED`);
    }
    
    // Case 2: Token expired
    if (error.requiresReauth || error.code?.includes('TOKEN_EXPIRED')) {
      const msg = integration === 'github'
        ? 'GitHub token đã hết hạn. Kết nối lại?'
        : 'Jira token đã hết hạn. Kết nối lại?';
      
      if (window.confirm(msg)) {
        window.location.href = '/settings/integrations';
      }
      
      throw new Error('TOKEN_EXPIRED');
    }
    
    // Case 3: Other errors
    throw new Error(error.error || 'Unknown error');
  }
  
  return response;
};

// Usage:
import { handleIntegrationError } from '@/utils/integrationErrorHandler';

const getGitHubRepos = async () => {
  try {
    const response = await fetch('/api/integrations/github/repos', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    await handleIntegrationError(response, 'github');
    
    return await response.json();
  } catch (error) {
    if (error.message === 'GITHUB_NOT_CONNECTED') {
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

## 📝 API Reference

### GitHub APIs

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/integrations/github/connect` | GET | Get OAuth URL | User JWT |
| `/api/integrations/github/callback` | GET | OAuth callback | No (handled by backend) |
| `/api/integrations/github/repos` | GET | Get user repositories | User JWT + GitHub OAuth |
| `/api/integrations/github/disconnect` | DELETE | Disconnect GitHub | User JWT |

### Jira APIs

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/integrations/jira/connect` | GET | Get OAuth URL | User JWT |
| `/api/integrations/jira/callback` | GET | OAuth callback | No (handled by backend) |
| `/api/integrations/jira/projects` | GET | Get Jira projects | User JWT + Jira OAuth |
| `/api/integrations/jira/boards` | GET | Get project boards | User JWT + Jira OAuth |
| `/api/integrations/jira/disconnect` | DELETE | Disconnect Jira | User JWT |

### Team APIs

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/teams/:teamId/config` | PUT | Update team config | User JWT + Integrations |
| `/api/sync/:teamId` | POST | Sync team data | User JWT + Integrations |

---

## ✅ Checklist Migration Frontend

### Phase 1: Setup Pages & Components
- [ ] Tạo `/settings/integrations` page
- [ ] Tạo `/callback/github` page
- [ ] Tạo `/callback/jira` page
- [ ] Tạo `GitHubConnectButton` component
- [ ] Tạo `JiraConnectButton` component
- [ ] Test OAuth flows end-to-end

### Phase 2: Update Forms
- [ ] Update Team Config form
- [ ] Xóa `api_token_jira` field
- [ ] Xóa `api_token_github` field
- [ ] Thêm connection status indicators
- [ ] Thêm validation (check connections trước khi save)

### Phase 3: Update Features
- [ ] Update Sync Team button (check connections)
- [ ] Update Sprint CRUD operations
- [ ] Update Task CRUD operations
- [ ] Update GitHub commit viewer
- [ ] Update Jira task viewer

### Phase 4: Error Handling
- [ ] Implement centralized error handler
- [ ] Handle `requiresAuth` errors
- [ ] Handle `requiresReauth` errors
- [ ] Show user-friendly error messages
- [ ] Add retry logic

### Phase 5: Testing
- [ ] Test với user đã connect cả 2
- [ ] Test với user chưa connect
- [ ] Test với user connect 1/2
- [ ] Test disconnect flows
- [ ] Test re-auth flows
- [ ] Test concurrent requests
- [ ] Test error scenarios

---

## 🎯 Best Practices

### 1. Always Check Connection Before Actions

```javascript
const performAction = async (action, requiredIntegrations = []) => {
  const user = await getCurrentUser();
  
  for (const integration of requiredIntegrations) {
    const isConnected = user.integrations?.[integration]?.accessToken;
    
    if (!isConnected) {
      const msg = `Vui lòng kết nối ${integration.toUpperCase()} trước`;
      
      if (confirm(`${msg}. Đi đến Settings?`)) {
        window.location.href = '/settings/integrations';
      }
      return null;
    }
  }
  
  return await action();
};

// Usage:
await performAction(
  () => syncTeamData(teamId),
  ['github', 'jira']
);
```

### 2. Show Connection Status Everywhere

```jsx
// Layout/Header component
<div className="header-integrations">
  {!isGitHubConnected && (
    <span className="warning-badge" title="GitHub not connected">
      ⚠️ GitHub
    </span>
  )}
  {!isJiraConnected && (
    <span className="warning-badge" title="Jira not connected">
      ⚠️ Jira
    </span>
  )}
</div>
```

### 3. Graceful Degradation

```jsx
// Feature component
const FeatureComponent = () => {
  const user = useUser();
  const hasGitHub = !!user?.integrations?.github;
  const hasJira = !!user?.integrations?.jira;

  if (!hasGitHub && !hasJira) {
    return (
      <div className="feature-disabled">
        <h3>Tính năng chưa khả dụng</h3>
        <p>Vui lòng kết nối GitHub và Jira để sử dụng tính năng này</p>
        <a href="/settings/integrations">Đi đến Settings</a>
      </div>
    );
  }

  return (
    <div>
      {!hasGitHub && <p>⚠️ GitHub chưa kết nối - một số tính năng bị hạn chế</p>}
      {!hasJira && <p>⚠️ Jira chưa kết nối - một số tính năng bị hạn chế</p>}
      {/* Render feature */}
    </div>
  );
};
```

---

## 🆘 Troubleshooting

### Issue: "Chưa kết nối GitHub/Jira"

**Cause**: User chưa connect OAuth

**Solution**:
1. Navigate to `/settings/integrations`
2. Click "Connect GitHub" hoặc "Connect Jira"
3. Authorize trên provider page
4. Đợi redirect về callback page

### Issue: "Token đã hết hạn"

**Cause**: 
- GitHub: Token bị revoked (không có auto-refresh)
- Jira: Access token hết hạn (1h) và refresh token cũng hết hạn

**Solution**:
1. Click "Disconnect"
2. Click "Connect" lại
3. Re-authorize

### Issue: Callback page không nhận params

**Cause**: Routing config không match

**Solution**:

```javascript
// Next.js: pages/callback/[provider].jsx
export default function OAuthCallback() {
  const router = useRouter();
  const { provider } = router.query;
  
  useEffect(() => {
    if (!router.isReady) return;
    
    const { success, ...rest } = router.query;
    // Handle callback based on provider
  }, [router.isReady, router.query]);
}
```

---

## 📚 Additional Resources

### Documentation

- **Backend Implementation**: See source code in:
  - `controllers/IntegrationController.js`
  - `services/JiraAuthService.js`
  - `services/JiraSyncService.js`
  - `services/IntegrationService.js`

- **Migration Guide**: See `docs/JIRA_OAUTH_MIGRATION_SUMMARY.md`

### External Docs

- [GitHub OAuth Documentation](https://docs.github.com/en/developers/apps/building-oauth-apps)
- [Atlassian OAuth 2.0 Documentation](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)

---

## ✅ Summary

### Key Changes

1. ❌ **Removed**: Team tokens (`api_token_github`, `api_token_jira`)
2. ✅ **Added**: User OAuth for GitHub and Jira
3. ✅ **Benefits**: Auto-refresh, better security, user control

### Migration Checklist

- [ ] Frontend: Implement OAuth flows
- [ ] Frontend: Update Team Config form
- [ ] Frontend: Update all features to check connections
- [ ] Frontend: Implement error handling
- [ ] Testing: End-to-end testing
- [ ] Deployment: Staged rollout

### Support

Questions? Contact:
- Backend team: Check backend source code
- Frontend team: Check this document + component examples
- Issues: Create GitHub issue or check troubleshooting section

---

**Last Updated**: 2024-02-25  
**Version**: 2.0.0 (Full OAuth Migration)  
**Status**: ✅ Backend Complete | ⏳ Frontend Pending
