const crypto = require('crypto');

function generateShareCode() {
  // 48 bit 随机数，URL 安全且便于复制；唯一索引兜底。
  return crypto.randomBytes(6).toString('hex');
}

function publicUrl(req, shareCode) {
  return `${req.protocol}://${req.get('host')}/survey/${shareCode}`;
}

module.exports = { generateShareCode, publicUrl };
