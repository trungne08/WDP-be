/**
 * Script để fix Admin documents có integrations.github/jira = undefined
 * Chạy: node scripts/fix-integrations-undefined.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function fixIntegrationsUndefined() {
  try {
    console.log('\n🔧 FIXING INTEGRATIONS UNDEFINED VALUES\n');
    console.log('='.repeat(70));

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to database\n');

    const models = require('../models');

    // Process each user type
    const userTypes = [
      { name: 'Admin', model: models.Admin },
      { name: 'Lecturer', model: models.Lecturer },
      { name: 'Student', model: models.Student }
    ];

    for (const { name, model } of userTypes) {
      console.log(`\n📋 Processing ${name}...`);
      console.log('-'.repeat(70));

      // Find documents with undefined in integrations
      // MongoDB query: integrations.github = undefined HOẶC integrations.jira = undefined
      const docsWithUndefined = await model.find({
        $or: [
          { 'integrations.github': { $type: 6 } }, // Type 6 = undefined in MongoDB
          { 'integrations.jira': { $type: 6 } }
        ]
      }).select('_id email integrations').lean();

      console.log(`   Found ${docsWithUndefined.length} ${name}(s) with undefined values`);

      if (docsWithUndefined.length === 0) {
        console.log(`   ✅ No ${name}s need fixing`);
        continue;
      }

      // Fix each document
      let fixed = 0;
      for (const doc of docsWithUndefined) {
        try {
          const updates = {};

          // Check và unset các field undefined
          if (doc.integrations) {
            if (doc.integrations.github === undefined) {
              updates['$unset'] = updates['$unset'] || {};
              updates['$unset']['integrations.github'] = '';
              console.log(`   🔧 ${name} ${doc.email}: Removing undefined integrations.github`);
            }
            
            if (doc.integrations.jira === undefined) {
              updates['$unset'] = updates['$unset'] || {};
              updates['$unset']['integrations.jira'] = '';
              console.log(`   🔧 ${name} ${doc.email}: Removing undefined integrations.jira`);
            }
          }

          if (Object.keys(updates).length > 0) {
            await model.updateOne({ _id: doc._id }, updates);
            fixed++;
          }
        } catch (err) {
          console.error(`   ❌ Error fixing ${name} ${doc.email}:`, err.message);
        }
      }

      console.log(`   ✅ Fixed ${fixed}/${docsWithUndefined.length} ${name}(s)`);
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 SUMMARY');
    console.log('='.repeat(70));
    console.log('✅ Database cleanup completed!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Restart your backend server');
    console.log('2. Test FCM token update (should not have CastError anymore)');
    console.log('3. If still errors, check server logs for other issues\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from database\n');
  }
}

// Run
fixIntegrationsUndefined();
