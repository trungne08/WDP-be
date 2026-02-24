/**
 * Script để decode và verify Jira token có scopes gì
 * Chạy: node scripts/verify-jira-token-scopes.js <email>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

async function verifyTokenScopes() {
  try {
    const email = process.argv[2];
    
    if (!email) {
      console.log('\n❌ Usage: node scripts/verify-jira-token-scopes.js <email>');
      console.log('   Example: node scripts/verify-jira-token-scopes.js thienhpse172095@fpt.edu.vn\n');
      process.exit(1);
    }

    console.log('\n🔍 VERIFY JIRA TOKEN SCOPES\n');
    console.log('='.repeat(70));

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const models = require('../models');

    // Tìm user
    let user = await models.Student.findOne({ email });
    let userType = 'Student';
    
    if (!user) {
      user = await models.Lecturer.findOne({ email });
      userType = 'Lecturer';
    }
    
    if (!user) {
      user = await models.Admin.findOne({ email });
      userType = 'Admin';
    }

    if (!user) {
      console.log(`❌ User not found: ${email}\n`);
      process.exit(1);
    }

    console.log(`✅ Found ${userType}: ${user.email}`);

    // Check Jira integration
    const jira = user.integrations?.jira;
    
    if (!jira) {
      console.log('❌ User chưa kết nối Jira!\n');
      process.exit(1);
    }

    console.log('✅ Jira integration exists');
    console.log('   - Account ID:', jira.jiraAccountId || 'N/A');
    console.log('   - Cloud ID:', jira.cloudId || 'N/A');
    console.log('   - Jira URL:', jira.jiraUrl || 'N/A');
    console.log('   - Linked at:', jira.linkedAt || 'N/A');
    console.log('   - Has accessToken?', !!jira.accessToken);
    console.log('   - Has refreshToken?', !!jira.refreshToken);

    if (!jira.accessToken || !jira.cloudId) {
      console.log('\n❌ Thiếu accessToken hoặc cloudId!\n');
      process.exit(1);
    }

    // Test token với Jira API
    console.log('\n🧪 TESTING TOKEN WITH JIRA API\n');
    console.log('='.repeat(70));

    const cloudId = jira.cloudId;
    const accessToken = jira.accessToken;

    // Test 1: GET /me
    console.log('\n[Test 1] GET /me (scope: read:me)');
    try {
      const res = await axios.get('https://api.atlassian.com/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000
      });
      console.log('   ✅ SUCCESS:', res.data.email || res.data.name);
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      console.log(`   ❌ FAILED (${status}):`, data?.message || err.message);
      
      if (status === 401) {
        console.log('   ⚠️  Token không hợp lệ hoặc thiếu scope "read:me"');
      }
    }

    // Test 2: GET /project/search
    console.log('\n[Test 2] GET /project/search (scope: read:project:jira)');
    try {
      const res = await axios.get(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search`,
        {
          headers: { 
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json'
          },
          params: { maxResults: 5 },
          timeout: 10000
        }
      );
      console.log(`   ✅ SUCCESS: Found ${res.data.values?.length || 0} projects`);
      if (res.data.values?.length > 0) {
        res.data.values.forEach((p, idx) => {
          console.log(`      ${idx + 1}. ${p.key} - ${p.name}`);
        });
      }
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      console.log(`   ❌ FAILED (${status}):`, data?.message || err.message);
      
      if (status === 401) {
        console.log('   ⚠️  Token THIẾU scope "read:project:jira" ⭐⭐⭐');
        console.log('   💡 Đây chính là nguyên nhân lỗi 401!');
      }
    }

    // Test 3: POST /search (issues)
    console.log('\n[Test 3] POST /search (scope: read:issue:jira)');
    try {
      const res = await axios.post(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search`,
        { jql: '', maxResults: 1 },
        {
          headers: { 
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      console.log(`   ✅ SUCCESS: Found ${res.data.total || 0} issues`);
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      console.log(`   ❌ FAILED (${status}):`, data?.message || err.message);
      
      if (status === 401) {
        console.log('   ⚠️  Token thiếu scope "read:issue:jira"');
      }
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log('Nếu:');
    console.log('✅ Test 1 (GET /me) thành công → Token còn hiệu lực');
    console.log('❌ Test 2 (GET /project) failed 401 → THIẾU scope "read:project:jira"');
    console.log('❌ Test 3 (POST /search) failed 401 → THIẾU scope "read:issue:jira"');
    console.log('');
    console.log('💡 GIẢI PHÁP:');
    console.log('1. Vào Atlassian Console → Permissions → Granular scopes');
    console.log('2. TICK CÁC SCOPES SAU:');
    console.log('   ☑ read:project:jira  ⭐⭐⭐ (QUAN TRỌNG NHẤT!)');
    console.log('   ☑ write:project:jira');
    console.log('   ☑ read:issue:jira');
    console.log('   ☑ write:issue:jira');
    console.log('   ☑ delete:issue:jira');
    console.log('   ☑ read:user:jira');
    console.log('   ☑ read:me (User identity API section)');
    console.log('3. SAVE và chờ 3-5 PHÚT (Atlassian cần thời gian apply)');
    console.log('4. User DISCONNECT Jira');
    console.log('5. User CONNECT lại Jira');
    console.log('6. Test lại script này → All tests should PASS! ✅\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from database\n');
  }
}

verifyTokenScopes();
