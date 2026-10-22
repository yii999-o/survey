function apiNotFound(_req, res) {
  res.status(404).json({ error: '接口不存在' });
}

function errorHandler(err, _req, res, _next) {
  // 4xx 是客户端错误（校验失败、无权限等），不打印完整堆栈污染日志。
  if (!err || !err.status || err.status >= 500) {
    console.error('[ERR]', err);
  }

  if (err && err.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((e) => e.message);
    return res.status(400).json({ error: details[0] || '数据校验失败', details });
  }

  if (err && err.name === 'CastError') {
    return res.status(400).json({ error: `参数格式错误：${err.path}` });
  }

  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || '字段';
    return res.status(409).json({ error: `${field} 已存在，请更换后重试` });
  }

  if (err && err.status) {
    const payload = { error: err.message };
    if (Array.isArray(err.details) && err.details.length > 0) payload.details = err.details;
    else if (err.details) payload.details = err.details;
    return res.status(err.status).json(payload);
  }

  return res.status(500).json({ error: '服务器内部错误' });
}

module.exports = { apiNotFound, errorHandler };
