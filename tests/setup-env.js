const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jest-test-secret';
process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS = '20000';

// 测试助手会启动独立端口的 mongod；这里提前找到本机二进制，便于覆盖。
const candidates = [
  process.env.MONGOD_BINARY,
  'D:\\Program Files\\MongoDB\\Server\\9.0\\bin\\mongod.exe',
  'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
  'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe',
  'C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe',
  '/usr/bin/mongod',
  '/usr/local/bin/mongod'
].filter(Boolean);

const systemBinary = candidates.find((candidate) => {
  try {
    return fs.existsSync(path.resolve(candidate));
  } catch {
    return false;
  }
});

if (systemBinary && !process.env.MONGOD_BINARY) {
  process.env.MONGOD_BINARY = systemBinary;
}
