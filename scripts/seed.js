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
const Question = require('../src/models/Question');
const QuestionVersion = require('../src/models/QuestionVersion');
const {
  ensureDefaultBank,
  createQuestionWithV1,
  appendVersion,
  pickContent
} = require('../src/services/questionLibrary');

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

function bankContent(type, title, extra = {}) {
  return {
    type,
    title,
    options: [],
    minSelect: null,
    maxSelect: null,
    minLength: null,
    maxLength: null,
    min: null,
    max: null,
    integerOnly: false,
    ...extra
  };
}

function bankSnapshot(question, version, qid, required = true, order = 0) {
  return {
    qid,
    ...pickContent(version),
    required,
    order,
    jumps: [],
    sourceQuestionId: question._id,
    sourceVersionId: version._id,
    sourceVersion: version.version
  };
}

async function ensureBankQuestion({ ownerId, bankId, title, v1Content, v2Content }) {
  const safeTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let question = await Question.findOne({
    ownerId,
    title: { $regex: '^' + safeTitle }
  });
  let v1 = null;
  let v2 = null;

  if (!question) {
    const created = await createQuestionWithV1({
      ownerId,
      bankId,
      content: v1Content,
      changeNote: '演示题库：创建 v1'
    });
    question = created.question;
    v1 = created.version;
    if (v2Content) {
      v2 = await appendVersion({
        question,
        content: v2Content,
        note: '演示题库：生成 v2',
        parentVersionId: v1._id,
        createdBy: ownerId
      });
    } else {
      v2 = v1;
    }
  } else {
    v1 = await QuestionVersion.findOne({ questionId: question._id, version: 1 });
    v2 = await QuestionVersion.findOne({ questionId: question._id, version: 2 });
    if (!v2 && v2Content) {
      const current = await QuestionVersion.findOne({
        _id: question.currentVersionId,
        questionId: question._id
      });
      v2 = await appendVersion({
        question,
        content: v2Content,
        note: '演示题库：生成 v2',
        parentVersionId: current ? current._id : null,
        createdBy: ownerId
      });
    }
    if (!v2) v2 = v1;
  }

  return { question, v1, v2 };
}

async function ensureDemoSurvey({ ownerId, title, shareCode, questions }) {
  let survey = await Survey.findOne({ ownerId, title });
  if (!survey) {
    survey = await Survey.create({
      ownerId,
      title,
      description: '题库复用演示：同一道题的不同版本被不同问卷引用。',
      allowAnonymous: true,
      allowMultiple: true,
      status: 'published',
      shareCode,
      questions,
      publishedAt: new Date()
    });
    console.log('[SEED] 创建题库演示问卷：' + title);
  }
  return survey;
}

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

  // ---------- 第二阶段：题目库/版本/跨问卷统计演示 ----------
  const bank = await ensureDefaultBank(user._id);
  const age = await ensureBankQuestion({
    ownerId: user._id,
    bankId: bank._id,
    title: '你的年龄段',
    v1Content: bankContent('single', '你的年龄段', {
      options: [
        { key: 'A', label: '18 岁以下' },
        { key: 'B', label: '18-25 岁' },
        { key: 'C', label: '26-35 岁' },
        { key: 'D', label: '36 岁以上' }
      ]
    }),
    v2Content: bankContent('single', '你的年龄段（细分）', {
      options: [
        { key: 'A', label: '18 岁以下' },
        { key: 'B', label: '18-25 岁' },
        { key: 'C', label: '26-35 岁' },
        { key: 'D', label: '36-45 岁' },
        { key: 'E', label: '46 岁以上' }
      ]
    })
  });
  const frequency = await ensureBankQuestion({
    ownerId: user._id,
    bankId: bank._id,
    title: '你使用问卷系统的频率',
    v1Content: bankContent('single', '你使用问卷系统的频率', {
      options: [
        { key: 'A', label: '几乎每天' },
        { key: 'B', label: '每周几次' },
        { key: 'C', label: '偶尔使用' }
      ]
    })
  });

  const libSurveyA = await ensureDemoSurvey({
    ownerId: user._id,
    title: '题库复用演示 A（年龄 v1）',
    shareCode: 'demolib00001',
    questions: [
      bankSnapshot(age.question, age.v1, 'q1', true, 0),
      bankSnapshot(frequency.question, frequency.v1, 'q2', true, 1)
    ]
  });
  const libSurveyB = await ensureDemoSurvey({
    ownerId: user._id,
    title: '题库复用演示 B（年龄 v2）',
    shareCode: 'demolib00002',
    questions: [
      bankSnapshot(age.question, age.v2, 'q1', true, 0)
    ]
  });

  if (await Response.countDocuments({ surveyId: libSurveyA._id }) === 0) {
    await Response.create([
      {
        surveyId: libSurveyA._id,
        answers: [
          {
            qid: 'q1', value: 'A',
            questionId: age.question._id, questionVersionId: age.v1._id
          },
          {
            qid: 'q2', value: 'A',
            questionId: frequency.question._id, questionVersionId: frequency.v1._id
          }
        ],
        visitedPath: ['q1', 'q2']
      },
      {
        surveyId: libSurveyA._id,
        answers: [
          {
            qid: 'q1', value: 'B',
            questionId: age.question._id, questionVersionId: age.v1._id
          },
          {
            qid: 'q2', value: 'B',
            questionId: frequency.question._id, questionVersionId: frequency.v1._id
          }
        ],
        visitedPath: ['q1', 'q2']
      }
    ]);
  }

  if (await Response.countDocuments({ surveyId: libSurveyB._id }) === 0) {
    await Response.create([
      {
        surveyId: libSurveyB._id,
        answers: [
          {
            qid: 'q1', value: 'C',
            questionId: age.question._id, questionVersionId: age.v2._id
          }
        ],
        visitedPath: ['q1']
      },
      {
        surveyId: libSurveyB._id,
        answers: [
          {
            qid: 'q1', value: 'D',
            questionId: age.question._id, questionVersionId: age.v2._id
          }
        ],
        visitedPath: ['q1']
      }
    ]);
  }

  console.log('\n[SEED] 演示账号：demo / demo123');
  console.log('[SEED] 原问卷：' + `http://localhost:${config.port}/survey/${survey.shareCode}`);
  console.log('[SEED] 题库 A：' + `http://localhost:${config.port}/survey/${libSurveyA.shareCode}`);
  console.log('[SEED] 题库 B：' + `http://localhost:${config.port}/survey/${libSurveyB.shareCode}`);
  console.log('[SEED] 登录后在「题目库」查看版本历史与跨问卷统计。');
}

main()
  .catch((err) => {
    console.error('[SEED] 导入失败：', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
