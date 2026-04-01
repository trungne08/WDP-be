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
    /** true = merge commit (Merge branch / Merge pull request...) — không tính điểm, không chấm AI */
    is_merge_commit: { type: Boolean, default: false },
    rejection_reason: String, // Lý do không tính điểm (tiếng Việt)
    /** Cảnh báo nhẹ khi vẫn tính điểm (vd: message chưa chuẩn) — hiển thị cho cột “lý do / cảnh báo” */
    scoring_note_vi: { type: String, default: null },

    // AI grading (lưu điểm & nhận xét code review Gemini)
    ai_score: { type: Number, default: null },
    ai_review: { type: String, default: null }
});

// Đảm bảo 1 commit hash chỉ unique trong PHẠM VI 1 team,
// tránh việc 2 team khác nhau chia sẻ cùng history mà bị "đè" lẫn nhau.
GithubCommitSchema.index({ team_id: 1, hash: 1 }, { unique: true });

/** Merge commit (Git/GitHub) — không tính điểm leaderboard / không chấm AI */
function isMergeCommitMessage(message) {
    const firstLine = String(message || '')
        .trim()
        .split(/\r?\n/)[0]
        .trim();
    if (!firstLine) return false;
    return (
        /^merge\s+branch\s+/i.test(firstLine) ||
        /^merge\s+pull\s+request\s+/i.test(firstLine) ||
        /^merge\s+remote-tracking\s+branch/i.test(firstLine)
    );
}

GithubCommitSchema.statics.isMergeCommitMessage = isMergeCommitMessage;

/**
 * Chuẩn hóa lý do từ DB (cũ có thể là tiếng Anh) → tiếng Việt cho API/FE.
 */
GithubCommitSchema.statics.localizeRejectionReason = function (reason) {
    if (reason == null || reason === '') return null;
    const s = String(reason).trim();
    const legacy = {
        'Message format penalty':
            'Tin nhắn commit chưa đạt chuẩn (quá ngắn hoặc chưa theo Conventional Commits). Điểm AI vẫn tính nhưng bị giảm hệ số khi chấm.',
        'Merge commit — không tính điểm':
            'Đây là commit merge (ghép nhánh hoặc Pull Request) — không tính điểm xếp hạng.'
    };
    if (legacy[s]) return legacy[s];
    const m = /^Too soon \((\d+)m < 10m\)$/.exec(s);
    if (m) {
        return `Đẩy commit quá sát nhau: cách lần được tính điểm trước đó khoảng ${m[1]} phút; cần tối thiểu 10 phút giữa hai lần tính điểm.`;
    }
    return s;
};

/**
 * Một dòng để cột UI hiển thị: ưu tiên lý do loại khỏi điểm, sau đó cảnh báo format (vẫn tính điểm).
 */
GithubCommitSchema.statics.penaltyDisplayVi = function (doc) {
    if (!doc) return null;
    const reject = doc.rejection_reason
        ? this.localizeRejectionReason(doc.rejection_reason)
        : null;
    if (reject) return reject;
    if (doc.scoring_note_vi) return String(doc.scoring_note_vi).trim() || null;
    return null;
};

/** Gắn thêm field tiếng Việt thống nhất cho JSON trả về FE (không đổi dữ liệu gốc DB). */
GithubCommitSchema.statics.localizeCommitForApi = function (doc) {
    if (!doc || typeof doc !== 'object') return doc;
    return {
        ...doc,
        rejection_reason: doc.rejection_reason ? this.localizeRejectionReason(doc.rejection_reason) : null,
        penalty_display_vi: this.penaltyDisplayVi(doc)
    };
};

/** Parse commit_date → epoch ms; null nếu không hợp lệ (tránh NaN / so sánh sai → 0 phút). */
function commitDateToMs(value) {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
}

// --- LOGIC XỬ LÝ COOLDOWN 10 PHÚT (Viết ngay trong Model) ---
/**
 * @param {object} commitData
 * @param {import('mongoose').Types.ObjectId|string} teamId
 * @param {{ isSync?: boolean }} [options] — isSync=true: đồng bộ lịch sử từ GitHub, bỏ qua cooldown (chỉ merge + format).
 */
GithubCommitSchema.statics.processCommit = async function(commitData, teamId, options = {}) {
    const isSync = options.isSync === true;
    const rawMessage = String(commitData.message || '').trim();

    // Merge commit: không tính điểm (không phải penalty cooldown)
    if (isMergeCommitMessage(rawMessage)) {
        return {
            is_counted: false,
            reason: 'Đây là commit merge (ghép nhánh hoặc Pull Request) — không tính điểm xếp hạng.',
            isMergeCommit: true,
            scoringNoteVi: null
        };
    }

    // Đồng bộ lịch sử (GitHub Sync): luôn is_counted = true (merge đã xử lý ở trên).
    if (isSync) {
        const messageLooksBad = !rawMessage || rawMessage.length < 10;
        return {
            is_counted: true,
            reason: null,
            isMergeCommit: false,
            scoringNoteVi: messageLooksBad
                ? 'Tin nhắn commit chưa đạt chuẩn (quá ngắn hoặc chưa theo Conventional Commits). Điểm AI vẫn tính nhưng bị giảm hệ số khi chấm.'
                : null
        };
    }

    // 1. Commit message sai format KHÔNG loại commit khỏi vòng tính điểm nữa.
    //    Penalty sẽ được xử lý ở bước chấm AI score.
    const messageLooksBad =
        !rawMessage ||
        rawMessage.length < 10;

    // 2. Cooldown 10 phút — chỉ áp realtime (push/webhook); sync lịch sử không phạt “quá sát” do thứ tự/DB.
    if (!isSync) {
        const lastValidCommit = await this.findOne({
            team_id: teamId,
            author_email: commitData.author_email,
            is_counted: true
        }).sort({ commit_date: -1 });

        if (lastValidCommit) {
            const currentTs = commitDateToMs(commitData.commit_date);
            const lastTs = commitDateToMs(lastValidCommit.commit_date);
            if (currentTs != null && lastTs != null) {
                const diffInMs = Math.abs(currentTs - lastTs);
                const diffInMinutes = diffInMs / (1000 * 60);
                if (Number.isFinite(diffInMinutes) && diffInMinutes < 10) {
                    const mins = Math.round(diffInMinutes);
                    return {
                        is_counted: false,
                        reason: `Đẩy commit quá sát nhau: cách lần được tính điểm trước đó khoảng ${mins} phút; cần tối thiểu 10 phút giữa hai lần tính điểm.`,
                        isMergeCommit: false,
                        scoringNoteVi: null
                    };
                }
            }
        }
    }

    // Message chưa đẹp: vẫn counted=true; ghi rõ cảnh báo tiếng Việt (hệ số AI xử lý ở bước chấm điểm).
    if (messageLooksBad) {
        return {
            is_counted: true,
            reason: null,
            isMergeCommit: false,
            scoringNoteVi:
                'Tin nhắn commit chưa đạt chuẩn (quá ngắn hoặc chưa theo Conventional Commits). Điểm AI vẫn tính nhưng bị giảm hệ số khi chấm.'
        };
    }

    return { is_counted: true, reason: null, isMergeCommit: false, scoringNoteVi: null };
};

module.exports = mongoose.model('GithubCommit', GithubCommitSchema);