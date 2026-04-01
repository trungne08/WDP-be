const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const GithubCommitSchema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    author_email: String, // Must match student email
    author_name: String, // Tên author từ GitHub
    // Không để unique theo hash toàn hệ thống nữa, vì cùng 1 commit hash
    // có thể xuất hiện ở nhiều team/project khác nhau (fork, chia repo, v.v.)
    // Unique sẽ được đảm bảo bằng index compound bên dưới: (team_id + hash)
    hash: { type: String, required: true },
    message: String,
    commit_date: Date,
    url: String, // Link đến commit trên GitHub
    
    // Stats Display Only (flat fields theo schema)
    additions: Number,
    deletions: Number,
    files_changed: Number,
    
    // BRANCH INFO (Multi-branch support)
    branch: String, // Nhánh chính chứa commit (khi sync theo 1 nhánh cụ thể)
    branches: [String], // Danh sách branches chứa commit này (khi sync tất cả nhánh)
    
    // SMART LINKING - Jira Issues được trích xuất từ commit message (VD: "Fix SCRUM-12, SCRUM-15")
    jira_issues: [String],
    
    // LOGIC TÍNH ĐIỂM (QUALIFIED)
    is_counted: { type: Boolean, default: false },
    rejection_reason: String, // 'Spam', 'Too soon', 'Empty'

    // AI grading (lưu điểm & nhận xét code review Gemini)
    ai_score: { type: Number, default: null },
    ai_review: { type: String, default: null }
});

// Đảm bảo 1 commit hash chỉ unique trong PHẠM VI 1 team,
// tránh việc 2 team khác nhau chia sẻ cùng history mà bị "đè" lẫn nhau.
GithubCommitSchema.index({ team_id: 1, hash: 1 }, { unique: true });

// --- LOGIC XỬ LÝ COOLDOWN 10 PHÚT (Viết ngay trong Model) ---
GithubCommitSchema.statics.processCommit = async function(commitData, teamId) {
    // 1. Commit message sai format KHÔNG loại commit khỏi vòng tính điểm nữa.
    //    Penalty sẽ được xử lý ở bước chấm AI score.
    const rawMessage = String(commitData.message || '').trim();
    const messageLooksBad =
        !rawMessage ||
        rawMessage.length < 10 ||
        rawMessage.toLowerCase().includes('merge pull request');

    // 2. Check Cooldown 30 Phút (theo schema note: "True if Cooldown > 30m")
    // Tìm commit gần nhất ĐÃ ĐƯỢC TÍNH (is_counted = true) của email này
    const lastValidCommit = await this.findOne({
        team_id: teamId,
        author_email: commitData.author_email,
        is_counted: true
    }).sort({ commit_date: -1 }); // Lấy cái mới nhất

    if (lastValidCommit) {
        const diffInMs = new Date(commitData.commit_date) - new Date(lastValidCommit.commit_date);
        const diffInMinutes = diffInMs / (1000 * 60);

        if (diffInMinutes < 10) { // Cooldown > 10m theo schema
            return { is_counted: false, reason: `Too soon (${Math.round(diffInMinutes)}m < 10m)` };
        }
    }

    // Nếu message có vấn đề thì vẫn counted=true, chỉ gắn cờ để downstream áp penalty.
    if (messageLooksBad) {
        return { is_counted: true, reason: 'Message format penalty' };
    }

    return { is_counted: true, reason: null };
};

module.exports = mongoose.model('GithubCommit', GithubCommitSchema);