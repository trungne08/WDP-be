/**
 * Script để force clear TẤT CẢ Jira integrations
 * Dùng khi token bị corrupt do encryption key thay đổi
 * Chạy: node scripts/force-clear-jira-tokens.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function forceClearJiraTokens() {
  try {
    console.log('\n🗑️  FORCE CLEAR ALL JIRA INTEGRATIONS\n');
    console.log('='.repeat(70));
    console.log('⚠️  WARNING: Tất cả users sẽ phải reconnect Jira!\n');

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to database\n');

    const models = require('../models');

    // Process each user type
    const userTypes = [
      { name: 'Student', model: models.Student },
      { name: 'Lecturer', model: models.Lecturer },
      { name: 'Admin', model: models.Admin }
    ];

    let totalCleared = 0;

    for (const { name, model } of userTypes) {
      console.log(`📋 Processing ${name}s...`);
      console.log('-'.repeat(70));

      // Find users with Jira integration
      const usersWithJira = await model.find({
        'integrations.jira': { $exists: true, $ne: null }
      }).select('_id email integrations').lean();

      console.log(`   Found ${usersWithJira.length} ${name}(s) with Jira integration`);

      if (usersWithJira.length === 0) {
        console.log(`   ✅ No ${name}s need clearing\n`);
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
    console.log(`✅ Cleared Jira integrations for ${totalCleared} user(s)`);
    console.log('');
    console.log('Next steps:');
    console.log('1. ✅ ENCRYPTION_KEY đã set trên Render');
    console.log('2. ✅ Backend đã restart với key đúng');
    console.log('3. 🔄 Users reconnect Jira (token mới sẽ được mã hóa đúng)');
    console.log('4. 🧪 Test lại → Should work!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from database\n');
  }
}

forceClearJiraTokens();
