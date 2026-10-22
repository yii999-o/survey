/**
 * 导入一份可直接演示的问卷与 3 份答卷。
 * 账号：demo / demo123
 *
 * 用法：npm run seed
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const User = require('../src/models/User');
const Survey = require('../src/models/Survey');
const Response = require('../src/models/Response');

const DEMO_USERNAME = 'demo';
const DEMO_PASSWORD = 'demo123';
const DEMO_SHARE_CODE = 'democode0001';

const questions = [
  {
    qid: 'q1',
    type: 'single',
    title: '你使用过本课程配套的在线问卷系统吗？',
    required: true,
    order: 0,
    options: [
      { key: 'A', label: '使用过' },
      { key: 'B', label: '没有使用过' }
    ],
    jumps: [{ when: { option: 'A' }, goto: 'q3' }, { when: { option: 'B' }, goto: 'q2' }]
  },
  {
    qid: 'q2',
    type: 'text',
    title: '你希望系统增加什么功能？',
    required: false,
    order: 1,
    minLength: 2,
    maxLength: 200
  },
  {
    qid: 'q3',
    type: 'multi',
    title: '你最喜欢哪些题型？',
    required: true,
    order: 2,
    options: [
      { key: 'A', label: '单选题' },
      { key: 'B', label: '多选题' },
      { key: 'C', label: '文本填空' },
      { key: 'D', label: '数字填空' }
    ],
    minSelect: 1,
    maxSelect: 3
  },
  {
    qid: 'q4',
    type: 'number',
    title: '请给系统打分（0-10 的整数）',
    required: true,
    order: 3,
    min: 0,
    max: 10,
    integerOnly: true
  },
  {
    qid: 'q5',
    type: 'text',
    title: '其他建议',
    required: false,
    order: 4,
    maxLength: 200
  }
];

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log('[SEED] 已连接', config.mongoUri);

  let user = await User.findOne({ username: DEMO_USERNAME });
  if (!user) {
    user = await User.create({
      username: DEMO_USERNAME,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10)
    });
    console.log('[SEED] 创建演示用户 demo / demo123');
  } else {
    console.log('[SEED] 演示用户已存在，跳过创建');
  }

  let survey = await Survey.findOne({ ownerId: user._id, title: '课程问卷系统演示' });
  if (!survey) {
    survey = await Survey.create({
      ownerId: user._id,
      title: '课程问卷系统演示',
      description: '这是一份用于演示跳转、校验和统计的问卷。选择「使用过」会跳过第 2 题。',
      allowAnonymous: true,
      allowMultiple: true,
      status: 'published',
      shareCode: DEMO_SHARE_CODE,
      deadline: null,
      questions,
      publishedAt: new Date()
    });
    console.log('[SEED] 创建演示问卷');
  } else if (survey.status === 'draft') {
    survey.status = 'published';
    survey.publishedAt = new Date();
    await survey.save();
  }

  const existingResponses = await Response.countDocuments({ surveyId: survey._id });
  if (existingResponses === 0) {
    await Response.create([
      {
        surveyId: survey._id,
        respondentId: null,
        answers: [
          { qid: 'q1', value: 'A' },
          { qid: 'q3', value: ['A', 'B'] },
          { qid: 'q4', value: 9 },
          { qid: 'q5', value: '页面简洁，统计很清楚。' }
        ],
        visitedPath: ['q1', 'q3', 'q4', 'q5']
      },
      {
        surveyId: survey._id,
        respondentId: null,
        answers: [
          { qid: 'q1', value: 'A' },
          { qid: 'q3', value: ['A'] },
          { qid: 'q4', value: 8 }
        ],
        visitedPath: ['q1', 'q3', 'q4', 'q5']
      },
      {
        surveyId: survey._id,
        respondentId: null,
        answers: [
          { qid: 'q1', value: 'B' },
          { qid: 'q2', value: '希望以后支持文件上传题。' },
          { qid: 'q3', value: ['A', 'C'] },
          { qid: 'q4', value: 7 }
        ],
        visitedPath: ['q1', 'q2', 'q3', 'q4', 'q5']
      }
    ]);
    console.log('[SEED] 写入 3 份演示答卷');
  } else {
    console.log('[SEED] 已存在答卷，跳过写入');
  }

  console.log('\n[SEED] 演示账号：demo / demo123');
  console.log('[SEED] 问卷链接：' + `http://localhost:${config.port}/survey/${survey.shareCode}`);
  console.log('[SEED] 登录后可在「我的问卷」查看统计。');
}

main()
  .catch((err) => {
    console.error('[SEED] 导入失败：', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
