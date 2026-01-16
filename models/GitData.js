const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const GithubCommitSchema = new Schema({
    team: { type: Schema.Types.ObjectId, ref: 'Team' },
    author_email: String, // Dùng để đối chiếu
    hash: { type: String, required: true, unique: true },
    message: String,
    commit_date: Date,
    
    // Chỉ số hiển thị (Không tính điểm)
    stats: {
        additions: Number,
        deletions: Number,
        files_changed: Number
    },
    
    // LOGIC TÍNH ĐIỂM
    is_counted: { type: Boolean, default: false },
    rejection_reason: { type: String, default: null } // 'Spam', 'Too soon', 'Empty'
});

// --- LOGIC XỬ LÝ COOLDOWN 10 PHÚT (Viết ngay trong Model) ---
GithubCommitSchema.statics.processCommit = async function(commitData, teamId) {
    // 1. Check Message Rác
    if (!commitData.message || commitData.message.length < 10) {
        return { is_counted: false, reason: 'Message too short' };
    }
    if (commitData.message.toLowerCase().includes('merge pull request')) {
        return { is_counted: false, reason: 'Merge commit' };
    }

    // 2. Check Cooldown 10 Phút
    // Tìm commit gần nhất ĐÃ ĐƯỢC TÍNH (is_counted = true) của email này
    const lastValidCommit = await this.findOne({
        team: teamId,
        author_email: commitData.author_email,
        is_counted: true
    }).sort({ commit_date: -1 }); // Lấy cái mới nhất

    if (lastValidCommit) {
        const diffInMs = new Date(commitData.commit_date) - new Date(lastValidCommit.commit_date);
        const diffInMinutes = diffInMs / (1000 * 60);

        if (diffInMinutes < 10) { // <--- SỬA THÀNH 10 PHÚT TẠI ĐÂY
            return { is_counted: false, reason: `Too soon (${Math.round(diffInMinutes)}m < 10m)` };
        }
    }

    // Nếu thỏa mãn tất cả
    return { is_counted: true, reason: null };
};

module.exports = mongoose.model('GithubCommit', GithubCommitSchema);