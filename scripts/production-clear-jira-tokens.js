/**
 * Script để FORCE CLEAR Jira tokens trên PRODUCTION DATABASE
 * Dùng khi scopes thay đổi và cần users reconnect
 * 
 * Chạy: node scripts/production-clear-jira-tokens.js
 * 
 * QUAN TRỌNG: Script này sẽ XÓA TẤT CẢ Jira integrations!
 * Users SẼ PHẢI reconnect Jira sau khi chạy script này!
 */

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function clearJiraTokens() {
  try {
    console.log('\n🚨 PRODUCTION DATABASE - FORCE CLEAR JIRA TOKENS\n');
    console.log('='.repeat(70));
    console.log('⚠️  WARNING: Script này sẽ XÓA TẤT CẢ Jira integrations!');
    console.log('⚠️  Tất cả users SẼ PHẢI reconnect Jira!\n');

    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    console.log('MongoDB URI:', mongoUri ? '✅ Found' : '❌ Missing');
    
    if (!mongoUri) {
      console.log('\n❌ MONGODB_URI not found in .env!\n');
      process.exit(1);
    }

    // Confirm before proceed
    console.log('\n📋 Script này sẽ:');
    console.log('1. Connect vào production database');
    console.log('2. Tìm TẤT CẢ users có Jira integration');
    console.log('3. XÓA integrations.jira (access token + refresh token)');
    console.log('4. Users sẽ phải reconnect Jira với scopes mới\n');

    const confirm = await question('⚠️  Bạn có chắc chắn muốn tiếp tục? (yes/no): ');
    
    if (confirm.toLowerCase() !== 'yes') {
      console.log('\n❌ Đã hủy. Không có thay đổi nào được thực hiện.\n');
      process.exit(0);
    }

    console.log('\n🔄 Đang kết nối database...');

    // Connect to database
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to production database\n');

    const models = require('../models');

    // Process each user type
    const userTypes = [
      { name: 'Student', model: models.Student },
      { name: 'Lecturer', model: models.Lecturer },
      { name: 'Admin', model: models.Admin }
    ];

    let totalCleared = 0;
    const clearedUsers = [];

    for (const { name, model } of userTypes) {
      console.log(`📋 Processing ${name}s...`);
      console.log('-'.repeat(70));

      // Find users with Jira integration
      const usersWithJira = await model.find({
        'integrations.jira': { $exists: true, $ne: null }
      }).select('_id email integrations').lean();

      console.log(`   Found ${usersWithJira.length} ${name}(s) with Jira integration`);

      if (usersWithJira.length === 0) {
        console.log(`   ✅ No ${name}s have Jira integration\n`);
        continue;
      }

      // Clear Jira integration for each user
      for (const user of usersWithJira) {
        try {
          await model.updateOne(
            { _id: user._id },
            { $unset: { 'integrations.jira': '' } }
          );
          console.log(`   🗑️  Cleared: ${user.email}`);
          clearedUsers.push({ email: user.email, type: name });
          totalCleared++;
        } catch (err) {
          console.error(`   ❌ Error clearing ${user.email}:`, err.message);
        }
      }

      console.log(`   ✅ Cleared ${usersWithJira.length} ${name}(s)\n`);
    }

    // Summary
    console.log('='.repeat(70));
    console.log('📊 SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Cleared Jira integrations for ${totalCleared} user(s)\n`);

    if (clearedUsers.length > 0) {
      console.log('📋 Users affected:');
      clearedUsers.forEach((u, idx) => {
        console.log(`   ${idx + 1}. ${u.email} (${u.type})`);
      });
      console.log('');
    }

    console.log('🎯 NEXT STEPS:');
    console.log('1. ✅ Tokens đã được xóa hoàn toàn');
    console.log('2. ⏰ CHỜ 10-15 PHÚT để Atlassian apply scopes (nếu vừa save)');
    console.log('3. 📢 Thông báo users reconnect Jira:');
    console.log('   - Frontend: Click "Connect Jira"');
    console.log('   - API: GET /api/integrations/jira/connect');
    console.log('4. 📸 VERIFY consent screen hiển thị đầy đủ permissions:');
    console.log('   - View and manage Jira projects ⭐');
    console.log('   - View and manage issues');
    console.log('   - View users');
    console.log('   - Access data offline');
    console.log('5. ✅ User accept → Test lại → Should work!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    rl.close();
    await mongoose.disconnect();
    console.log('✅ Disconnected from database\n');
  }
}

clearJiraTokens();
