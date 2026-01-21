const axios = require('axios');

/**
 * Hàm lấy danh sách commit từ GitHub
 * @param {string} repoUrl - Link repo (VD: https://github.com/username/repo)
 * @param {string} token - Token GitHub (ghp_...)
 */
const fetchCommits = async (repoUrl, token) => {
    try {
        if (!repoUrl || !token) {
            console.log('⚠️ [GithubService] Thiếu URL hoặc Token');
            return [];
        }

        // 1. Xử lý URL để lấy owner và repo name
        // Input: https://github.com/trung/du-an-swp.git
        // Output: owner="trung", repo="du-an-swp"
        const cleanUrl = repoUrl.replace('.git', '').replace(/\/$/, '');
        const parts = cleanUrl.split('/');
        const repo = parts.pop();   // Lấy cái cuối cùng
        const owner = parts.pop();  // Lấy cái kế cuối

        if (!owner || !repo) {
            console.error('❌ [GithubService] URL Repo không hợp lệ:', repoUrl);
            return [];
        }

        console.log(`📡 [GithubService] Đang lấy commit từ: ${owner}/${repo}...`);

        // 2. Gọi API GitHub (Lấy max 100 commit gần nhất)
        const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/commits`, {
            headers: {
                'Authorization': `Bearer ${token}`, // Dùng Bearer chuẩn hơn
                'Accept': 'application/vnd.github.v3+json'
            },
            params: {
                per_page: 100, 
                page: 1
            }
        });

        // 3. Map dữ liệu về dạng chuẩn
        const commits = response.data.map(item => ({
            hash: item.sha,
            message: item.commit.message,
            author_email: item.commit.author.email,
            commit_date: item.commit.author.date,
            url: item.html_url
        }));

        console.log(`✅ [GithubService] Đã lấy được ${commits.length} commits.`);
        return commits;

    } catch (error) {
        // Log lỗi chi tiết để dễ debug
        const status = error.response ? error.response.status : 'Unknown';
        const msg = error.response ? error.response.data.message : error.message;
        console.error(`❌ [GithubService] Lỗi (Status ${status}): ${msg}`);
        return []; // Trả về mảng rỗng để không chết server
    }
};

module.exports = { fetchCommits };