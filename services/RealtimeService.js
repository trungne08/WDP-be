const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');
const Project = require('../models/Project');

const watchTeamMembers = () => {
  console.log("👀 Đang bật chế độ theo dõi DB Toàn Diện (Members, Teams, Projects)...");

  // ============================================================
  // 1. THEO DÕI TEAM MEMBER (ĐÃ TẮT - Dùng bắn thủ công trong Controller)
  // ============================================================
  // TẮT Change Stream cho TeamMember vì Controller đã bắn Socket thủ công
  // Lý do: Controller có thể populate đầy đủ data và kiểm soát tốt hơn
  // 
  // const memberStream = TeamMember.watch([], { fullDocument: 'updateLookup' });
  // ... (code cũ đã comment)
  
  console.log("ℹ️ TeamMember Change Stream đã tắt - Dùng Socket thủ công trong Controller");

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