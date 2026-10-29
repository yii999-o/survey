const express = require('express');
const Survey = require('../models/Survey');
const Response = require('../models/Response');
const { authOptional, authRequired } = require('../middleware/auth');
const { validateSubmission } = require('../services/validation');
const { asyncHandler, httpError } = require('../utils/http');

const router = express.Router();

router.post('/:code', authOptional, asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ shareCode: req.params.code });
  if (!survey) throw httpError(404, '问卷不存在');

  if (survey.status === 'draft') throw httpError(403, '问卷尚未发布');
  if (survey.status === 'closed') throw httpError(410, '问卷已关闭');
  if (survey.deadline && new Date() > survey.deadline) {
    throw httpError(410, '问卷已过截止时间');
  }
  if (!survey.allowAnonymous && !req.userId) {
    throw httpError(401, '该问卷要求登录后填写');
  }

  const { answers } = req.body || {};
  if (!Array.isArray(answers)) throw httpError(400, 'answers 必须是数组');

  const validated = validateSubmission(survey, answers);
  if (!validated.ok) {
    const err = httpError(400, validated.error || '答案校验失败');
    err.details = validated.path ? { path: validated.path } : undefined;
    throw err;
  }

  if (!survey.allowMultiple && req.userId) {
    const previous = await Response.exists({
      surveyId: survey._id,
      respondentId: req.userId
    });
    if (previous) throw httpError(409, '该问卷不允许重复填写');
  }

  const questionByQid = new Map(
    (survey.questions || []).map((q) => [q.qid, q])
  );
  const enrichedAnswers = validated.answers.map((answer) => {
    const q = questionByQid.get(answer.qid);
    return {
      ...answer,
      questionId: q && q.sourceQuestionId ? q.sourceQuestionId : null,
      questionVersionId: q && q.sourceVersionId ? q.sourceVersionId : null
    };
  });

  const response = await Response.create({
    surveyId: survey._id,
    respondentId: req.userId || null,
    answers: enrichedAnswers,
    visitedPath: validated.path
  });

  res.status(201).json({
    ok: true,
    responseId: response._id,
    submittedAt: response.submittedAt
  });
}));

router.get('/survey/:id', authRequired, asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ _id: req.params.id, ownerId: req.userId });
  if (!survey) throw httpError(404, '问卷不存在或无权访问');

  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const skip = Math.max(Number(req.query.skip) || 0, 0);

  const [total, items] = await Promise.all([
    Response.countDocuments({ surveyId: survey._id }),
    Response.find({ surveyId: survey._id })
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
  ]);

  res.json({ total, skip, limit, items });
}));

module.exports = router;
