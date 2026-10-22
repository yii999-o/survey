require('dotenv').config();

const { connect, disconnect } = require('./db');
const app = require('./app');
const config = require('./config');

let server;

async function start() {
  await connect();
  server = app.listen(config.port, () => {
    console.log(`[APP] http://localhost:${config.port}`);
  });
}

async function shutdown(signal) {
  console.log(`\n[APP] ${signal} received, shutting down...`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnect();
  process.exit(0);
}

process.on('SIGINT', () => { shutdown('SIGINT'); });
process.on('SIGTERM', () => { shutdown('SIGTERM'); });

start().catch((err) => {
  console.error('[APP] 启动失败：', err.message);
  process.exit(1);
});
