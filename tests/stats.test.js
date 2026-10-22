const {
  app, request, register, auth, createSurvey, updateQuestions, publish
} = require('./helpers/app');
const { startTestDb, stopTestDb, clearTestDb } = require('./helpers/db');

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

let ownerToken;
let survey;
let shareCode;

const questions = [
  {
    qid: 'q1', type: 'single', title: '性别', required: false,
    options: [{ key: 'A', label: '男' }, { key: 'B', label: '女' }]
  },
  {
    qid: 'q2', type: 'multi', title: '水果', required: false,
    options: [
      { key: 'A', label: '苹果' }, { key: 'B', label: '香蕉' }, { key: 'C', label: '西瓜' }
    ]
  },
  { qid: 'q3', type: 'number', title: '年龄', required: false },
  { qid: 'q4', type: 'text', title: '备注', required: false }
];

beforeEach(async () => {
  ownerToken = await register('statsOwner');
  survey = await createSurvey(ownerToken, { allowAnonymous: true });
  await updateQuestions(ownerToken, survey._id, questions);
  const published = await publish(ownerToken, survey._id);
  shareCode = published.shareCode;
});

async function submit(answers) {
  return request(app)
    .post('/api/responses/' + shareCode)
    .send({ answers });
}

async function seedThreeResponses() {
  await submit([
    { qid: 'q1', value: 'A' }, { qid: 'q2', value: ['A'] },
    { qid: 'q3', value: 20 }, { qid: 'q4', value: 'hi' }
  ]);
  await submit([
    { qid: 'q1', value: 'A' }, { qid: 'q2', value: ['A', 'B'] },
    { qid: 'q3', value: 30 }, { qid: 'q4', value: 'yo' }
  ]);
  await submit([
    { qid: 'q1', value: 'B' }, { qid: 'q2', value: ['B'] },
    { qid: 'q3', value: 40 }, { qid: 'q4', value: 'ok' }
  ]);
}

describe('提交与统计', () => {
  test('提交答卷成功并保存', async () => {
    const res = await submit([
      { qid: 'q1', value: 'A' },
      { qid: 'q2', value: ['A', 'B'] },
      { qid: 'q3', value: 20 },
      { qid: 'q4', value: 'hello' }
    ]);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.responseId).toBeTruthy();
  });

  test('非法选项提交被拒绝', async () => {
    const res = await submit([{ qid: 'q1', value: 'Z' }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('选项非法');
  });

  test('单选题、多选题、数字题和文本题统计正确', async () => {
    await seedThreeResponses();

    const res = await request(app)
      .get(`/api/surveys/${survey._id}/stats`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.totalResponses).toBe(3);
    expect(res.body.questions).toHaveLength(4);

    const q1 = res.body.questions.find((q) => q.qid === 'q1');
    expect(q1.counts).toEqual({ A: 2, B: 1 });
    expect(q1.totalAnswers).toBe(3);
    expect(q1.options[0]).toMatchObject({ key: 'A', label: '男', count: 2, percent: 66.67 });

    const q2 = res.body.questions.find((q) => q.qid === 'q2');
    expect(q2.counts).toEqual({ A: 2, B: 2, C: 0 });
    expect(q2.totalAnswers).toBe(3);

    const q3 = res.body.questions.find((q) => q.qid === 'q3');
    expect(q3.average).toBe(30);
    expect(q3.min).toBe(20);
    expect(q3.max).toBe(40);
    expect(q3.values.sort((a, b) => a - b)).toEqual([20, 30, 40]);

    const q4 = res.body.questions.find((q) => q.qid === 'q4');
    expect(q4.values.sort()).toEqual(['hi', 'ok', 'yo']);
  });

  test('按 qid 只返回单题统计', async () => {
    await seedThreeResponses();
    const res = await request(app)
      .get(`/api/surveys/${survey._id}/stats?qid=q1`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].qid).toBe('q1');
    expect(res.body.totalResponses).toBe(3);
  });

  test('不存在的 qid 返回 404', async () => {
    const res = await request(app)
      .get(`/api/surveys/${survey._id}/stats?qid=q999`)
      .set(auth(ownerToken));
    expect(res.status).toBe(404);
  });

  test('没有答卷时统计为空，数字平均值为 null', async () => {
    const res = await request(app)
      .get(`/api/surveys/${survey._id}/stats`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.totalResponses).toBe(0);
    const q3 = res.body.questions.find((q) => q.qid === 'q3');
    expect(q3.average).toBeNull();
    expect(q3.values).toEqual([]);
  });

  test('非本人无法查看统计', async () => {
    const otherToken = await register('statsOther');
    const res = await request(app)
      .get(`/api/surveys/${survey._id}/stats`)
      .set(auth(otherToken));
    expect(res.status).toBe(404);
  });

  test('答卷列表只允许问卷所有者读取', async () => {
    await seedThreeResponses();
    const otherToken = await register('statsOther2');
    const other = await request(app)
      .get('/api/responses/survey/' + survey._id)
      .set(auth(otherToken));
    expect(other.status).toBe(404);

    const owner = await request(app)
      .get('/api/responses/survey/' + survey._id)
      .set(auth(ownerToken));
    expect(owner.status).toBe(200);
    expect(owner.body.total).toBe(3);
    expect(owner.body.items).toHaveLength(3);
  });
});
