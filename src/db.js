const mongoose = require('mongoose');
const config = require('./config');

async function connect(uri) {
  const target = uri || config.mongoUri;
  mongoose.set('strictQuery', true);
  await mongoose.connect(target, {
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
  });
  console.log('[DB] MongoDB connected:', target);
  return mongoose.connection;
}

async function disconnect() {
  await mongoose.disconnect();
}

module.exports = { connect, disconnect };
