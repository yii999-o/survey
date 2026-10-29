const express = require('express');
const mongoose = require('mongoose');
const Survey = require('../models/Survey');
const Response = require('../models/Response');
const Question = require('../models/Question');
const QuestionVersion = require('../models/QuestionVersion');
const QuestionShare = require('../models/QuestionShare');
const { authRequired, authOptional } = require('../middleware/auth');
const { validateSurveyDefinition } = require('../services/validation');
const { computeStats } = require('../services/stats');
const { asyncHandler, httpError } = require('../utils/http');
const { generateShareCode, publicUrl } = require('../utils/share');

const router = express.Router();

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizedTitle(value) {
  if (typeof value !== 'string') throw httpError(400, '问卷标题必须是字符串');
  const title = value.trim();
  if (!title) throw httpError(400, '问卷标题不能为空');
  if (Array.from(title).length > 120) throw httpError(400, '问卷标题最多 120 个字符');
  return title;
}

function normalizedDescription(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw httpError(400, '问卷说明必须是字符串');
  const description = value.trim();
  if (description.length > 2000) throw httpError(400, '问卷说明最多 2000 个字符');
  return description;
}

function parseDeadline(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw httpError(400, '截止时间格式不正确');
  return date;
}

function parseBoolean(value, field) {
  if (typeof value !== 'boolean') throw httpError(400, `${field} 必须是布尔值`);
  return value;
}

/**
 * 只接受白名单字段，避免客户端直接篡改 status/ownerId/shareCode。
 */
function parseMeta(body, base = {}) {
  const source = body || {};
  const title = hasOwn(source, 'title') ? normalizedTitle(source.title) : base.title;
  if (!title) throw httpError(400, '问卷标题不能为空');

  return {
    title,
    description: hasOwn(source, 'description')
      ? normalizedDescription(source.description)
      : (base.description || ''),
    allowAnonymous: hasOwn(source, 'allowAnonymous')
      ? parseBoolean(source.allowAnonymous, 'allowAnonymous')
      : (base.allowAnonymous === true),
    allowMultiple: hasOwn(source, 'allowMultiple')
      ? parseBoolean(source.allowMultiple, 'allowMultiple')
      : (base.allowMultiple !== false),
    deadline: hasOwn(source, 'deadline')
      ? parseDeadline(source.deadline)
      : (base.deadline || null)
  };
}

function validateQuestions(questions, { allowEmpty }) {
  if (!Array.isArray(questions)) throw httpError(400, 'questions 必须是数组');
  const result = validateSurveyDefinition(
    { questions },
    { allowEmptyQuestions: allowEmpty }
  );
  if (!result.ok) {
    const err = httpError(400, result.error || '问卷题目配置不正确');
    err.details = result.errors;
    throw err;
  }
  return result.questions;
}

function plainQuestions(survey) {
  return (survey.questions || []).map((q) => (q.toObject ? q.toObject() : q));
}

/**
 * 第二阶段：解析题目来源。
 * 客户端提交的是内容快照 + 来源 ID；服务端重新确认来源题目和版本可访问，
 * 并把 sourceVersion 固定到版本号。之后题库改版不会改这份快照。
 */
async function resolveQuestionSources(userId, questions) {
  for (const q of questions) {
    if (!q.sourceQuestionId) {
      q.sourceQuestionId = null;
      q.sourceVersionId = null;
      q.sourceVersion = null;
      continue;
    }

    if (!mongoose.isValidObjectId(q.sourceQuestionId)) {
      throw httpError(400, `题目 ${q.qid} 的来源题目格式错误`);
    }
    const source = await Question.findById(q.sourceQuestionId);
    if (!source) throw httpError(400, `题目 ${q.qid} 的来源题目不存在`);
    if (source.type !== q.type) {
      throw httpError(400, `题目 ${q.qid} 的类型与来源题目不一致`);
    }

    const isOwner = String(source.ownerId) === String(userId);
    const shared = isOwner ? null : await QuestionShare.exists({
      questionId: source._id,
      sharedWithUserId: userId
    });
    if (!isOwner && !shared) {
      throw httpError(403, `没有权限使用题目「${source.title}」`);
    }

    let version;
    if (q.sourceVersionId) {
      if (!mongoose.isValidObjectId(q.sourceVersionId)) {
        throw httpError(400, `题目 ${q.qid} 的来源版本格式错误`);
      }
      version = await QuestionVersion.findOne({
        _id: q.sourceVersionId,
        questionId: source._id
      });
    } else if (source.currentVersionId) {
      version = await QuestionVersion.findOne({
        _id: source.currentVersionId,
        questionId: source._id
      });
    }
    if (!version) throw httpError(400, `题目 ${q.qid} 的来源版本不存在`);

    q.sourceQuestionId = source._id;
    q.sourceVersionId = version._id;
    q.sourceVersion = version.version;
  }
  return questions;
}

function ownerJson(req, survey, extra = {}) {
  const obj = survey.toObject ? survey.toObject() : { ...survey };
  return {
    ...obj,
    publicUrl: publicUrl(req, obj.shareCode),
    ...extra
  };
}

async function createWithUniqueCode(data) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await Survey.create({ ...data, shareCode: generateShareCode() });
    } catch (err) {
      const isShareCodeCollision = err && err.code === 11000 &&
        err.keyPattern && err.keyPattern.shareCode;
      if (!isShareCodeCollision) throw err;
    }
  }
  throw httpError(500, '生成问卷链接失败，请重试');
}

router.post('/', authRequired, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const meta = parseMeta(body);
  const questions = hasOwn(body, 'questions')
    ? await resolveQuestionSources(
      req.userId,
      validateQuestions(body.questions, { allowEmpty: true })
    )
    : [];

  const survey = await createWithUniqueCode({
    ownerId: req.userId,
    ...meta,
    status: 'draft',
    questions
  });

  res.status(201).json(ownerJson(req, survey, { responseCount: 0 }));
}));

router.get('/', authRequired, asyncHandler(async (req, res) => {
  const surveys = await Survey.find({ ownerId: req.userId })
    .sort({ createdAt: -1 })
    .select('-questions')
    .lean();

  const ids = surveys.map((s) => s._id);
  const grouped = ids.length === 0 ? [] : await Response.aggregate([
    { $match: { surveyId: { $in: ids } } },
    { $group: { _id: '$surveyId', count: { $sum: 1 } } }
  ]);
  const countBySurvey = new Map(grouped.map((g) => [String(g._id), g.count]));

  res.json(surveys.map((s) => ({
    ...s,
    publicUrl: publicUrl(req, s.shareCode),
    responseCount: countBySurvey.get(String(s._id)) || 0
  })));
}));

/**
 * 公开访问入口：/survey/:code 页面调用此接口。
 * allowAnonymous=false 时，未登录用户只拿到 401，不会暴露题目。
 */
router.get('/by-code/:code', authOptional, asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ shareCode: req.params.code });
  if (!survey) throw httpError(404, '问卷不存在');

  const isOwner = req.userId && String(survey.ownerId) === String(req.userId);

  if (survey.status === 'draft' && !isOwner) throw httpError(403, '问卷尚未发布');
  if (survey.status === 'closed') throw httpError(410, '问卷已关闭');
  if (survey.deadline && new Date() > survey.deadline) {
    throw httpError(410, '问卷已过截止时间');
  }
  if (!survey.allowAnonymous && !req.userId) {
    throw httpError(401, '该问卷要求登录后填写');
  }

  // 只返回填写问卷所需字段，不暴露 ownerId 等内部信息。
  res.json({
    _id: survey._id,
    shareCode: survey.shareCode,
    title: survey.title,
    description: survey.description,
    allowAnonymous: survey.allowAnonymous,
    allowMultiple: survey.allowMultiple,
    status: survey.status,
    deadline: survey.deadline,
    publishedAt: survey.publishedAt,
    questions: plainQuestions(survey),
    serverTime: new Date().toISOString(),
    isOwnerPreview: Boolean(isOwner && survey.status !== 'published')
  });
}));

router.get('/:id', authRequired, asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ _id: req.params.id, ownerId: req.userId });
  if (!survey) throw httpError(404, '问卷不存在或无权访问');
  const responseCount = await Response.countDocuments({ surveyId: survey._id });
  res.json(ownerJson(req, survey, { responseCount }));
}));

router.put('/:id', authRequired, asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ _id: req.params.id, ownerId: req.userId });
  if (!survey) throw httpError(404, '问卷不存在或无权访问');

  const body = req.body || {};
  if (hasOwn(body, 'questions') && survey.status !== 'draft') {
    throw httpError(409, '问卷发布后不能修改题目结构，以免历史答卷与题目不一致');
  }

  const meta = parseMeta(body, survey);
  Object.assign(survey, meta);

  if (hasOwn(body, 'questions')) {
    survey.questions = await resolveQuestionSources(
      req.userId,
      validateQuestions(body.questions, { allowEmpty: true })
    );
  }

  // 发布后的元数据修改允许，但结构修改已被上面拒绝。
  await survey.save();
  const responseCount = await Response.countDocuments({ surveyId: survey._id });
  res.json(ownerJson(req, survey, { responseCount }));
}));

router.delete('/:id', authRequired, asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ _id: req.params.id, ownerId: req.userId });
  if (!survey) throw httpError(404, '问卷不存在或无权访问');
  if (survey.status !== 'draft') throw httpError(409, '只能删除未发布的草稿问卷');

  const hasResponse = await Response.exists({ surveyId: survey._id });
  if (hasResponse) throw httpError(409, '已有答卷，不能删除问卷');

  await survey.deleteOne();
  res.json({ ok: true });
}));

router.post('/:id/publish', authRequired, asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ _id: req.params.id, ownerId: req.userId });
  if (!survey) throw httpError(404, '问卷不存在或无权访问');
  if (survey.status === 'closed') throw httpError(409, '已关闭的问卷不能再发布');

  if (survey.status === 'published') {
    return res.json({
      status: survey.status,
      shareCode: survey.shareCode,
      url: `/survey/${survey.shareCode}`,
      publicUrl: publicUrl(req, survey.shareCode)
    });
  }

  const questions = validateQuestions(plainQuestions(survey), { allowEmpty: false });
  if (survey.deadline && new Date() > survey.deadline) {
    throw httpError(400, '截止时间已过，请先调整截止时间');
  }

  survey.questions = questions;
  survey.status = 'published';
  survey.publishedAt = new Date();
  survey.closedAt = null;
  await survey.save();

  res.json({
    status: survey.status,
    shareCode: survey.shareCode,
    url: `/survey/${survey.shareCode}`,
    publicUrl: publicUrl(req, survey.shareCode)
  });
}));

router.post('/:id/close', authRequired, asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ _id: req.params.id, ownerId: req.userId });
  if (!survey) throw httpError(404, '问卷不存在或无权访问');
  if (survey.status === 'draft') throw httpError(409, '草稿问卷尚未发布，无需关闭');

  if (survey.status !== 'closed') {
    survey.status = 'closed';
    survey.closedAt = new Date();
    await survey.save();
  }

  res.json({ status: survey.status, closedAt: survey.closedAt });
}));

router.get('/:id/stats', authRequired, asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ _id: req.params.id, ownerId: req.userId });
  if (!survey) throw httpError(404, '问卷不存在或无权访问');

  const qid = req.query.qid ? String(req.query.qid) : null;
  if (qid && !survey.questions.some((q) => q.qid === qid)) {
    throw httpError(404, '题目不存在');
  }

  const stats = await computeStats(survey, qid);
  res.json({
    surveyId: survey._id,
    title: survey.title,
    status: survey.status,
    ...stats
  });
}));

module.exports = router;

// 兼容旧版导入方式：方便测试或脚本直接复用元数据逻辑。
module.exports._internal = { parseMeta, validateQuestions, ownerJson };
