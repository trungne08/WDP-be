/**
 * Script để test xem Jira token có bị corrupt khi decrypt không
 * Chạy: node scripts/test-jira-token-decrypt.js <email>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { decryptIntegrations } = require('../utils/encryption');

async function testTokenDecrypt() {
  try {
    const email = process.argv[2];
    
    if (!email) {
      console.log('\n❌ Usage: node scripts/test-jira-token-decrypt.js <email>');
      console.log('   Example: node scripts/test-jira-token-decrypt.js user@fpt.edu.vn\n');
      process.exit(1);
    }

    console.log('\n🔍 TESTING JIRA TOKEN DECRYPTION\n');
    console.log('='.repeat(70));

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const models = require('../models');

    // Tìm user
    let user = await models.Student.findOne({ email }).lean();
    let userType = 'Student';
    
    if (!user) {
      user = await models.Lecturer.findOne({ email }).lean();
      userType = 'Lecturer';
    }
    
    if (!user) {
      user = await models.Admin.findOne({ email }).lean();
      userType = 'Admin';
    }

    if (!user) {
      console.log(`❌ User not found: ${email}\n`);
      process.exit(1);
    }

    console.log(`✅ Found ${userType}: ${user.email}\n`);

    // Check integrations
    console.log('📋 Raw integrations from DB:');
    console.log('-'.repeat(70));
    
    if (!user.integrations) {
      console.log('❌ No integrations field found!\n');
      process.exit(1);
    }

    console.log('Integrations structure:', JSON.stringify(user.integrations, null, 2));

    // Check Jira
    console.log('\n📋 Jira Integration:');
    console.log('-'.repeat(70));

    if (!user.integrations.jira) {
      console.log('❌ No Jira integration found!\n');
      process.exit(1);
    }

    const jira = user.integrations.jira;
    console.log('✅ Jira integration exists');
    console.log('   - Account ID:', jira.jiraAccountId || 'N/A');
    console.log('   - Cloud ID:', jira.cloudId || 'N/A');
    console.log('   - Jira URL:', jira.jiraUrl || 'N/A');
    console.log('   - Email:', jira.email || 'N/A');
    console.log('   - Linked at:', jira.linkedAt || 'N/A');
    
    // Check token format
    console.log('\n🔐 Token Analysis:');
    console.log('-'.repeat(70));

    const accessToken = jira.accessToken;
    const refreshToken = jira.refreshToken;

    console.log('Access Token:');
    if (!accessToken) {
      console.log('   ❌ MISSING!');
    } else if (typeof accessToken !== 'string') {
      console.log('   ❌ INVALID TYPE:', typeof accessToken);
    } else if (accessToken.includes(':')) {
      // Encrypted format: iv:authTag:encryptedData
      const parts = accessToken.split(':');
      console.log('   ✅ Encrypted format detected');
      console.log('   - Parts:', parts.length, '(should be 3)');
      console.log('   - IV length:', parts[0]?.length || 0, '(should be 32 hex chars)');
      console.log('   - Auth tag length:', parts[1]?.length || 0, '(should be 32 hex chars)');
      console.log('   - Data length:', parts[2]?.length || 0);
      
      // Try to decrypt
      try {
        const { decrypt } = require('../utils/encryption');
        const decrypted = decrypt(accessToken);
        
        if (!decrypted || decrypted === accessToken) {
          console.log('   ⚠️  Decryption returned original value (may be plaintext or wrong key)');
        } else if (decrypted.startsWith('ey')) {
          // JWT token format
          console.log('   ✅ Decryption successful! Token looks like JWT');
          console.log('   - Decrypted length:', decrypted.length);
          console.log('   - Starts with:', decrypted.substring(0, 20) + '...');
        } else {
          console.log('   ⚠️  Decrypted but format unexpected');
          console.log('   - Length:', decrypted.length);
        }
      } catch (err) {
        console.log('   ❌ Decryption FAILED:', err.message);
      }
    } else if (accessToken.startsWith('ey')) {
      console.log('   ⚠️  Plaintext JWT detected (not encrypted!)');
      console.log('   - Length:', accessToken.length);
    } else {
      console.log('   ⚠️  Unknown format');
      console.log('   - Length:', accessToken.length);
      console.log('   - Preview:', accessToken.substring(0, 50) + '...');
    }

    console.log('\nRefresh Token:');
    if (!refreshToken) {
      console.log('   ⚠️  MISSING! offline_access scope may not be working');
    } else if (typeof refreshToken !== 'string') {
      console.log('   ❌ INVALID TYPE:', typeof refreshToken);
    } else if (refreshToken.includes(':')) {
      console.log('   ✅ Encrypted format detected');
      const parts = refreshToken.split(':');
      console.log('   - Parts:', parts.length);
    } else {
      console.log('   ⚠️  Plaintext or unknown format');
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 SUMMARY');
    console.log('='.repeat(70));

    const issues = [];

    if (!accessToken) {
      issues.push('❌ Access token MISSING');
    }
    
    if (!refreshToken) {
      issues.push('⚠️  Refresh token MISSING (offline_access scope may not be granted)');
    }

    if (!jira.cloudId) {
      issues.push('❌ Cloud ID missing');
    }

    if (issues.length > 0) {
      console.log('\n❌ ISSUES FOUND:');
      issues.forEach(issue => console.log('   ' + issue));
      console.log('\n💡 SOLUTION: User needs to reconnect Jira with proper scopes\n');
    } else {
      console.log('\n✅ Token structure looks OK!\n');
      console.log('If still getting 401 errors, possible causes:');
      console.log('1. Token has wrong scopes (check with API call)');
      console.log('2. ENCRYPTION_KEY different between dev/prod (token decrypt fails)');
      console.log('3. Atlassian scopes not saved properly (wait 5 mins, try again)');
      console.log('4. User reconnected but used old cached auth URL (clear browser cache)\n');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from database\n');
  }
}

testTokenDecrypt();
