const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sign, authRequired } = require('../middleware/auth');
const { asyncHandler, httpError } = require('../utils/http');

const router = express.Router();

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateCredentials(username, password, { registering }) {
  const name = normalizeUsername(username);
  if (!name) throw httpError(400, '用户名不能为空');
  if (Array.from(name).length < 3 || Array.from(name).length > 32) {
    throw httpError(400, '用户名长度需为 3-32 个字符');
  }
  if (!/^[\w\u4e00-\u9fa5.-]+$/.test(name)) {
    throw httpError(400, '用户名只能包含中英文、数字、下划线、点和短横线');
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw httpError(400, '密码至少 6 位');
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw httpError(400, '密码过长（UTF-8 编码后最多 72 字节）');
  }
  if (registering && password.length > 128) {
    throw httpError(400, '密码过长');
  }
}

router.post('/register', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  validateCredentials(username, password, { registering: true });
  const name = normalizeUsername(username);

  const exists = await User.findOne({ username: name });
  if (exists) throw httpError(409, '用户名已存在');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ username: name, passwordHash });

  res.status(201).json({
    token: sign(user._id),
    user: { id: user._id, username: user.username, createdAt: user.createdAt }
  });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const name = normalizeUsername(username);
  if (!name || typeof password !== 'string' || !password) {
    throw httpError(400, '请输入用户名和密码');
  }

  const user = await User.findOne({ username: name });
  if (!user) throw httpError(401, '用户名或密码错误');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw httpError(401, '用户名或密码错误');

  res.json({
    token: sign(user._id),
    user: { id: user._id, username: user.username, createdAt: user.createdAt }
  });
}));

router.get('/me', authRequired, asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId).select('username createdAt');
  if (!user) throw httpError(401, '用户不存在');
  res.json({ user: { id: user._id, username: user.username, createdAt: user.createdAt } });
}));

module.exports = router;
