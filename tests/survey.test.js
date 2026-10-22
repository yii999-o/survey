const {
  app, request, register, auth, createSurvey, updateQuestions, publish
} = require('./helpers/app');
const { startTestDb, stopTestDb, clearTestDb } = require('./helpers/db');

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

const questions = [
  {
    qid: 'q1', type: 'single', title: '你的性别', required: true,
    options: [{ key: 'A', label: '男' }, { key: 'B', label: '女' }, { key: 'C', label: '其他' }]
  },
  {
    qid: 'q2', type: 'multi', title: '喜欢的水果', required: false,
    options: [{ key: 'A', label: '苹果' }, { key: 'B', label: '香蕉' }, { key: 'C', label: '西瓜' }],
    minSelect: 1, maxSelect: 2
  },
  {
    qid: 'q3', type: 'text', title: '补充说明', required: false,
    minLength: 2, maxLength: 20
  },
  {
    qid: 'q4', type: 'number', title: '年龄', required: false,
    min: 0, max: 120, integerOnly: true
  }
];

describe('问卷创建与管理', () => {
  test('创建问卷返回草稿、分享码和公开链接', async () => {
    const token = await register('owner1');
    const survey = await createSurvey(token, { title: '课程反馈' });

    expect(survey.status).toBe('draft');
    expect(survey.shareCode).toMatch(/^[a-f0-9]{12}$/);
    expect(survey.publicUrl).toContain('/survey/' + survey.shareCode);
    expect(survey.ownerId).toBeTruthy();
  });

  test('添加题目后可以读取完整问卷', async () => {
    const token = await register('owner2');
    const survey = await createSurvey(token);
    const updated = await updateQuestions(token, survey._id, questions);

    expect(updated.questions).toHaveLength(4);
    expect(updated.questions[0].qid).toBe('q1');
    expect(updated.questions[0].order).toBe(0);

    const detail = await request(app)
      .get('/api/surveys/' + survey._id)
      .set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.questions).toHaveLength(4);
    expect(detail.body.responseCount).toBe(0);
  });

  test('我的问卷只包含当前用户创建的问卷', async () => {
    const tokenA = await register('ownerA');
    const tokenB = await register('ownerB');
    await createSurvey(tokenA, { title: 'A 的问卷' });
    await createSurvey(tokenB, { title: 'B 的问卷' });

    const listA = await request(app).get('/api/surveys').set(auth(tokenA));
    expect(listA.status).toBe(200);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].title).toBe('A 的问卷');
  });

  test('不能读取或修改他人的问卷', async () => {
    const tokenA = await register('ownerC');
    const tokenB = await register('ownerD');
    const survey = await createSurvey(tokenA);

    const getRes = await request(app)
      .get('/api/surveys/' + survey._id)
      .set(auth(tokenB));
    expect(getRes.status).toBe(404);

    const putRes = await request(app)
      .put('/api/surveys/' + survey._id)
      .set(auth(tokenB))
      .send({ title: '被篡改' });
    expect(putRes.status).toBe(404);
  });

  test('发布空问卷被拒绝', async () => {
    const token = await register('ownerE');
    const survey = await createSurvey(token);
    const res = await request(app)
      .post(`/api/surveys/${survey._id}/publish`)
      .set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('至少需要一道题目');
  });

  test('发布后生成可访问链接，且题目结构被锁定', async () => {
    const token = await register('ownerF');
    const survey = await createSurvey(token, { allowAnonymous: true });
    await updateQuestions(token, survey._id, questions);
    const result = await publish(token, survey._id);

    expect(result.status).toBe('published');
    expect(result.shareCode).toMatch(/^[a-f0-9]{12}$/);

    const publicRes = await request(app)
      .get('/api/surveys/by-code/' + result.shareCode);
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.title).toBe('测试问卷');
    expect(publicRes.body.allowAnonymous).toBe(true);
    expect(publicRes.body.questions).toHaveLength(4);

    const editRes = await request(app)
      .put('/api/surveys/' + survey._id)
      .set(auth(token))
      .send({ questions });
    expect(editRes.status).toBe(409);
  });

  test('发布后仍可修改标题和说明', async () => {
    const token = await register('ownerG');
    const survey = await createSurvey(token);
    await updateQuestions(token, survey._id, questions);
    await publish(token, survey._id);

    const res = await request(app)
      .put('/api/surveys/' + survey._id)
      .set(auth(token))
      .send({ title: '新标题', description: '新说明' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('新标题');
  });

  test('关闭问卷后公开链接返回 410', async () => {
    const token = await register('ownerH');
    const survey = await createSurvey(token);
    await updateQuestions(token, survey._id, questions);
    const published = await publish(token, survey._id);

    const closeRes = await request(app)
      .post(`/api/surveys/${survey._id}/close`)
      .set(auth(token));
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe('closed');

    const publicRes = await request(app)
      .get('/api/surveys/by-code/' + published.shareCode);
    expect(publicRes.status).toBe(410);
  });

  test('截止时间已过时不能发布', async () => {
    const token = await register('ownerI');
    const survey = await createSurvey(token, {
      deadline: new Date(Date.now() - 60_000).toISOString()
    });
    await updateQuestions(token, survey._id, questions);
    const res = await request(app)
      .post(`/api/surveys/${survey._id}/publish`)
      .set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('截止时间已过');
  });

  test('可以删除未发布的草稿', async () => {
    const token = await register('ownerJ');
    const survey = await createSurvey(token);
    const res = await request(app)
      .delete('/api/surveys/' + survey._id)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const list = await request(app).get('/api/surveys').set(auth(token));
    expect(list.body).toHaveLength(0);
  });

  test('非本人不能查看统计', async () => {
    const tokenA = await register('ownerK');
    const tokenB = await register('ownerL');
    const survey = await createSurvey(tokenA);
    const res = await request(app)
      .get('/api/surveys/' + survey._id + '/stats')
      .set(auth(tokenB));
    expect(res.status).toBe(404);
  });

  test('要求登录的问卷对未登录访问返回 401', async () => {
    const token = await register('ownerM');
    const survey = await createSurvey(token, { allowAnonymous: false });
    await updateQuestions(token, survey._id, questions);
    const published = await publish(token, survey._id);

    const res = await request(app)
      .get('/api/surveys/by-code/' + published.shareCode);
    expect(res.status).toBe(401);
  });

  test('发布者可以预览未发布草稿', async () => {
    const token = await register('ownerN');
    const survey = await createSurvey(token);
    await updateQuestions(token, survey._id, questions);

    const res = await request(app)
      .get('/api/surveys/by-code/' + survey.shareCode)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.isOwnerPreview).toBe(true);
  });
});
