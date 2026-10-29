const mongoose = require('mongoose');
const QuestionBank = require('../models/QuestionBank');
const Question = require('../models/Question');
const QuestionVersion = require('../models/QuestionVersion');
const QuestionShare = require('../models/QuestionShare');
const { validateSurveyDefinition } = require('./validation');
const { httpError } = require('../utils/http');

const DEFAULT_BANK_NAME = '我的题库';

function pickContent(version) {
  return {
    type: version.type,
    title: version.title,
    options: (version.options || []).map((o) => ({
      key: o.key,
      label: o.label
    })),
    minSelect: version.minSelect ?? null,
    maxSelect: version.maxSelect ?? null,
    minLength: version.minLength ?? null,
    maxLength: version.maxLength ?? null,
    min: version.min ?? null,
    max: version.max ?? null,
    integerOnly: version.integerOnly === true
  };
}

function mergeContent(body, base = {}) {
  const source = body || {};
  return {
    type: source.type !== undefined ? source.type : base.type,
    title: source.title !== undefined ? source.title : base.title,
    options: source.options !== undefined ? source.options : (base.options || []),
    minSelect: source.minSelect !== undefined ? source.minSelect : base.minSelect,
    maxSelect: source.maxSelect !== undefined ? source.maxSelect : base.maxSelect,
    minLength: source.minLength !== undefined ? source.minLength : base.minLength,
    maxLength: source.maxLength !== undefined ? source.maxLength : base.maxLength,
    min: source.min !== undefined ? source.min : base.min,
    max: source.max !== undefined ? source.max : base.max,
    integerOnly: source.integerOnly !== undefined
      ? source.integerOnly
      : (base.integerOnly === true)
  };
}

/**
 * 复用第一阶段的题目定义校验：把单个题目包装成只有一道题的问卷。
 * 这样题库题和问卷题使用完全相同的类型/选项/范围规则。
 */
function validateContent(body, base = {}) {
  const merged = mergeContent(body, base);
  const result = validateSurveyDefinition({
    questions: [{
      qid: 'q1',
      type: merged.type,
      title: merged.title,
      required: false,
      order: 0,
      options: merged.options,
      minSelect: merged.minSelect,
      maxSelect: merged.maxSelect,
      minLength: merged.minLength,
      maxLength: merged.maxLength,
      min: merged.min,
      max: merged.max,
      integerOnly: merged.integerOnly,
      jumps: []
    }]
  }, { allowEmptyQuestions: false });

  if (!result.ok) {
    const err = httpError(400, result.error || '题目内容不合法');
    err.details = result.errors;
    throw err;
  }

  const q = result.questions[0];
  return {
    type: q.type,
    title: q.title,
    options: q.options,
    minSelect: q.minSelect,
    maxSelect: q.maxSelect,
    minLength: q.minLength,
    maxLength: q.maxLength,
    min: q.min,
    max: q.max,
    integerOnly: q.integerOnly
  };
}

function normalizeNote(note, fallback) {
  if (typeof note !== 'string' || !note.trim()) return fallback;
  return note.trim().slice(0, 300);
}

async function ensureDefaultBank(ownerId) {
  let bank = await QuestionBank.findOne({ ownerId, isDefault: true });
  if (bank) return bank;

  try {
    bank = await QuestionBank.create({
      ownerId,
      name: DEFAULT_BANK_NAME,
      description: '系统自动创建的默认题库',
      isDefault: true
    });
    return bank;
  } catch (err) {
    if (!err || err.code !== 11000) throw err;
    bank = await QuestionBank.findOne({ ownerId, isDefault: true });
    if (bank) return bank;
    // 名称冲突时，把已有同名题库设为默认题库。
    bank = await QuestionBank.findOne({ ownerId, name: DEFAULT_BANK_NAME });
    if (!bank) throw err;
    bank.isDefault = true;
    await bank.save();
    return bank;
  }
}

async function getOwnedBank(bankId, ownerId) {
  const bank = await QuestionBank.findOne({ _id: bankId, ownerId });
  if (!bank) throw httpError(404, '题库不存在或无权访问');
  return bank;
}

async function getQuestionAccess(questionId, userId, { includeArchived = false } = {}) {
  if (!mongoose.isValidObjectId(questionId)) return null;
  const question = await Question.findById(questionId);
  if (!question) return null;
  if (!includeArchived && question.archivedAt) return null;

  if (String(question.ownerId) === String(userId)) {
    return { question, isOwner: true, share: null };
  }

  const share = await QuestionShare.findOne({
    questionId: question._id,
    sharedWithUserId: userId
  });
  if (!share) return null;
  return { question, isOwner: false, share };
}

async function currentVersionOf(question) {
  if (!question.currentVersionId) return null;
  return QuestionVersion.findOne({
    _id: question.currentVersionId,
    questionId: question._id
  });
}

async function getVersionByNumber(question, versionNumber) {
  const number = Number(versionNumber);
  if (!Number.isInteger(number) || number < 1) {
    throw httpError(400, '版本号必须是正整数');
  }
  const version = await QuestionVersion.findOne({
    questionId: question._id,
    version: number
  });
  if (!version) throw httpError(404, '题目版本不存在');
  return version;
}

/**
 * 创建逻辑题目 + v1 版本。
 * MongoDB 单机环境没有事务，因此失败时手动清理已创建的题目。
 */
async function createQuestionWithV1({ ownerId, bankId, content, changeNote, forkMeta }) {
  const question = await Question.create({
    ownerId,
    bankId,
    title: content.title,
    type: content.type,
    currentVersion: 1,
    currentVersionId: null,
    forkedFromQuestionId: forkMeta ? forkMeta.questionId : null,
    forkedFromVersionId: forkMeta ? forkMeta.versionId : null
  });

  try {
    const version = await QuestionVersion.create({
      questionId: question._id,
      ownerId,
      version: 1,
      ...content,
      parentVersionId: null,
      restoredFromVersionId: null,
      changeNote: normalizeNote(changeNote, forkMeta ? '从共享题目另存' : '创建题目'),
      createdBy: ownerId
    });
    question.currentVersionId = version._id;
    await question.save();
    return { question, version };
  } catch (err) {
    await Question.deleteOne({ _id: question._id });
    throw err;
  }
}

/**
 * 追加不可变新版本，并把逻辑题目的当前版本指针前移。
 * 旧版本不修改，因此所有引用旧版本快照的问卷完全不受影响。
 */
async function appendVersion({
  question,
  content,
  note,
  parentVersionId = null,
  restoredFromVersionId = null,
  createdBy
}) {
  const versionNumber = Number(question.currentVersion) + 1;
  const version = await QuestionVersion.create({
    questionId: question._id,
    ownerId: question.ownerId,
    version: versionNumber,
    ...content,
    parentVersionId,
    restoredFromVersionId,
    changeNote: normalizeNote(note, '修改题目'),
    createdBy
  });

  question.currentVersion = versionNumber;
  question.currentVersionId = version._id;
  question.title = content.title;
  question.type = content.type;
  await question.save();
  return version;
}

async function canUseQuestion(question, userId) {
  if (String(question.ownerId) === String(userId)) return true;
  const share = await QuestionShare.exists({
    questionId: question._id,
    sharedWithUserId: userId
  });
  return Boolean(share);
}

async function hasUsedQuestion(questionId, ownerId) {
  const count = await QuestionVersion.countDocuments({
    questionId,
    ownerId
  });
  return count > 0;
}

module.exports = {
  DEFAULT_BANK_NAME,
  pickContent,
  mergeContent,
  validateContent,
  normalizeNote,
  ensureDefaultBank,
  getOwnedBank,
  getQuestionAccess,
  currentVersionOf,
  getVersionByNumber,
  createQuestionWithV1,
  appendVersion,
  canUseQuestion,
  hasUsedQuestion
};
