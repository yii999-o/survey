const {
  app, request, register, auth, createSurvey, updateQuestions, publish
} = require('./helpers/app');
const { startTestDb, stopTestDb, clearTestDb } = require('./helpers/db');

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

function branchQuestions() {
  return [
    {
      qid: 'q1', type: 'single', title: '请选择入口', required: true,
      options: [{ key: 'A', label: '直达第 3 题' }, { key: 'B', label: '按顺序' }],
      jumps: [{ when: { option: 'A' }, goto: 'q3' }]
    },
    {
      qid: 'q2', type: 'text', title: '中间必答题', required: true,
      minLength: 2, maxLength: 20
    },
    {
      qid: 'q3', type: 'number', title: '年龄', required: true,
      min: 0, max: 120, integerOnly: true
    },
    {
      qid: 'q4', type: 'multi', title: '水果', required: false,
      options: [
        { key: 'A', label: '苹果' }, { key: 'B', label: '香蕉' },
        { key: 'C', label: '西瓜' }, { key: 'D', label: '葡萄' }
      ],
      minSelect: 2, maxSelect: 3
    },
    {
      qid: 'q5', type: 'text', title: '备注', required: false, maxLength: 5
    }
  ];
}

async function setupSurvey(overrides = {}) {
  const token = await register('respondentOwner');
  const survey = await createSurvey(token, { allowAnonymous: true, ...overrides });
  await updateQuestions(token, survey._id, branchQuestions());
  const published = await publish(token, survey._id);
  return { token, survey, shareCode: published.shareCode };
}

function submit(shareCode, answers, token) {
  const req = request(app).post('/api/responses/' + shareCode);
  if (token) req.set(auth(token));
  return req.send({ answers });
}

describe('答卷提交', () => {
  test('匿名提交成功并保存实际路径', async () => {
    const { token, survey, shareCode } = await setupSurvey();
    const res = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: '25' },
      { qid: 'q4', value: ['A', 'B'] },
      { qid: 'q5', value: 'ok' }
    ]);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.responseId).toBeTruthy();

    const list = await request(app)
      .get('/api/responses/survey/' + survey._id)
      .set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].visitedPath).toEqual(['q1', 'q3', 'q4', 'q5']);
    expect(list.body.items[0].respondentId).toBeNull();
  });

  test('跳过的必答题不要求作答', async () => {
    const { shareCode } = await setupSurvey();
    const res = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: 20 }
    ]);
    expect(res.status).toBe(201);
  });

  test('走普通路径时中间必答题缺失返回 400', async () => {
    const { shareCode } = await setupSurvey();
    const res = await submit(shareCode, [
      { qid: 'q1', value: 'B' },
      { qid: 'q3', value: 20 }
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('中间必答题');
  });

  test('提交被跳过的题目答案会被拒绝', async () => {
    const { shareCode } = await setupSurvey();
    const res = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q2', value: '偷偷作答' }
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('已被跳转跳过');
  });

  test('数字题整数和范围校验', async () => {
    const { shareCode } = await setupSurvey();
    const decimal = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: 20.5 }
    ]);
    expect(decimal.status).toBe(400);
    expect(decimal.body.error).toContain('整数');

    const tooLarge = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: 130 }
    ]);
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error).toContain('不能大于');
  });

  test('多选题数量限制生效', async () => {
    const { shareCode } = await setupSurvey();
    const tooFew = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: 20 },
      { qid: 'q4', value: ['A'] }
    ]);
    expect(tooFew.status).toBe(400);
    expect(tooFew.body.error).toContain('至少选择');

    const tooMany = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: 20 },
      { qid: 'q4', value: ['A', 'B', 'C', 'D'] }
    ]);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toContain('最多选择');
  });

  test('文本长度限制生效', async () => {
    const { shareCode } = await setupSurvey();
    const res = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: 20 },
      { qid: 'q5', value: '太长了超过五个字' }
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('最多 5 个字');
  });

  test('要求登录的问卷匿名提交返回 401', async () => {
    const { shareCode } = await setupSurvey({ allowAnonymous: false });
    const res = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: 20 }
    ]);
    expect(res.status).toBe(401);
  });

  test('登录用户提交时记录 respondentId', async () => {
    const { token: ownerToken, survey, shareCode } = await setupSurvey({ allowAnonymous: false });
    const respondentToken = await register('respondent1');
    const res = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: 20 }
    ], respondentToken);
    expect(res.status).toBe(201);

    const me = await request(app).get('/api/auth/me').set(auth(respondentToken));
    const list = await request(app)
      .get('/api/responses/survey/' + survey._id)
      .set(auth(ownerToken));
    expect(list.status).toBe(200);
    expect(list.body.items[0].respondentId).toBe(me.body.user.id);
  });

  test('allowMultiple=false 时同一账号不能重复提交', async () => {
    const { shareCode } = await setupSurvey({ allowAnonymous: false, allowMultiple: false });
    const respondentToken = await register('respondent2');
    const answers = [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: 20 }
    ];
    const first = await submit(shareCode, answers, respondentToken);
    expect(first.status).toBe(201);
    const second = await submit(shareCode, answers, respondentToken);
    expect(second.status).toBe(409);
    expect(second.body.error).toContain('不允许重复填写');
  });

  test('允许重复填写时可以提交多次', async () => {
    const { shareCode } = await setupSurvey({ allowAnonymous: true, allowMultiple: true });
    const answers = [{ qid: 'q1', value: 'A' }, { qid: 'q3', value: 20 }];
    expect((await submit(shareCode, answers)).status).toBe(201);
    expect((await submit(shareCode, answers)).status).toBe(201);
  });

  test('问卷关闭后不能提交', async () => {
    const { token, survey, shareCode } = await setupSurvey();
    await request(app)
      .post(`/api/surveys/${survey._id}/close`)
      .set(auth(token));
    const res = await submit(shareCode, [
      { qid: 'q1', value: 'A' },
      { qid: 'q3', value: 20 }
    ]);
    expect(res.status).toBe(410);
  });

  test('未发布问卷不能提交', async () => {
    const token = await register('draftOwner');
    const survey = await createSurvey(token, { allowAnonymous: true });
    await updateQuestions(token, survey._id, branchQuestions());
    const res = await submit(survey.shareCode, []);
    expect(res.status).toBe(403);
  });
});
