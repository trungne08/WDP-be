const crypto = require('crypto');

// Lấy encryption key từ env (phải là 32 bytes = 64 hex characters cho AES-256)
let ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 64) {
  console.warn('⚠️ ENCRYPTION_KEY không được set hoặc không đủ 64 ký tự. Đang tạo key tạm thời (KHÔNG AN TOÀN cho production!)');
  ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️ Vui lòng set ENCRYPTION_KEY trong .env (64 hex characters)');
}

// Đảm bảo key đúng 32 bytes (64 hex characters)
if (ENCRYPTION_KEY.length > 64) {
  ENCRYPTION_KEY = ENCRYPTION_KEY.slice(0, 64);
} else if (ENCRYPTION_KEY.length < 64) {
  // Pad với 0 nếu thiếu
  ENCRYPTION_KEY = ENCRYPTION_KEY.padEnd(64, '0');
}

const ALGORITHM = 'aes-256-gcm';

/**
 * Mã hóa một chuỗi (dùng cho token Jira/GitHub)
 * @param {string} text - Text cần mã hóa
 * @returns {string} - Encrypted text (format: iv:authTag:encryptedData)
 */
function encrypt(text) {
  if (!text) return null;
  
  try {
    // Tạo IV (Initialization Vector) ngẫu nhiên
    const iv = crypto.randomBytes(16);
    
    // Convert hex string key thành Buffer (32 bytes)
    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    
    // Tạo cipher
    const cipher = crypto.createCipheriv(
      ALGORITHM,
      keyBuffer,
      iv
    );
    
    // Mã hóa
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Lấy auth tag (để verify khi giải mã)
    const authTag = cipher.getAuthTag();
    
    // Trả về format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('❌ Encryption Error:', error.message);
    throw new Error('Không thể mã hóa dữ liệu');
  }
}

/**
 * Giải mã một chuỗi đã được mã hóa
 * @param {string} encryptedText - Encrypted text (format: iv:authTag:encryptedData)
 * @returns {string} - Decrypted text
 */
function decrypt(encryptedText) {
  if (!encryptedText) return null;
  
  try {
    // Parse format: iv:authTag:encryptedData
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      // Nếu không đúng format, có thể là plaintext (backward compatibility)
      console.warn('⚠️ Encrypted text không đúng format, trả về nguyên bản (có thể là plaintext cũ)');
      return encryptedText;
    }
    
    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    // Convert hex string key thành Buffer (32 bytes)
    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    
    // Tạo decipher
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      keyBuffer,
      iv
    );
    
    // Set auth tag để verify
    decipher.setAuthTag(authTag);
    
    // Giải mã
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('❌ Decryption Error:', error.message);
    // Nếu giải mã thất bại, có thể là plaintext cũ → trả về nguyên bản
    console.warn('⚠️ Không thể giải mã, trả về nguyên bản (có thể là plaintext cũ)');
    return encryptedText;
  }
}

/**
 * Mã hóa object integrations (chỉ mã hóa accessToken và refreshToken)
 * @param {object} integrations - Object integrations
 * @returns {object} - Object với token đã được mã hóa
 */
function encryptIntegrations(integrations) {
  if (!integrations) return integrations;
  
  const encrypted = { ...integrations };
  
  // Mã hóa GitHub token
  if (encrypted.github?.accessToken) {
    encrypted.github = {
      ...encrypted.github,
      accessToken: encrypt(encrypted.github.accessToken)
    };
  }
  
  // Mã hóa Jira tokens
  if (encrypted.jira) {
    encrypted.jira = { ...encrypted.jira };
    if (encrypted.jira.accessToken) {
      encrypted.jira.accessToken = encrypt(encrypted.jira.accessToken);
    }
    if (encrypted.jira.refreshToken) {
      encrypted.jira.refreshToken = encrypt(encrypted.jira.refreshToken);
    }
  }
  
  return encrypted;
}

/**
 * Giải mã object integrations (chỉ giải mã accessToken và refreshToken)
 * @param {object} integrations - Object integrations đã mã hóa
 * @returns {object} - Object với token đã được giải mã
 */
function decryptIntegrations(integrations) {
  if (!integrations) return integrations;
  
  const decrypted = { ...integrations };
  
  // Giải mã GitHub token
  if (decrypted.github?.accessToken) {
    decrypted.github = {
      ...decrypted.github,
      accessToken: decrypt(decrypted.github.accessToken)
    };
  }
  
  // Giải mã Jira tokens
  if (decrypted.jira) {
    decrypted.jira = { ...decrypted.jira };
    if (decrypted.jira.accessToken) {
      decrypted.jira.accessToken = decrypt(decrypted.jira.accessToken);
    }
    if (decrypted.jira.refreshToken) {
      decrypted.jira.refreshToken = decrypt(decrypted.jira.refreshToken);
    }
  }
  
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
  encryptIntegrations,
  decryptIntegrations
};
