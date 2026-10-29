const express = require('express');
const QuestionBank = require('../models/QuestionBank');
const Question = require('../models/Question');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, httpError } = require('../utils/http');
const { ensureDefaultBank } = require('../services/questionLibrary');

const router = express.Router();
router.use(authRequired);

function bankName(value) {
  if (typeof value !== 'string') throw httpError(400, '题库名称必须是字符串');
  const name = value.trim();
  if (!name) throw httpError(400, '题库名称不能为空');
  if (name.length > 60) throw httpError(400, '题库名称最多 60 个字符');
  return name;
}

router.get('/', asyncHandler(async (req, res) => {
  await ensureDefaultBank(req.userId);
  const banks = await QuestionBank.find({ ownerId: req.userId })
    .sort({ isDefault: -1, createdAt: 1 })
    .lean();

  const grouped = banks.length
    ? await Question.aggregate([
      { $match: { ownerId: banks[0].ownerId, archivedAt: null } },
      { $group: { _id: '$bankId', count: { $sum: 1 } } }
    ])
    : [];
  const countByBank = new Map(grouped.map((g) => [String(g._id), g.count]));

  res.json(banks.map((b) => ({
    ...b,
    questionCount: countByBank.get(String(b._id)) || 0
  })));
}));

router.post('/', asyncHandler(async (req, res) => {
  const name = bankName(req.body && req.body.name);
  const description = typeof (req.body || {}).description === 'string'
    ? req.body.description.trim().slice(0, 500)
    : '';

  const bank = await QuestionBank.create({
    ownerId: req.userId,
    name,
    description,
    isDefault: false
  });
  res.status(201).json({ ...bank.toObject(), questionCount: 0 });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const bank = await QuestionBank.findOne({ _id: req.params.id, ownerId: req.userId });
  if (!bank) throw httpError(404, '题库不存在或无权访问');

  const body = req.body || {};
  if (body.name !== undefined) bank.name = bankName(body.name);
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') throw httpError(400, '题库说明必须是字符串');
    bank.description = body.description.trim().slice(0, 500);
  }
  await bank.save();
  res.json(bank);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const bank = await QuestionBank.findOne({ _id: req.params.id, ownerId: req.userId });
  if (!bank) throw httpError(404, '题库不存在或无权访问');
  if (bank.isDefault) throw httpError(409, '默认题库不能删除');

  const count = await Question.countDocuments({ bankId: bank._id, archivedAt: null });
  if (count > 0) throw httpError(409, '题库中还有题目，不能删除');

  await bank.deleteOne();
  res.json({ ok: true });
}));

module.exports = router;
