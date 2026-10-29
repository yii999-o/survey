/**
 * 第二阶段兼容性迁移（可重复执行）：
 * 1. 为每个用户补默认题库；
 * 2. 为题库来源的问卷题目补齐 sourceVersionId/sourceVersion（旧草稿容错）；
 * 3. 为已有答卷补齐 answers.questionId/questionVersionId，便于跨问卷统计。
 *
 * 第一阶段数据本身不需要删除或重建；新字段都可以为空。
 *
 * 用法：npm run migrate:stage2
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../src/config');
const User = require('../src/models/User');
const Survey = require('../src/models/Survey');
const Response = require('../src/models/Response');
const QuestionVersion = require('../src/models/QuestionVersion');
const { ensureDefaultBank } = require('../src/services/questionLibrary');

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log('[MIGRATE] 已连接', config.mongoUri);

  const users = await User.find({}).select('_id username');
  let banks = 0;
  for (const user of users) {
    await ensureDefaultBank(user._id);
    banks += 1;
  }
  console.log(`[MIGRATE] 默认题库检查完成：${banks} 个用户`);

  const surveys = await Survey.find({ 'questions.sourceQuestionId': { $ne: null } });
  let surveyFixed = 0;
  for (const survey of surveys) {
    let changed = false;
    for (const q of survey.questions) {
      if (!q.sourceQuestionId) continue;
      let version = null;
      if (q.sourceVersionId) {
        version = await QuestionVersion.findOne({
          _id: q.sourceVersionId,
          questionId: q.sourceQuestionId
        });
      }
      if (!version && q.sourceVersion) {
        version = await QuestionVersion.findOne({
          questionId: q.sourceQuestionId,
          version: q.sourceVersion
        });
      }
      if (!version) {
        version = await QuestionVersion.findOne({
          questionId: q.sourceQuestionId
        }).sort({ version: -1 });
      }
      if (version) {
        if (String(q.sourceVersionId || '') !== String(version._id) ||
          q.sourceVersion !== version.version) {
          q.sourceVersionId = version._id;
          q.sourceVersion = version.version;
          changed = true;
        }
      }
    }
    if (changed) {
      await survey.save();
      surveyFixed += 1;
    }
  }
  console.log(`[MIGRATE] 问卷题目来源版本补齐：${surveyFixed} 份问卷`);

  let responseFixed = 0;
  const allSurveys = await Survey.find({ 'questions.sourceQuestionId': { $ne: null } })
    .select('questions')
    .lean();
  for (const survey of allSurveys) {
    const qMap = new Map((survey.questions || []).map((q) => [q.qid, q]));
    const responses = await Response.find({ surveyId: survey._id });
    for (const response of responses) {
      let changed = false;
      response.answers.forEach((answer) => {
        const q = qMap.get(answer.qid);
        if (q && q.sourceQuestionId) {
          if (String(answer.questionId || '') !== String(q.sourceQuestionId)) {
            answer.questionId = q.sourceQuestionId;
            changed = true;
          }
          if (String(answer.questionVersionId || '') !== String(q.sourceVersionId)) {
            answer.questionVersionId = q.sourceVersionId;
            changed = true;
          }
        }
      });
      if (changed) {
        await response.save();
        responseFixed += 1;
      }
    }
  }
  console.log(`[MIGRATE] 答卷题目来源补齐：${responseFixed} 份答卷`);
  console.log('[MIGRATE] 完成。旧数据保留，新字段为空时按普通问卷处理。');
}

main()
  .catch((err) => {
    console.error('[MIGRATE] 失败：', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
