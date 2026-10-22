const jwt = require('jsonwebtoken');
const config = require('../config');

function sign(userId) {
  return jwt.sign({ uid: String(userId) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn
  });
}

function getToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function authRequired(req, res, next) {
  const token = getToken(req);
  if (!token) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  try {
    const payload = verifyToken(token);
    req.userId = payload.uid;
    return next();
  } catch {
    return res.status(401).json({ error: '登录已失效，请重新登录' });
  }
}

/**
 * 可选登录：公开问卷接口需要判断“是否登录”，但不能因为 token 过期
 * 就直接拒绝匿名访问。
 */
function authOptional(req, _res, next) {
  const token = getToken(req);
  if (token) {
    try {
      req.userId = verifyToken(token).uid;
    } catch {
      req.userId = null;
    }
  }
  return next();
}

module.exports = { sign, authRequired, authOptional, getToken };
