/**
 * Script để kiểm tra scopes của Jira token hiện tại
 * Chạy: node scripts/check-jira-scopes.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');

async function checkJiraScopes() {
  try {
    console.log('🔍 Checking Jira token scopes...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Load models
    const Student = require('../models/Student');
    const Lecturer = require('../models/Lecturer');
    const Admin = require('../models/Admin');
    
    // Prompt for email
    const email = process.argv[2];
    if (!email) {
      console.error('❌ Usage: node scripts/check-jira-scopes.js <email>');
      console.error('   Example: node scripts/check-jira-scopes.js user@fpt.edu.vn');
      process.exit(1);
    }

    // Find user (check all 3 collections)
    let user = await Student.findOne({ email });
    let userType = 'Student';
    
    if (!user) {
      user = await Lecturer.findOne({ email });
      userType = 'Lecturer';
    }
    
    if (!user) {
      user = await Admin.findOne({ email });
      userType = 'Admin';
    }
    
    if (!user) {
      console.error(`❌ User not found: ${email}`);
      console.error('   Đã tìm trong: Student, Lecturer, Admin collections');
      process.exit(1);
    }
    
    console.log(`   Type: ${userType}`);

    console.log(`👤 User: ${user.full_name} (${user.email})`);

    // Check Jira integration
    const jira = user.integrations?.jira;
    if (!jira) {
      console.error('❌ User chưa kết nối Jira!');
      console.log('\n💡 Giải pháp: Gọi API /api/integrations/jira/connect');
      process.exit(1);
    }

    console.log('\n📦 Jira Integration Info:');
    console.log('   - Account ID:', jira.jiraAccountId);
    console.log('   - Cloud ID:', jira.cloudId);
    console.log('   - Jira URL:', jira.jiraUrl);
    console.log('   - Linked at:', jira.linkedAt);
    console.log('   - Has accessToken?', !!jira.accessToken);
    console.log('   - Has refreshToken?', !!jira.refreshToken);

    // Test token với Jira API
    console.log('\n🧪 Testing token with Jira API...\n');

    const cloudId = jira.cloudId;
    const accessToken = jira.accessToken;

    // Test 1: Get current user (scope: read:me)
    console.log('Test 1: GET /me (scope: read:me)');
    try {
      const res1 = await axios.get('https://api.atlassian.com/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      console.log('   ✅ Success:', res1.data.email);
    } catch (err) {
      console.log('   ❌ Failed:', err.response?.status, err.response?.data?.message || err.message);
    }

    // Test 2: Get projects (scope: read:project:jira)
    console.log('\nTest 2: GET /project/search (scope: read:project:jira)');
    try {
      const res2 = await axios.get(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search`,
        {
          headers: { 
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json'
          },
          params: { maxResults: 5 }
        }
      );
      console.log('   ✅ Success:', res2.data.values?.length, 'project(s)');
      res2.data.values?.forEach(p => {
        console.log(`      - ${p.key}: ${p.name}`);
      });
    } catch (err) {
      console.log('   ❌ Failed:', err.response?.status, err.response?.data?.message || err.message);
      
      if (err.response?.status === 401) {
        console.log('\n⚠️  LỖI 401: Token không có scope "read:project:jira" hoặc đã hết hạn!');
      }
    }

    // Test 3: Search issues (scope: read:issue:jira)
    console.log('\nTest 3: POST /search (scope: read:issue:jira)');
    try {
      const res3 = await axios.post(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search`,
        { jql: '', maxResults: 1 },
        {
          headers: { 
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('   ✅ Success:', res3.data.total, 'issue(s) found');
    } catch (err) {
      console.log('   ❌ Failed:', err.response?.status, err.response?.data?.message || err.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('📋 SUMMARY:');
    console.log('='.repeat(60));
    console.log('Nếu tất cả tests đều ✅ → Token OK!');
    console.log('Nếu có ❌ (401) → Token thiếu scopes hoặc hết hạn!');
    console.log('\n💡 Giải pháp:');
    console.log('   1. Disconnect: DELETE /api/integrations/jira/disconnect');
    console.log('   2. Update permissions trên Atlassian Console');
    console.log('   3. Connect lại: GET /api/integrations/jira/connect');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkJiraScopes();
