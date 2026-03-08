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

/** Giới hạn an toàn: tối đa 10 trang × 100 = 1000 commits/branch (tránh GitHub rate limit) */
const MAX_PAGES_PER_BRANCH = 10;
const PER_PAGE = 100;

/**
 * Lấy commits từ một branch cụ thể (có pagination)
 * @param {string} repoUrl
 * @param {string} token
 * @param {string} branchName
 * @param {number} maxCommits - Số lượng commits tối đa mong muốn (default: 1000)
 * @returns {Promise<Array>}
 */
async function fetchCommitsFromBranch(repoUrl, token, branchName, maxCommits = 1000) {
    try {
        const { owner, repo } = parseRepoUrl(repoUrl);
        const client = createGithubClient(token);

        const maxPages = Math.min(MAX_PAGES_PER_BRANCH, Math.ceil(maxCommits / PER_PAGE));
        const allCommits = [];
        let page = 1;

        console.log(`  📥 [GitHub] Fetching commits from branch: ${branchName}...`);

        while (page <= maxPages) {
            const response = await client.get(`/repos/${owner}/${repo}/commits`, {
                params: {
                    sha: branchName,
                    per_page: PER_PAGE,
                    page
                }
            });

            const items = response.data || [];
            if (items.length === 0) break;

            const commits = items.map(item => ({
                hash: item.sha,
                message: item.commit.message,
                author_email: item.commit.author?.email,
                author_name: item.commit.author?.name,
                commit_date: item.commit.author?.date,
                url: item.html_url,
                branch: branchName
            }));

            allCommits.push(...commits);
            if (items.length < PER_PAGE) break;
            page++;
        }

        console.log(`     ✅ ${allCommits.length} commit(s) from ${branchName} (${page} page(s))`);

        return allCommits;
    } catch (error) {
        const status = error.response?.status || 'Unknown';
        const msg = error.response?.data?.message || error.message;
        console.error(`     ❌ Lỗi fetch commits from ${branchName} (Status ${status}): ${msg}`);

        return [];
    }
}

// =========================
// 4. FETCH ALL COMMITS (ALL BRANCHES)
// =========================

/**
 * Lấy commits từ TẤT CẢ branches hoặc 1 branch cụ thể
 * @param {string} repoUrl
 * @param {string} token
 * @param {Object} options
 * @param {number} options.maxCommitsPerBranch - Max commits per branch (default: 500, tối đa 1000)
 * @param {boolean} options.includeBranchInfo - Lưu thông tin branch vào commit (default: true)
 * @param {string} [options.branch] - Nhánh cụ thể (VD: main, dev). Nếu có thì chỉ lấy commits của nhánh đó
 * @returns {Promise<Array>}
 */
async function fetchCommits(repoUrl, token, options = {}) {
    try {
        const { maxCommitsPerBranch = 500, includeBranchInfo = true, branch: branchFilter } = options;

        if (!repoUrl || !token) {
            console.log('⚠️ [GithubService] Thiếu URL hoặc Token');
            return [];
        }

        const { owner, repo } = parseRepoUrl(repoUrl);

        // Nếu có branch cụ thể → chỉ fetch nhánh đó
        if (branchFilter && typeof branchFilter === 'string' && branchFilter.trim()) {
            const branchName = branchFilter.trim();
            console.log(`📡 [GitHub] Đang sync commits từ nhánh: ${branchName}...`);
            const commits = await fetchCommitsFromBranch(repoUrl, token, branchName, maxCommitsPerBranch);
            return includeBranchInfo ? commits : commits.map(c => ({ ...c, branch: undefined }));
        }

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
                    branch: commit.branch,
                    branches: [commit.branch]
                });
            } else {
                const existing = uniqueCommitsMap.get(commit.hash);
                if (commit.branch && !existing.branches.includes(commit.branch)) {
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
// 6. CREATE REPOSITORY (Auto-Provisioning)
// =========================

/**
 * Tạo repository mới trên GitHub (dùng tham số nâng cao của GitHub REST API)
 * @param {string} accessToken - GitHub OAuth access token
 * @param {string} repoName - Tên repo (slug hợp lệ: chữ, số, dấu gạch ngang/dưới)
 * @param {string} [description] - Mô tả repo (mặc định: "Created via WDP Management System")
 * @param {boolean} [isPrivate=false] - Repo private hay public
 * @param {string} [gitignoreTemplate] - Gitignore template (VD: Node, Java, Python). Mặc định: Node
 * @returns {Promise<{html_url: string, clone_url: string, [key: string]: any}>} Response data từ GitHub
 */
async function createRepository(accessToken, repoName, description = '', isPrivate = false, gitignoreTemplate) {
    try {
        if (!accessToken || typeof accessToken !== 'string' || !accessToken.trim()) {
            throw new Error('GitHub access token là bắt buộc');
        }
        if (!repoName || typeof repoName !== 'string' || !repoName.trim()) {
            throw new Error('Tên repository là bắt buộc');
        }

        const desc = (description && typeof description === 'string') ? description.trim() : 'Created via WDP Management System';
        const client = createGithubClient(accessToken);
        const payload = {
            name: repoName.trim(),
            description: desc,
            private: !!isPrivate,
            auto_init: true,
            has_issues: false,
            has_projects: false,
            has_wiki: false,
            gitignore_template: gitignoreTemplate || 'Node',
            license_template: 'mit'
        };

        const response = await client.post('/user/repos', payload);
        return response.data;
    } catch (error) {
        const status = error.response?.status;
        const msg = error.response?.data?.message || error.message;
        const errors = error.response?.data?.errors;

        if (status === 401 || status === 403) {
            throw new Error('GitHub token không hợp lệ hoặc đã hết hạn. Vui lòng kết nối lại GitHub.');
        }
        if (status === 422) {
            // Validation failed: trùng tên repo, tên không hợp lệ, v.v.
            const detail = errors?.length ? errors.map(e => e.message || e.code).join('; ') : msg;
            throw new Error(detail || 'Tên repository đã tồn tại hoặc không hợp lệ.');
        }
        throw error;
    }
}

// =========================
// 7. GET COMMIT DETAILS (Patch/Diff)
// =========================

/**
 * Lấy chi tiết một commit (bao gồm patch/diff từng file)
 * @param {string} repoUrl - URL repo (VD: https://github.com/owner/repo)
 * @param {string} accessToken - GitHub OAuth access token
 * @param {string} sha - Commit SHA (full hash)
 * @returns {Promise<Array<{filename: string, status: string, additions: number, deletions: number, patch: string}>>}
 */
async function getCommitDetails(repoUrl, accessToken, sha) {
    try {
        if (!repoUrl || !accessToken || !sha) {
            throw new Error('repoUrl, accessToken và sha là bắt buộc');
        }

        const { owner, repo } = parseRepoUrl(repoUrl);
        const client = createGithubClient(accessToken);

        const response = await client.get(`/repos/${owner}/${repo}/commits/${sha}`);

        const files = response.data?.files || [];
        return files.map(file => ({
            filename: file.filename,
            status: file.status || 'unknown',
            additions: file.additions ?? 0,
            deletions: file.deletions ?? 0,
            patch: file.patch || 'Không có text diff (có thể là file ảnh/nhị phân)'
        }));
    } catch (error) {
        const status = error.response?.status;
        const msg = error.response?.data?.message || error.message;

        if (status === 401 || status === 403) {
            throw new Error('GitHub token không hợp lệ hoặc đã hết hạn');
        }
        if (status === 404) {
            throw new Error('Commit hoặc repository không tồn tại hoặc không có quyền truy cập');
        }
        throw error;
    }
}

// =========================
// 8. EXPORTS
// =========================

module.exports = {
    // Main function (all branches)
    fetchCommits,

    // Create repo (auto-provisioning)
    createRepository,

    // Commit details (patch/diff)
    getCommitDetails,
    
    // Helper functions
    fetchBranches,
    fetchCommitsFromBranch,
    
    // Legacy (backward compatible)
    fetchCommitsFromDefaultBranch,
    
    // Utils
    parseRepoUrl,
    createGithubClient
};
