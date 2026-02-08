const axios = require('axios');

/**
 * GithubService - Sync commits từ TẤT CẢ branches
 * Refactored to support multi-branch sync with deduplication
 */

// =========================
// 1. HELPER FUNCTIONS
// =========================

/**
 * Parse GitHub repo URL để lấy owner và repo name
 * @param {string} repoUrl - VD: https://github.com/username/repo hoặc https://github.com/username/repo.git
 * @returns {{owner: string, repo: string}}
 */
function parseRepoUrl(repoUrl) {
    if (!repoUrl) {
        throw new Error('Repository URL không hợp lệ');
    }

    // Xử lý URL: loại bỏ .git, trailing slash
    const cleanUrl = repoUrl.replace('.git', '').replace(/\/$/, '');
    const parts = cleanUrl.split('/');
    const repo = parts.pop();   // Lấy cái cuối cùng
    const owner = parts.pop();  // Lấy cái kế cuối

    if (!owner || !repo) {
        throw new Error(`URL Repo không hợp lệ: ${repoUrl}`);
    }

    return { owner, repo };
}

/**
 * Tạo axios instance cho GitHub API
 * @param {string} token - GitHub access token
 * @returns {AxiosInstance}
 */
function createGithubClient(token) {
    return axios.create({
        baseURL: 'https://api.github.com',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 30000
    });
}

// =========================
// 2. FETCH BRANCHES
// =========================

/**
 * Lấy danh sách tất cả branches trong repo
 * @param {string} repoUrl
 * @param {string} token
 * @returns {Promise<Array<{name: string, sha: string}>>}
 */
async function fetchBranches(repoUrl, token) {
    try {
        const { owner, repo } = parseRepoUrl(repoUrl);
        const client = createGithubClient(token);

        console.log(`🌿 [GitHub] Fetching branches for ${owner}/${repo}...`);

        const response = await client.get(`/repos/${owner}/${repo}/branches`, {
            params: {
                per_page: 100 // GitHub default max
            }
        });

        const branches = response.data.map(branch => ({
            name: branch.name,
            sha: branch.commit.sha
        }));

        console.log(`✅ [GitHub] Found ${branches.length} branch(es):`, branches.map(b => b.name).join(', '));

        return branches;
    } catch (error) {
        const status = error.response?.status || 'Unknown';
        const msg = error.response?.data?.message || error.message;
        console.error(`❌ [GitHub] Lỗi fetch branches (Status ${status}): ${msg}`);
        
        // Nếu lỗi 401/403 → token không hợp lệ
        if (status === 401 || status === 403) {
            throw new Error('GitHub token không hợp lệ hoặc đã hết hạn');
        }
        
        // Nếu lỗi 404 → repo không tồn tại hoặc không có quyền
        if (status === 404) {
            throw new Error('Repository không tồn tại hoặc không có quyền truy cập');
        }
        
        throw error;
    }
}

// =========================
// 3. FETCH COMMITS FROM BRANCH
// =========================

/**
 * Lấy commits từ một branch cụ thể
 * @param {string} repoUrl
 * @param {string} token
 * @param {string} branchName
 * @param {number} maxCommits - Số lượng commits tối đa (default: 100)
 * @returns {Promise<Array>}
 */
async function fetchCommitsFromBranch(repoUrl, token, branchName, maxCommits = 100) {
    try {
        const { owner, repo } = parseRepoUrl(repoUrl);
        const client = createGithubClient(token);

        console.log(`  📥 [GitHub] Fetching commits from branch: ${branchName}...`);

        const response = await client.get(`/repos/${owner}/${repo}/commits`, {
            params: {
                sha: branchName,      // Chỉ định branch
                per_page: maxCommits,
                page: 1
            }
        });

        const commits = response.data.map(item => ({
            hash: item.sha,
            message: item.commit.message,
            author_email: item.commit.author.email,
            author_name: item.commit.author.name,
            commit_date: item.commit.author.date,
            url: item.html_url,
            branch: branchName // Lưu thông tin branch
        }));

        console.log(`     ✅ ${commits.length} commit(s) from ${branchName}`);

        return commits;
    } catch (error) {
        const status = error.response?.status || 'Unknown';
        const msg = error.response?.data?.message || error.message;
        console.error(`     ❌ Lỗi fetch commits from ${branchName} (Status ${status}): ${msg}`);
        
        // Không throw error, chỉ return [] để không làm fail toàn bộ sync
        return [];
    }
}

// =========================
// 4. FETCH ALL COMMITS (ALL BRANCHES)
// =========================

/**
 * Lấy commits từ TẤT CẢ branches với deduplication
 * @param {string} repoUrl
 * @param {string} token
 * @param {Object} options
 * @param {number} options.maxCommitsPerBranch - Max commits per branch (default: 100)
 * @param {boolean} options.includeBranchInfo - Lưu thông tin branch vào commit (default: true)
 * @returns {Promise<Array>}
 */
async function fetchCommits(repoUrl, token, options = {}) {
    try {
        const { maxCommitsPerBranch = 100, includeBranchInfo = true } = options;

        if (!repoUrl || !token) {
            console.log('⚠️ [GithubService] Thiếu URL hoặc Token');
            return [];
        }

        const { owner, repo } = parseRepoUrl(repoUrl);
        console.log(`📡 [GitHub] Đang sync commits từ: ${owner}/${repo}...`);

        // 1. Lấy danh sách branches
        const branches = await fetchBranches(repoUrl, token);

        if (branches.length === 0) {
            console.warn('⚠️ [GitHub] Không tìm thấy branch nào!');
            return [];
        }

        // 2. Fetch commits từ TẤT CẢ branches (parallel)
        console.log(`🔄 [GitHub] Fetching commits from ${branches.length} branch(es)...`);

        const commitPromises = branches.map(branch => 
            fetchCommitsFromBranch(repoUrl, token, branch.name, maxCommitsPerBranch)
        );

        const commitArrays = await Promise.all(commitPromises);

        // 3. Flatten và deduplicate commits
        const allCommits = commitArrays.flat();
        
        console.log(`📊 [GitHub] Total commits (with duplicates): ${allCommits.length}`);

        // Deduplicate theo SHA (commit hash)
        const uniqueCommitsMap = new Map();

        for (const commit of allCommits) {
            if (!uniqueCommitsMap.has(commit.hash)) {
                uniqueCommitsMap.set(commit.hash, {
                    ...commit,
                    branches: [commit.branch] // Lưu branch đầu tiên
                });
            } else {
                // Commit đã tồn tại → Thêm branch vào danh sách
                const existing = uniqueCommitsMap.get(commit.hash);
                if (!existing.branches.includes(commit.branch)) {
                    existing.branches.push(commit.branch);
                }
            }
        }

        const uniqueCommits = Array.from(uniqueCommitsMap.values());

        console.log(`✅ [GitHub] Unique commits (after dedup): ${uniqueCommits.length}`);
        console.log(`   - Branches synced: ${branches.map(b => b.name).join(', ')}`);

        // 4. Nếu không cần lưu branch info, xóa field branches
        if (!includeBranchInfo) {
            uniqueCommits.forEach(commit => {
                delete commit.branch;
                delete commit.branches;
            });
        }

        return uniqueCommits;

    } catch (error) {
        const status = error.response?.status || 'Unknown';
        const msg = error.response?.data?.message || error.message;
        console.error(`❌ [GithubService] Lỗi (Status ${status}): ${msg}`);
        return []; // Trả về mảng rỗng để không chết server
    }
}

// =========================
// 5. LEGACY FUNCTION (Backward Compatible)
// =========================

/**
 * Fetch commits từ branch mặc định (main/master)
 * Legacy function - backward compatible
 * @deprecated Use fetchCommits() instead (now supports all branches)
 */
async function fetchCommitsFromDefaultBranch(repoUrl, token) {
    console.warn('⚠️ [GitHub] Using legacy fetchCommitsFromDefaultBranch. Consider using fetchCommits() for all branches.');
    
    try {
        const { owner, repo } = parseRepoUrl(repoUrl);
        const client = createGithubClient(token);

        const response = await client.get(`/repos/${owner}/${repo}/commits`, {
            params: {
                per_page: 100,
                page: 1
            }
        });

        const commits = response.data.map(item => ({
            hash: item.sha,
            message: item.commit.message,
            author_email: item.commit.author.email,
            author_name: item.commit.author.name,
            commit_date: item.commit.author.date,
            url: item.html_url
        }));

        console.log(`✅ [GitHub] Đã lấy được ${commits.length} commits từ default branch.`);
        return commits;

    } catch (error) {
        const status = error.response?.status || 'Unknown';
        const msg = error.response?.data?.message || error.message;
        console.error(`❌ [GithubService] Lỗi (Status ${status}): ${msg}`);
        return [];
    }
}

// =========================
// 6. EXPORTS
// =========================

module.exports = {
    // Main function (all branches)
    fetchCommits,
    
    // Helper functions
    fetchBranches,
    fetchCommitsFromBranch,
    
    // Legacy (backward compatible)
    fetchCommitsFromDefaultBranch,
    
    // Utils
    parseRepoUrl,
    createGithubClient
};
