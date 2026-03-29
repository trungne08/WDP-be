const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');
const Project = require('../models/Project');

const watchTeamMembers = () => {
  console.log("👀 Đang bật chế độ theo dõi DB Toàn Diện (Members, Teams, Projects)...");
  const RESTART_DELAY_MS = 5000;

  const createResilientStream = (label, streamFactory, onChange) => {
    let stream = null;
    let restarting = false;

    const scheduleRestart = (reason, error) => {
      if (restarting) return;
      restarting = true;
      if (error) {
        console.error(`❌ [${label}] ChangeStream lỗi (${reason}):`, error);
      } else {
        console.warn(`⚠️ [${label}] ChangeStream ${reason}. Sẽ thử khởi tạo lại sau ${RESTART_DELAY_MS / 1000}s`);
      }

      try {
        if (stream) stream.removeAllListeners();
        if (stream && !stream.closed) stream.close().catch(() => {});
      } catch (_) {}

      setTimeout(() => {
        restarting = false;
        start();
      }, RESTART_DELAY_MS);
    };

    const start = () => {
      try {
        stream = streamFactory();
      } catch (error) {
        return scheduleRestart('khởi tạo thất bại', error);
      }

      stream.on('change', onChange);
      stream.on('error', (error) => scheduleRestart('mất kết nối MongoDB', error));
      stream.on('end', () => scheduleRestart('đã kết thúc'));
      stream.on('close', () => scheduleRestart('đã đóng'));
      console.log(`✅ [${label}] ChangeStream đã sẵn sàng`);
    };

    start();
    return () => stream;
  };

  // ============================================================
  // 1. THEO DÕI TEAM MEMBER (HYBRID: Change Stream + Controller thủ công cho Import)
  // ============================================================
  // Bật Change Stream để tự động bắt insert/update/delete từng người
  // Import hàng loạt sẽ dùng refresh_class từ Controller (tránh spam 100 events)
  createResilientStream(
    'TeamMember',
    () => TeamMember.watch([], { fullDocument: 'updateLookup' }),
    async (change) => {
    try {
      // Xử lý INSERT (Thêm mới 1 người)
      if (change.operationType === 'insert') {
        const doc = change.fullDocument;
        if (!doc) return;

        const team = await Team.findById(doc.team_id);
        if (team) {
          const classId = team.class_id.toString();

          // Populate để lấy full info
          const fullData = await TeamMember.findById(doc._id)
            .populate('student_id', 'full_name student_code avatar_url email')
            .lean();

          if (global._io) {
            global._io.to(classId).emit('team_member_changed', {
              action: 'insert',
              data: fullData
            });
            console.log(`📡 Member inserted (ID: ${doc._id}) -> Room ${classId}`);
          }
        }
      }

      // Xử lý UPDATE (Sửa nhóm, role, hoặc xóa mềm is_active: false)
      if (change.operationType === 'update') {
        const doc = change.fullDocument;
        if (!doc) return;

        const team = await Team.findById(doc.team_id);
        if (!team) return;

        const classId = team.class_id.toString();

        // Xóa mềm: is_active = false -> bắn action 'delete' để FE xóa khỏi UI
        if (doc.is_active === false) {
          if (global._io) {
            global._io.to(classId).emit('team_member_changed', {
              action: 'delete',
              data: {
                _id: doc._id,
                student_id: doc.student_id
              }
            });
            console.log(`📡 Member soft-deleted (ID: ${doc._id}) -> Room ${classId}`);
          }
          return;
        }

        // Cập nhật thông tin hoặc khôi phục (is_active: true)
        const fullData = await TeamMember.findById(doc._id)
          .populate('student_id', 'full_name student_code avatar_url email')
          .populate('team_id', 'project_name')
          .lean();

        if (global._io) {
          global._io.to(classId).emit('team_member_changed', {
            action: 'update',
            data: fullData
          });
          console.log(`📡 Member updated (ID: ${doc._id}) -> Room ${classId}`);
        }
      }

      // Xử lý DELETE (Xóa 1 người)
      // Lưu ý: Khi delete, change.fullDocument sẽ là null, chỉ có change.documentKey
      if (change.operationType === 'delete') {
        // Lấy team_id từ documentKey (vì fullDocument đã null)
        const deletedId = change.documentKey._id;
        
        // Phải query lại để lấy team_id (vì document đã bị xóa)
        const deletedMember = await TeamMember.findById(deletedId).lean();
        if (!deletedMember) return; // Nếu không tìm thấy thì bỏ qua

        const team = await Team.findById(deletedMember.team_id);
        if (team) {
          const classId = team.class_id.toString();

          if (global._io) {
            global._io.to(classId).emit('team_member_changed', {
              action: 'delete',
              data: {
                _id: deletedId,
                student_id: deletedMember.student_id
              }
            });
            console.log(`📡 Member deleted (ID: ${deletedId}) -> Room ${classId}`);
          }
        }
      }
    } catch (err) {
      console.error("❌ Error watching members:", err);
    }
    }
  );

  // ============================================================
  // 2. THEO DÕI TEAM (Đổi tên nhóm, Khóa nhóm...)
  // ============================================================
  createResilientStream(
    'Team',
    () => Team.watch([], { fullDocument: 'updateLookup' }),
    async (change) => {
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
    }
  );

  // ============================================================
  // 3. THEO DÕI PROJECT (Đổi tên, Deadline...)
  // ============================================================
  createResilientStream(
    'Project',
    () => Project.watch([], { fullDocument: 'updateLookup' }),
    async (change) => {
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
    }
  );
};

module.exports = { watchTeamMembers };