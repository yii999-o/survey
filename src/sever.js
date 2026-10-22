/**
 * 兼容旧文件名（sever.js 是早期拼写错误）。
 * 实际入口是 src/server.js；这里仅转发，避免旧脚本引用时静默失败。
 */
console.warn('[DEPRECATED] src/sever.js 已更名为 src/server.js');
require('./server');
