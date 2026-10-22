const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

let mongod = null;
let dbDir = null;

function findMongod() {
  const candidates = [
    process.env.MONGOD_BINARY,
    'D:\\Program Files\\MongoDB\\Server\\9.0\\bin\\mongod.exe',
    'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
    'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe',
    'C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe',
    '/usr/bin/mongod',
    '/usr/local/bin/mongod'
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, child, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error('mongod 进程提前退出，退出码 ' + child.exitCode);
    }
    const reachable = await new Promise((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      const done = (value) => {
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(700);
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
    });
    if (reachable) return;
    await delay(200);
  }
  throw new Error('等待 mongod 启动超时（端口 ' + port + '）');
}

async function startTestDb() {
  const binary = findMongod();
  if (!binary) {
    throw new Error('找不到 mongod。请安装 MongoDB，或通过环境变量 MONGOD_BINARY 指定 mongod 路径。');
  }

  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-test-db-'));
  const port = await freePort();
  mongod = spawn(binary, [
    '--dbpath', dbDir,
    '--port', String(port),
    '--bind_ip', '127.0.0.1',
    '--quiet'
  ], {
    stdio: 'ignore',
    windowsHide: true
  });

  await waitForPort(port, mongod);
  const uri = `mongodb://127.0.0.1:${port}/survey_test`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  return uri;
}

async function stopTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  if (mongod && mongod.exitCode === null) {
    mongod.kill();
    await Promise.race([
      new Promise((resolve) => mongod.once('exit', resolve)),
      delay(5000)
    ]);
  }

  if (dbDir) {
    try {
      fs.rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Windows 上 mongod 退出后偶尔还会占用日志文件，测试结束时忽略清理失败。
    }
    dbDir = null;
  }
  mongod = null;
}

async function clearTestDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

module.exports = { startTestDb, stopTestDb, clearTestDb, findMongod };
