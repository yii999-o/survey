const {
  app, request, register, auth, createSurvey, publish
} = require('./helpers/app');
const { startTestDb, stopTestDb, clearTestDb } = require('./helpers/db');

beforeAll(startTestDb);
afterAll(stopTestDb);

beforeEach(clearTestDb);

async function createQuestion(token, overrides = {}) {
  const res = await request(app)
    .post('/api/questions')
    .set(auth(token))
    .send({
      title: '你的年龄',
      type: 'number',
      min: 0,
      max: 120,
      integerOnly: true,
      ...overrides
    });
  if (res.status !== 201) {
    throw new Error(`创建题目失败：${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

function surveyQuestion(detail, overrides = {}) {
  const v = detail.version;
  return {
    qid: 'q1',
    type: v.type,
    title: v.title,
    required: false,
    options: v.options,
    minSelect: v.minSelect,
    maxSelect: v.maxSelect,
    minLength: v.minLength,
    maxLength: v.maxLength,
    min: v.min,
    max: v.max,
    integerOnly: v.integerOnly,
    jumps: [],
    sourceQuestionId: detail.question.id,
    sourceVersionId: v.id,
    sourceVersion: v.version,
    ...overrides
  };
}

async function submit(code, answers) {
  return request(app)
    .post('/api/responses/' + code)
    .send({ answers });
}

describe('第二阶段：题目库', () => {
  test('自动创建默认题库并创建题目 v1', async () => {
    const token = await register('libUserA');
    const banks = await request(app).get('/api/banks').set(auth(token));
    expect(banks.status).toBe(200);
    expect(banks.body).toHaveLength(1);
    expect(banks.body[0].isDefault).toBe(true);
    expect(banks.body[0].questionCount).toBe(0);

    const detail = await createQuestion(token);
    expect(detail.question.currentVersion).toBe(1);
    expect(detail.version.version).toBe(1);
    expect(detail.version.title).toBe('你的年龄');
    expect(detail.question.ownerId).toBeTruthy();

    const after = await request(app).get('/api/banks').set(auth(token));
    expect(after.body[0].questionCount).toBe(1);
  });

  test('修改题目会生成新版本，旧版本内容不变', async () => {
    const token = await register('libUserB');
    const detail = await createQuestion(token, { title: '年龄 v1' });
    const id = detail.question.id;

    const updated = await request(app)
      .put('/api/questions/' + id)
      .set(auth(token))
      .send({ title: '年龄 v2', changeNote: '修改标题' });
    expect(updated.status).toBe(200);
    expect(updated.body.question.currentVersion).toBe(2);
    expect(updated.body.createdVersion.version).toBe(2);
    expect(updated.body.createdVersion.parentVersionId).toBe(
      String(detail.version.id)
    );

    const versions = await request(app)
      .get(`/api/questions/${id}/versions`)
      .set(auth(token));
    expect(versions.status).toBe(200);
    expect(versions.body.items).toHaveLength(2);

    const v1 = await request(app)
      .get(`/api/questions/${id}?version=1`)
      .set(auth(token));
    expect(v1.status).toBe(200);
    expect(v1.body.version.title).toBe('年龄 v1');
    expect(v1.body.currentVersion.version).toBe(2);
  });

  test('恢复旧版本会创建新的 v3，并保留恢复来源', async () => {
    const token = await register('libUserC');
    const detail = await createQuestion(token, { title: '标题 v1' });
    const id = detail.question.id;

    await request(app)
      .put('/api/questions/' + id)
      .set(auth(token))
      .send({ title: '标题 v2' });
    const restored = await request(app)
      .post('/api/questions/' + id + '/restore')
      .set(auth(token))
      .send({ version: 1, changeNote: '恢复 v1' });

    expect(restored.status).toBe(201);
    expect(restored.body.question.currentVersion).toBe(3);
    expect(restored.body.restoredVersion.version).toBe(3);
    expect(restored.body.restoredVersion.title).toBe('标题 v1');
    expect(restored.body.restoredVersion.restoredFromVersionId).toBe(
      String(detail.version.id)
    );

    const all = await request(app)
      .get(`/api/questions/${id}/versions`)
      .set(auth(token));
    expect(all.body.items).toHaveLength(3);
  });

  test('题目类型不能在不同版本之间改变', async () => {
    const token = await register('libUserD');
    const detail = await createQuestion(token);
    const res = await request(app)
      .put('/api/questions/' + detail.question.id)
      .set(auth(token))
      .send({ type: 'text', title: '改成文本' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('类型不能');
  });
});

describe('第二阶段：共享与引用快照', () => {
  test('共享给其他用户，对方只能使用/另存，不能修改原题', async () => {
    const owner = await register('shareOwner');
    const userB = await register('shareReceiver');
    const detail = await createQuestion(owner, { title: '可共享的年龄题' });

    const share = await request(app)
      .post(`/api/questions/${detail.question.id}/share`)
      .set(auth(owner))
      .send({ username: 'shareReceiver' });
    expect(share.status).toBe(201);

    const sharedList = await request(app)
      .get('/api/questions?scope=shared')
      .set(auth(userB));
    expect(sharedList.status).toBe(200);
    expect(sharedList.body.items).toHaveLength(1);
    expect(sharedList.body.items[0].isShared).toBe(true);

    const detailB = await request(app)
      .get('/api/questions/' + detail.question.id)
      .set(auth(userB));
    expect(detailB.status).toBe(200);
    expect(detailB.body.permissions.canEdit).toBe(false);

    const editB = await request(app)
      .put('/api/questions/' + detail.question.id)
      .set(auth(userB))
      .send({ title: '不该成功' });
    expect(editB.status).toBe(403);

    const fork = await request(app)
      .post(`/api/questions/${detail.question.id}/fork`)
      .set(auth(userB))
      .send({});
    expect(fork.status).toBe(201);
    expect(fork.body.question.ownerId).toBe(
      (await request(app).get('/api/auth/me').set(auth(userB))).body.user.id
    );
    expect(fork.body.question.forkedFromQuestionId).toBe(String(detail.question.id));
    expect(fork.body.version.version).toBe(1);
    expect(fork.body.version.title).toBe('可共享的年龄题');
  });

  test('问卷保存题目版本快照；题库更新不影响旧问卷', async () => {
    const token = await register('snapshotOwner');
    const detail = await createQuestion(token, { title: '快照 v1' });
    const survey = await createSurvey(token, {
      questions: [surveyQuestion(detail)]
    });

    const before = await request(app)
      .get('/api/surveys/' + survey._id)
      .set(auth(token));
    expect(before.body.questions[0].sourceQuestionId).toBe(String(detail.question.id));
    expect(before.body.questions[0].sourceVersion).toBe(1);
    expect(before.body.questions[0].title).toBe('快照 v1');

    const updated = await request(app)
      .put('/api/questions/' + detail.question.id)
      .set(auth(token))
      .send({ title: '快照 v2' });
    expect(updated.body.question.currentVersion).toBe(2);

    const after = await request(app)
      .get('/api/surveys/' + survey._id)
      .set(auth(token));
    expect(after.body.questions[0].title).toBe('快照 v1');
    expect(after.body.questions[0].sourceVersion).toBe(1);
  });

  test('可以看到题目被哪些问卷使用（所有者）', async () => {
    const token = await register('usageOwner');
    const detail = await createQuestion(token, { title: '使用情况题' });
    const s1 = await createSurvey(token, { questions: [surveyQuestion(detail)] });
    const s2 = await createSurvey(token, { questions: [surveyQuestion(detail, { qid: 'q2' })] });

    const usage = await request(app)
      .get(`/api/questions/${detail.question.id}/usage`)
      .set(auth(token));
    expect(usage.status).toBe(200);
    expect(usage.body.totalSurveys).toBe(2);
    expect(usage.body.items.map((x) => String(x.surveyId)).sort())
      .toEqual([String(s1._id), String(s2._id)].sort());
    expect(usage.body.items.every((x) => x.questionCount === 1)).toBe(true);
  });

  test('共享用户不能查看题目使用情况', async () => {
    const owner = await register('usageOwner2');
    const userB = await register('usageReceiver2');
    const detail = await createQuestion(owner);
    await request(app)
      .post(`/api/questions/${detail.question.id}/share`)
      .set(auth(owner))
      .send({ username: 'usageReceiver2' });

    const res = await request(app)
      .get(`/api/questions/${detail.question.id}/usage`)
      .set(auth(userB));
    expect(res.status).toBe(403);
  });

  test('共享被取消后，旧问卷快照仍可正常读取', async () => {
    const owner = await register('revokeOwner');
    const userB = await register('revokeReceiver');
    const detail = await createQuestion(owner, { title: '撤销共享题' });

    await request(app)
      .post(`/api/questions/${detail.question.id}/share`)
      .set(auth(owner))
      .send({ username: 'revokeReceiver' });

    const surveyB = await createSurvey(userB, {
      questions: [surveyQuestion(detail)]
    });

    await request(app)
      .delete(`/api/questions/${detail.question.id}/shares/${
        (await request(app).get('/api/auth/me').set(auth(userB))).body.user.id
      }`)
      .set(auth(owner));

    const detailAfter = await request(app)
      .get('/api/surveys/' + surveyB._id)
      .set(auth(userB));
    expect(detailAfter.status).toBe(200);
    expect(detailAfter.body.questions[0].title).toBe('撤销共享题');
    expect(detailAfter.body.questions[0].sourceVersion).toBe(1);
  });
});

describe('第二阶段：跨问卷单题统计', () => {
  test('同一道题在两个问卷/两个版本中的总体统计', async () => {
    const token = await register('crossStatsOwner');
    const detail = await createQuestion(token, {
      title: '你是否推荐',
      type: 'single',
      options: [
        { key: 'A', label: '推荐' },
        { key: 'B', label: '不推荐' }
      ]
    });

    const s1 = await createSurvey(token, {
      questions: [surveyQuestion(detail)]
    });
    const p1 = await publish(token, s1._id);
    await submit(p1.shareCode, [{ qid: 'q1', value: 'A' }]);
    await submit(p1.shareCode, [{ qid: 'q1', value: 'B' }]);

    const updated = await request(app)
      .put('/api/questions/' + detail.question.id)
      .set(auth(token))
      .send({
        title: '你是否推荐（新版）',
        options: [
          { key: 'A', label: '非常推荐' },
          { key: 'B', label: '不推荐' },
          { key: 'C', label: '不确定' }
        ]
      });
    expect(updated.status).toBe(200);

    const s2 = await createSurvey(token, {
      questions: [surveyQuestion(updated.body)]
    });
    const p2 = await publish(token, s2._id);
    await submit(p2.shareCode, [{ qid: 'q1', value: 'B' }]);
    await submit(p2.shareCode, [{ qid: 'q1', value: 'C' }]);

    const stats = await request(app)
      .get(`/api/questions/${detail.question.id}/stats`)
      .set(auth(token));
    expect(stats.status).toBe(200);
    expect(stats.body.type).toBe('single');
    expect(stats.body.surveyCount).toBe(2);
    expect(stats.body.versionCount).toBe(2);
    expect(stats.body.totalResponses).toBe(4);
    expect(stats.body.answeredResponses).toBe(4);
    expect(stats.body.counts).toEqual({ A: 1, B: 2, C: 1 });
    expect(stats.body.perVersion).toHaveLength(2);

    const v2 = stats.body.perVersion.find((v) => v.version === 2);
    expect(v2.counts.C).toBe(1);
    expect(v2.counts.B).toBe(1);
    expect(v2.options).toHaveLength(3);

    const v1 = stats.body.perVersion.find((v) => v.version === 1);
    expect(v1.options).toHaveLength(2);
  });

  test('共享用户不能查看跨问卷统计', async () => {
    const owner = await register('crossOwner2');
    const userB = await register('crossReceiver2');
    const detail = await createQuestion(owner);
    await request(app)
      .post(`/api/questions/${detail.question.id}/share`)
      .set(auth(owner))
      .send({ username: 'crossReceiver2' });

    const res = await request(app)
      .get(`/api/questions/${detail.question.id}/stats`)
      .set(auth(userB));
    expect(res.status).toBe(403);
  });
});
