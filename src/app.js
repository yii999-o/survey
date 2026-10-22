const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { apiNotFound, errorHandler } = require('./middleware/error');

const app = express();
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString()
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/surveys', require('./routes/surveys'));
app.use('/api/responses', require('./routes/responses'));

// 前后端共用的跳转/校验逻辑，浏览器直接加载这一份文件。
app.use('/shared', express.static(path.join(ROOT, 'shared'), {
  maxAge: '1h',
  index: false
}));

app.get('/survey/:code', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'fill.html'));
});

app.get('/s/:code', (req, res) => {
  res.redirect(302, `/survey/${encodeURIComponent(req.params.code)}`);
});

app.get('/', (_req, res) => {
  res.redirect('/dashboard.html');
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  index: 'login.html'
}));

app.use('/api', apiNotFound);
app.use((_req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.use(errorHandler);

module.exports = app;
