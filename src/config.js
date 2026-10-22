const DEFAULT_DEV_SECRET = 'survey-dev-secret-change-me';

const config = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/survey_app',
  jwtSecret: process.env.JWT_SECRET || DEFAULT_DEV_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  isProduction: process.env.NODE_ENV === 'production',
  isUsingDefaultSecret: !process.env.JWT_SECRET
};

if (config.isProduction && config.isUsingDefaultSecret) {
  // 不直接退出，方便课程演示；但必须给出醒目的安全提示。
  console.warn('[SECURITY] 生产环境未设置 JWT_SECRET，正在使用默认密钥。');
}

module.exports = config;
