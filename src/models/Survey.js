const mongoose = require('mongoose');

/**
 * 题目与跳转规则嵌入 Survey 文档。
 * 原因：题目数量有限（<=100），且每次填答都需要整卷快照；
 * 一次查询即可拿到题目、选项、跳转规则，避免多集合 join。
 */
const optionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 32 },
    label: { type: String, required: true, trim: true, maxlength: 200 }
  },
  { _id: false }
);

const jumpSchema = new mongoose.Schema(
  {
    // when 是多态条件对象：single 用 option，multi 用 includes/count*，number 用 op+value。
    when: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
    // null 表示结束问卷；非空字符串表示目标题目的 qid。
    goto: { type: String, default: null }
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    qid: { type: String, required: true, trim: true, maxlength: 32 },
    type: {
      type: String,
      enum: ['single', 'multi', 'text', 'number'],
      required: true
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0, min: 0 },

    options: { type: [optionSchema], default: [] },
    minSelect: { type: Number, default: null },
    maxSelect: { type: Number, default: null },
    minLength: { type: Number, default: null },
    maxLength: { type: Number, default: null },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    integerOnly: { type: Boolean, default: false },

    jumps: { type: [jumpSchema], default: [] }
  },
  { _id: false }
);

const surveySchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, default: 1 },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 2000 },
    allowAnonymous: { type: Boolean, default: false },
    allowMultiple: { type: Boolean, default: true },

    status: {
      type: String,
      enum: ['draft', 'published', 'closed'],
      default: 'draft',
      index: true
    },
    deadline: { type: Date, default: null },
    shareCode: { type: String, required: true, trim: true },

    questions: { type: [questionSchema], default: [] },

    publishedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

// 分享链接是公开入口，必须唯一；ownerId + createdAt 支撑“我的问卷”列表。
surveySchema.index({ shareCode: 1 }, { unique: true });
surveySchema.index({ ownerId: 1, createdAt: -1 });
surveySchema.index({ status: 1, deadline: 1 });

module.exports = mongoose.model('Survey', surveySchema);
