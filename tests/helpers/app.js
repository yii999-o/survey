const request = require('supertest');
const app = require('../../src/app');

async function register(username = 'alice', password = 'secret123') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password });
  if (res.status !== 201) {
    throw new Error(`注册失败：${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

function auth(token) {
  return { Authorization: 'Bearer ' + token };
}

async function createSurvey(token, overrides = {}) {
  const res = await request(app)
    .post('/api/surveys')
    .set(auth(token))
    .send({
      title: '测试问卷',
      description: '用于测试',
      allowAnonymous: true,
      ...overrides
    });
  if (res.status !== 201) {
    throw new Error(`创建问卷失败：${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function updateQuestions(token, surveyId, questions) {
  const res = await request(app)
    .put('/api/surveys/' + surveyId)
    .set(auth(token))
    .send({ questions });
  if (res.status !== 200) {
    throw new Error(`更新题目失败：${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function publish(token, surveyId) {
  const res = await request(app)
    .post(`/api/surveys/${surveyId}/publish`)
    .set(auth(token));
  if (res.status !== 200) {
    throw new Error(`发布失败：${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

module.exports = { app, request, register, auth, createSurvey, updateQuestions, publish };
