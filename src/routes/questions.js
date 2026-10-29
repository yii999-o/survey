const express = require('express');
const mongoose = require('mongoose');
const Question = require('../models/Question');
const QuestionBank = require('../models/QuestionBank');
const QuestionVersion = require('../models/QuestionVersion');
const QuestionShare = require('../models/QuestionShare');
const User = require('../models/User');
const Survey = require('../models/Survey');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, httpError } = require('../utils/http');
const {
  pickContent,
  validateContent,
  normalizeNote,
  ensureDefaultBank,
  getOwnedBank,
  getQuestionAccess,
  currentVersionOf,
  getVersionByNumber,
  createQuestionWithV1,
  appendVersion
} = require('../services/questionLibrary');
const { computeQuestionStats } = require('../services/questionStats');

const router = express.Router();
router.use(authRequired);

function versionJson(version) {
  if (!version) return null;
  return {
    id: version._id,
    version: version.version,
    title: version.title,
    type: version.type,
    options: (version.options || []).map((o) => ({ key: o.key, label: o.label })),
    minSelect: version.minSelect ?? null,
    maxSelect: version.maxSelect ?? null,
    minLength: version.minLength ?? null,
    maxLength: version.maxLength ?? null,
    min: version.min ?? null,
    max: version.max ?? null,
    integerOnly: version.integerOnly === true,
    parentVersionId: version.parentVersionId || null,
    restoredFromVersionId: version.restoredFromVersionId || null,
    changeNote: version.changeNote || '',
    createdAt: version.createdAt,
    createdBy: version.createdBy
  };
}

async function detailFor(question, userId, isOwner, versionDoc = null) {
  const current = versionDoc || await currentVersionOf(question);
  if (!current) throw httpError(500, '题目版本数据缺失');
  const [bank, owner, shareCount] = await Promise.all([
    QuestionBank.findById(question.bankId).select('name description isDefault ownerId'),
    User.findById(question.ownerId).select('username'),
    QuestionShare.countDocuments({ questionId: question._id })
  ]);

  let forkOrigin = null;
  if (question.forkedFromQuestionId) {
    const [originQuestion, originVersion] = await Promise.all([
      Question.findById(question.forkedFromQuestionId).select('title'),
      question.forkedFromVersionId
        ? QuestionVersion.findById(question.forkedFromVersionId).select('version')
        : null
    ]);
    forkOrigin = {
      questionId: question.forkedFromQuestionId,
      title: originQuestion ? originQuestion.title : '(原题已删除)',
      version: originVersion ? originVersion.version : null
    };
  }

  return {
    question: {
      id: question._id,
      ownerId: question.ownerId,
      bankId: question.bankId,
      title: question.title,
      type: question.type,
      currentVersion: question.currentVersion,
      currentVersionId: question.currentVersionId,
      archivedAt: question.archivedAt,
      forkedFromQuestionId: question.forkedFromQuestionId || null,
      forkedFromVersionId: question.forkedFromVersionId || null,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt
    },
    version: versionJson(current),
    currentVersion: versionJson(await currentVersionOf(question)),
    bank: bank ? bank.toObject() : null,
    owner: owner ? { id: owner._id, username: owner.username } : null,
    forkOrigin,
    shareCount,
    permissions: {
      isOwner,
      canUse: true,
      canEdit: isOwner,
      canShare: isOwner
    }
  };
}

function scopeIdsForShared(userId) {
  return QuestionShare.find({ sharedWithUserId: userId }).select('questionId').lean();
}

router.get('/', asyncHandler(async (req, res) => {
  const scope = ['mine', 'shared', 'all'].includes(req.query.scope)
    ? req.query.scope
    : 'mine';
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const conditions = [];

  if (scope === 'mine' || scope === 'all') {
    conditions.push({ ownerId: req.userId, archivedAt: null });
  }
  if (scope === 'shared' || scope === 'all') {
    const shareDocs = await scopeIdsForShared(req.userId);
    const ids = shareDocs.map((s) => s.questionId);
    if (ids.length === 0 && scope === 'shared') return res.json({ items: [], total: 0 });
    conditions.push({ _id: { $in: ids }, archivedAt: null });
  }

  const query = conditions.length === 1 ? conditions[0] : { $or: conditions };
  if (req.query.bankId) {
    if (!mongoose.isValidObjectId(req.query.bankId)) throw httpError(400, 'bankId 格式错误');
    query.bankId = req.query.bankId;
  }
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.title = { $regex: escaped, $options: 'i' };
  }

  const questions = await Question.find(query)
    .sort({ updatedAt: -1 })
    .limit(300)
    .lean();

  if (questions.length === 0) return res.json({ items: [], total: 0 });

  const versionIds = questions.map((q) => q.currentVersionId).filter(Boolean);
  const [versions, banks, owners, usages, shares] = await Promise.all([
    QuestionVersion.find({ _id: { $in: versionIds } }).lean(),
    QuestionBank.find({ _id: { $in: [...new Set(questions.map((q) => String(q.bankId)))] } }).lean(),
    User.find({
      _id: { $in: [...new Set(questions.map((q) => String(q.ownerId)))] }
    }).select('username').lean(),
    Survey.aggregate([
      { $unwind: '$questions' },
      { $match: { 'questions.sourceQuestionId': { $in: questions.map((q) => q._id) } } },
      {
        $group: {
          _id: '$questions.sourceQuestionId',
          surveyIds: { $addToSet: '$_id' }
        }
      },
      { $project: { count: { $size: '$surveyIds' } } }
    ]),
    QuestionShare.find({
      questionId: { $in: questions.map((q) => q._id) },
      sharedWithUserId: req.userId
    }).lean()
  ]);

  const versionById = new Map(versions.map((v) => [String(v._id), v]));
  const bankById = new Map(banks.map((b) => [String(b._id), b]));
  const ownerById = new Map(owners.map((o) => [String(o._id), o]));
  const usageById = new Map(usages.map((u) => [String(u._id), u.count]));
  const sharedIds = new Set(shares.map((s) => String(s.questionId)));

  res.json({
    total: questions.length,
    items: questions.map((q) => {
      const current = versionById.get(String(q.currentVersionId));
      const bank = bankById.get(String(q.bankId));
      const owner = ownerById.get(String(q.ownerId));
      return {
        id: q._id,
        title: q.title,
        type: q.type,
        currentVersion: q.currentVersion,
        version: current ? versionJson(current) : null,
        bank: bank ? { id: bank._id, name: bank.name, isDefault: bank.isDefault } : null,
        owner: owner ? { id: owner._id, username: owner.username } : null,
        isShared: sharedIds.has(String(q._id)),
        isOwner: String(q.ownerId) === String(req.userId),
        usageCount: usageById.get(String(q._id)) || 0,
        archivedAt: q.archivedAt,
        updatedAt: q.updatedAt,
        createdAt: q.createdAt
      };
    })
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const content = validateContent(body);

  let bankId = body.bankId;
  if (!bankId) {
    const bank = await ensureDefaultBank(req.userId);
    bankId = bank._id;
  } else {
    if (!mongoose.isValidObjectId(bankId)) throw httpError(400, 'bankId 格式错误');
    await getOwnedBank(bankId, req.userId);
  }

  const { question } = await createQuestionWithV1({
    ownerId: req.userId,
    bankId,
    content,
    changeNote: normalizeNote(body.changeNote, '创建题目')
  });

  const fresh = await Question.findById(question._id);
  res.status(201).json(await detailFor(fresh, req.userId, true));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');

  let versionDoc = null;
  if (req.query.version) {
    versionDoc = await getVersionByNumber(access.question, req.query.version);
  }
  res.json(await detailFor(access.question, req.userId, access.isOwner, versionDoc));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');
  if (!access.isOwner) throw httpError(403, '共享题目不能直接修改，请另存为新题');

  const current = await currentVersionOf(access.question);
  if (!current) throw httpError(500, '题目当前版本缺失');

  const body = req.body || {};
  if (body.type !== undefined && body.type !== access.question.type) {
    throw httpError(400, '题目类型不能通过版本修改，请新建题目');
  }
  const content = validateContent(body, pickContent(current));
  const version = await appendVersion({
    question: access.question,
    content,
    note: normalizeNote(body.changeNote, `修改题目：v${access.question.currentVersion} → v${access.question.currentVersion + 1}`),
    parentVersionId: current._id,
    createdBy: req.userId
  });
  const fresh = await Question.findById(access.question._id);
  const detail = await detailFor(fresh, req.userId, true);
  res.json({ ...detail, createdVersion: versionJson(version) });
}));

router.get('/:id/versions', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');

  const versions = await QuestionVersion.find({ questionId: access.question._id })
    .sort({ version: 1 })
    .lean();
  const versionById = new Map(versions.map((v) => [String(v._id), v.version]));
  res.json({
    questionId: access.question._id,
    currentVersion: access.question.currentVersion,
    items: versions.map((v) => ({
      ...versionJson(v),
      parentVersion: v.parentVersionId
        ? versionById.get(String(v.parentVersionId)) || null
        : null,
      restoredFromVersion: v.restoredFromVersionId
        ? versionById.get(String(v.restoredFromVersionId)) || null
        : null
    }))
  });
}));

router.get('/:id/versions/:version', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');
  const version = await getVersionByNumber(access.question, req.params.version);
  res.json({ version: versionJson(version) });
}));

router.post('/:id/restore', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');
  if (!access.isOwner) throw httpError(403, '只有题目所有者可以恢复版本');

  const target = await getVersionByNumber(access.question, (req.body || {}).version);
  const content = pickContent(target);
  const current = await currentVersionOf(access.question);
  const version = await appendVersion({
    question: access.question,
    content,
    note: normalizeNote((req.body || {}).changeNote, `恢复自 v${target.version}`),
    parentVersionId: current ? current._id : null,
    restoredFromVersionId: target._id,
    createdBy: req.userId
  });
  const fresh = await Question.findById(access.question._id);
  const detail = await detailFor(fresh, req.userId, true);
  res.status(201).json({ ...detail, restoredVersion: versionJson(version) });
}));

router.post('/:id/fork', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');

  let source;
  if ((req.body || {}).version) {
    source = await getVersionByNumber(access.question, req.body.version);
  } else {
    source = await currentVersionOf(access.question);
  }
  if (!source) throw httpError(500, '来源题目版本缺失');

  let bankId = (req.body || {}).bankId;
  if (!bankId) {
    const bank = await ensureDefaultBank(req.userId);
    bankId = bank._id;
  } else {
    if (!mongoose.isValidObjectId(bankId)) throw httpError(400, 'bankId 格式错误');
    await getOwnedBank(bankId, req.userId);
  }

  const { question } = await createQuestionWithV1({
    ownerId: req.userId,
    bankId,
    content: pickContent(source),
    changeNote: normalizeNote((req.body || {}).changeNote, `另存自题目 ${access.question.title} v${source.version}`),
    forkMeta: {
      questionId: access.question._id,
      versionId: source._id
    }
  });
  const fresh = await Question.findById(question._id);
  res.status(201).json(await detailFor(fresh, req.userId, true));
}));

router.post('/:id/share', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');
  if (!access.isOwner) throw httpError(403, '只有题目所有者可以共享');

  const username = typeof (req.body || {}).username === 'string'
    ? req.body.username.trim()
    : '';
  if (!username) throw httpError(400, '请输入要共享的用户名');

  const target = await User.findOne({ username });
  if (!target) throw httpError(404, '目标用户不存在');
  if (String(target._id) === String(req.userId)) throw httpError(400, '不能共享给自己');

  await QuestionShare.findOneAndUpdate(
    { questionId: access.question._id, sharedWithUserId: target._id },
    {
      $setOnInsert: {
        ownerId: req.userId,
        permission: 'use'
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({
    user: { id: target._id, username: target.username },
    permission: 'use'
  });
}));

router.get('/:id/shares', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');
  if (!access.isOwner) throw httpError(403, '只有题目所有者可以查看共享列表');

  const shares = await QuestionShare.find({ questionId: access.question._id })
    .sort({ createdAt: -1 })
    .lean();
  const users = await User.find({
    _id: { $in: shares.map((s) => s.sharedWithUserId) }
  }).select('username').lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  res.json(shares.map((s) => ({
    id: s._id,
    user: userById.has(String(s.sharedWithUserId))
      ? { id: userById.get(String(s.sharedWithUserId))._id, username: userById.get(String(s.sharedWithUserId)).username }
      : { id: s.sharedWithUserId, username: '(已删除用户)' },
    permission: s.permission,
    createdAt: s.createdAt
  })));
}));

router.delete('/:id/shares/:userId', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');
  if (!access.isOwner) throw httpError(403, '只有题目所有者可以取消共享');

  const result = await QuestionShare.deleteOne({
    questionId: access.question._id,
    sharedWithUserId: req.params.userId
  });
  if (result.deletedCount === 0) throw httpError(404, '共享记录不存在');
  res.json({ ok: true });
}));

router.get('/:id/usage', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');
  if (!access.isOwner) throw httpError(403, '只有题目所有者可以查看使用情况');

  const surveys = await Survey.find({
    'questions.sourceQuestionId': access.question._id
  })
    .select('title status ownerId questions createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  const items = surveys.map((survey) => {
    const used = (survey.questions || [])
      .filter((q) => q.sourceQuestionId && String(q.sourceQuestionId) === String(access.question._id))
      .map((q) => ({ qid: q.qid, version: q.sourceVersion || 1 }));
    return {
      surveyId: survey._id,
      title: survey.title,
      status: survey.status,
      ownerId: survey.ownerId,
      questionCount: used.length,
      questions: used,
      createdAt: survey.createdAt,
      updatedAt: survey.updatedAt
    };
  });

  res.json({
    questionId: access.question._id,
    totalSurveys: items.length,
    items
  });
}));

router.get('/:id/stats', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');
  if (!access.isOwner) throw httpError(403, '只有题目所有者可以查看跨问卷统计');

  const stats = await computeQuestionStats(access.question);
  res.json(stats);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const access = await getQuestionAccess(req.params.id, req.userId);
  if (!access) throw httpError(404, '题目不存在或无权访问');
  if (!access.isOwner) throw httpError(403, '只有题目所有者可以归档题目');

  access.question.archivedAt = new Date();
  await access.question.save();
  res.json({ ok: true, archivedAt: access.question.archivedAt });
}));

module.exports = router;
