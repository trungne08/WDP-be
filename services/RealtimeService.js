const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');
const Project = require('../models/Project');

const watchTeamMembers = () => {
  console.log("👀 Đang bật chế độ theo dõi DB Toàn Diện (Members, Teams, Projects)...");

  // ============================================================
  // 1. THEO DÕI TEAM MEMBER (Thêm người, Đổi role, Đổi điểm...)
  // ============================================================
  const memberStream = TeamMember.watch([], { fullDocument: 'updateLookup' });

  memberStream.on('change', async (change) => {
    try {
      // Chỉ xử lý INSERT (Thêm mới) và UPDATE (Cập nhật thông tin)
      if (change.operationType === 'insert' || change.operationType === 'update') {
        const doc = change.fullDocument;
        if (!doc) return;

        // Logic: Từ TeamMember -> Tìm ra Team -> Tìm ra Class ID
        const team = await Team.findById(doc.team_id);
        
        if (team) {
          const classId = team.class_id.toString();

          // Lấy full info để trả về FE hiển thị cho đẹp
          const fullData = await TeamMember.findById(doc._id)
            .populate('student_id', 'full_name student_code avatar_url email')
            .lean();

          // Sự kiện chung: 'team_member_changed'
          // FE chỉ cần check type: 'insert' hay 'update' để xử lý
          if (global._io) {
            global._io.to(classId).emit('team_member_changed', {
              action: change.operationType, // 'insert' | 'update'
              data: fullData
            });
            console.log(`📡 Member ${change.operationType} (ID: ${doc._id}) -> Room ${classId}`);
          }
        }
      }
      // Lưu ý: DELETE không hỗ trợ tự động vì mất data tham chiếu (team_id)
    } catch (err) {
      console.error("❌ Error watching members:", err);
    }
  });

  // ============================================================
  // 2. THEO DÕI TEAM (Đổi tên nhóm, Khóa nhóm...)
  // ============================================================
  const teamStream = Team.watch([], { fullDocument: 'updateLookup' });
  
  teamStream.on('change', async (change) => {
    if (change.operationType === 'update') {
      const doc = change.fullDocument;
      if (!doc) return;

      const classId = doc.class_id.toString();

      if (global._io) {
        global._io.to(classId).emit('team_updated', {
          action: 'update',
          data: doc
        });
        console.log(`📡 Team updated (ID: ${doc._id}) -> Room ${classId}`);
      }
    }
  });

  // ============================================================
  // 3. THEO DÕI PROJECT (Đổi tên, Deadline...)
  // ============================================================
  const projectStream = Project.watch([], { fullDocument: 'updateLookup' });

  projectStream.on('change', async (change) => {
    if (change.operationType === 'update' || change.operationType === 'insert') {
      const doc = change.fullDocument;
      if (!doc) return;

      // Project hơi khó tìm ClassID trực tiếp nếu không lưu class_id trong Project
      // Nhưng thường Project gắn với Team -> Team gắn với Class
      // Hoặc nếu FE đang ở trang Project Details thì họ listen theo ProjectID luôn cũng được.
      // Ở đây tui bắn theo Project ID cho tiện nhé.

      const projectId = doc._id.toString();
      
      // Bắn event cho ai đang ở trong phòng "Project" này (nếu ông có logic join_project)
      // Hoặc bắn notification chung. Ở đây tui demo bắn vào room project_id
      if (global._io) {
        global._io.emit('project_updated', { // Emit toàn server hoặc phải setup room project
           action: change.operationType,
           data: doc
        });
        console.log(`📡 Project updated (ID: ${doc._id})`);
      }
    }
  });
};

module.exports = { watchTeamMembers };