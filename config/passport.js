const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getRoleFromEmail, extractStudentCodeFromEmail } = require('../utils/roleHelper');
const models = require('../models');

async function assertStudentCodeNotLinked(studentCode, excludeUserId = null) {
  const normalizedCode = String(studentCode || '').trim().toUpperCase();
  if (!normalizedCode) return;

  const query = { student_code: normalizedCode };
  if (excludeUserId) query._id = { $ne: excludeUserId };

  const existed = await models.Student.findOne(query).select('_id email student_code').lean();
  if (existed) {
    const err = new Error('Mã số sinh viên này đã được liên kết với một tài khoản Google khác trong hệ thống.');
    err.code = 'STUDENT_CODE_ALREADY_LINKED';
    throw err;
  }
}

/**
 * Cấu hình Google OAuth Strategy
 * Chỉ khởi tạo nếu có đủ env variables
 */
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const googleId = profile.id;
        const displayName = profile.displayName || profile.name?.givenName + ' ' + profile.name?.familyName || '';
        const avatarUrl = profile.photos?.[0]?.value || '';

        if (!email) {
          return done(new Error('Không thể lấy email từ Google account'), null);
        }

        // Phân loại Role từ email
        const role = getRoleFromEmail(email);
        console.log(`🔍 Email: ${email} -> Role: ${role}`);

        let user = null;
        let UserModel = null;

        // Xác định Model dựa trên Role
        if (role === 'STUDENT') {
          UserModel = models.Student;
        } else if (role === 'LECTURER') {
          UserModel = models.Lecturer;
        } else if (role === 'ADMIN') {
          UserModel = models.Admin;
        } else {
          return done(new Error(`Không thể xác định Role từ email: ${email}`), null);
        }

        // Tìm user theo googleId hoặc email
        user = await UserModel.findOne({
          $or: [
            { googleId: googleId },
            { email: email.toLowerCase() }
          ]
        });

        if (user) {
          // User đã tồn tại: Cập nhật thông tin Google nếu cần
          if (!user.googleId) {
            user.googleId = googleId;
          }
          if (avatarUrl && (!user.avatar_url || user.avatar_url !== avatarUrl)) {
            user.avatar_url = avatarUrl;
          }
          if (displayName && (!user.full_name || user.full_name !== displayName)) {
            user.full_name = displayName;
          }
          if (role === 'STUDENT') {
            const derivedCode = (extractStudentCodeFromEmail(email) || email.split('@')[0] || '').toUpperCase();
            if (derivedCode && !user.student_code) {
              await assertStudentCodeNotLinked(derivedCode, user._id);
              user.student_code = derivedCode;
            }
          }
          // Đánh dấu email đã verified khi login bằng Google
          user.is_verified = true;
          await user.save();
          console.log(`✅ Cập nhật thông tin Google cho user: ${email}`);
        } else {
          // User chưa tồn tại: Tạo mới
          const randomPassword = crypto.randomBytes(32).toString('hex');
          const hashedPassword = await bcrypt.hash(randomPassword, 10);

          const userData = {
            email: email.toLowerCase(),
            googleId: googleId,
            full_name: displayName,
            avatar_url: avatarUrl,
            password: hashedPassword, // Password random, user sẽ không dùng password này
            is_verified: true, // Google email đã verified
          };

          // Nếu là Student, thêm student_code
          if (role === 'STUDENT') {
            const studentCode = extractStudentCodeFromEmail(email);
            if (studentCode) {
              await assertStudentCodeNotLinked(studentCode);
              userData.student_code = studentCode.toUpperCase();
            } else {
              // Nếu không extract được, dùng email username làm student_code tạm thời
              const username = email.split('@')[0];
              const fallbackCode = username.toUpperCase();
              await assertStudentCodeNotLinked(fallbackCode);
              userData.student_code = fallbackCode;
              console.warn(`⚠️ Không thể extract student_code từ email ${email}, dùng username: ${userData.student_code}`);
            }
          }

          user = await UserModel.create(userData);
          console.log(`✅ Tạo mới user từ Google: ${email} (Role: ${role})`);
        }

        // Trả về user object đầy đủ để controller có thể dùng
        // Lưu thêm role vào user object để dễ truy cập
        const userObj = user.toObject();
        userObj.role = role;
        return done(null, userObj);

      } catch (error) {
        console.error('❌ Google OAuth Error:', error);
        return done(error, null);
      }
    }
  )
  );
} else {
  console.warn('⚠️ Google OAuth không được cấu hình (thiếu GOOGLE_CLIENT_ID hoặc GOOGLE_CLIENT_SECRET)');
}

/**
 * Serialize user để lưu vào session (nếu dùng session)
 * Hoặc có thể bỏ qua nếu chỉ dùng JWT
 */
passport.serializeUser((user, done) => {
  // user object từ strategy callback: { id, role, email }
  done(null, user);
});

passport.deserializeUser(async (userObj, done) => {
  try {
    let UserModel = null;
    if (userObj.role === 'STUDENT') {
      UserModel = models.Student;
    } else if (userObj.role === 'LECTURER') {
      UserModel = models.Lecturer;
    } else if (userObj.role === 'ADMIN') {
      UserModel = models.Admin;
    } else {
      return done(new Error('Invalid role'), null);
    }

    const user = await UserModel.findById(userObj.id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
