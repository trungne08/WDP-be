/**
 * Role Helper - Phân loại Role dựa trên Email
 * 
 * Logic:
 * - @fe.edu.vn -> LECTURER
 * - @fpt.edu.vn:
 *   - Username bắt đầu bằng mã ngành (SE, SS, SA, IA, GD, AI...) + 5-6 chữ số -> STUDENT
 *   - Ngược lại -> LECTURER
 * - Các domain khác (Gmail...) -> STUDENT (mặc định)
 */

/**
 * Phân loại Role từ email
 * @param {string} email - Email cần phân loại
 * @returns {string} - 'STUDENT', 'LECTURER', hoặc 'ADMIN'
 */
function getRoleFromEmail(email) {
  if (!email || typeof email !== 'string') {
    console.warn('⚠️ Email không hợp lệ, mặc định trả về STUDENT');
    return 'STUDENT';
  }

  const normalizedEmail = email.toLowerCase().trim();
  const [username, domain] = normalizedEmail.split('@');

  // Case 1: @fe.edu.vn -> LECTURER
  if (domain === 'fe.edu.vn') {
    return 'LECTURER';
  }

  // Case 2: @fpt.edu.vn
  if (domain === 'fpt.edu.vn') {
    // Regex: Tìm mã ngành (SE, SS, SA, IA, GD, AI, IT, CS, etc.) + 5-6 chữ số ở cuối username
    // Ví dụ: hieuthse150392 -> có se150392 ở cuối -> STUDENT
    // Ví dụ: lanntss160111 -> có ss160111 ở cuối -> STUDENT
    // Ví dụ: dungnt2 -> không có pattern -> LECTURER
    const studentPattern = /(se|ss|sa|ia|gd|ai|it|cs|da|ds|cy|ce|ee|me|be|ba|ma|ph|ch|bi|en|ja|ko|vi|ru|fr|sp|th|de|pt|nl|ar|hi|zh|kr|id|ms|bn|ta|te|ml|kn|gu|or|pa|ne|si|my|lo|km|ka|ge|ur|fa|he|tr|pl|uk|ro|sk|hu|bg|hr|sr|sl|mk|sq|et|lv|lt|fi|sv|no|is|ga|cy|mt|eu|ca|gl|oc|co|sc|rm|wa|br|gv|kw)\d{5,6}$/i;
    
    if (studentPattern.test(username)) {
      return 'STUDENT';
    } else {
      // Không match pattern -> LECTURER (VD: dungnt2, thanhnx)
      return 'LECTURER';
    }
  }

  // Case 3: Các domain khác (Gmail, Yahoo, etc.) -> STUDENT (mặc định)
  return 'STUDENT';
}

/**
 * Trích xuất student_code từ email
 * @param {string} email - Email của student
 * @returns {string|null} - Student code (VD: SE150392) hoặc null nếu không phải student email
 */
function extractStudentCodeFromEmail(email) {
  if (!email || typeof email !== 'string') {
    return null;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const [username] = normalizedEmail.split('@');

  // Regex để tách mã ngành và số từ cuối username
  // Ví dụ: hieuthse150392 -> SE150392
  // Pattern: bất kỳ ký tự nào + mã ngành (2 chữ cái) + 5-6 chữ số ở cuối
  const match = username.match(/(se|ss|sa|ia|gd|ai|it|cs|da|ds|cy|ce|ee|me|be|ba|ma|ph|ch|bi|en|ja|ko|vi|ru|fr|sp|th|de|pt|nl|ar|hi|zh|kr|id|ms|bn|ta|te|ml|kn|gu|or|pa|ne|si|my|lo|km|ka|ge|ur|fa|he|tr|pl|uk|ro|cs|sk|hu|bg|hr|sr|sl|mk|sq|et|lv|lt|fi|sv|no|da|is|ga|cy|mt|eu|ca|gl|oc|co|sc|rm|wa|br|gd|gv|kw)(\d{5,6})$/i);
  
  if (match) {
    // match[1] = mã ngành, match[2] = số
    const majorCode = match[1].toUpperCase();
    const numbers = match[2];
    return majorCode + numbers;
  }

  return null;
}

module.exports = {
  getRoleFromEmail,
  extractStudentCodeFromEmail
};
