const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 32 },
    label: { type: String, required: true, trim: true, maxlength: 200 }
  },
  { _id: false }
);

/**
 * 不可变题目版本。只允许新增，不允许原地修改。
 * 类型在版本之间保持不变，避免跨版本统计口径混乱。
 */
const questionVersionSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, default: 2 },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
      index: true
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    version: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    type: {
      type: String,
      enum: ['single', 'multi', 'text', 'number'],
      required: true
    },
    options: { type: [optionSchema], default: [] },
    minSelect: { type: Number, default: null },
    maxSelect: { type: Number, default: null },
    minLength: { type: Number, default: null },
    maxLength: { type: Number, default: null },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    integerOnly: { type: Boolean, default: false },

    parentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionVersion',
      default: null
    },
    restoredFromVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionVersion',
      default: null
    },
    changeNote: { type: String, default: '', trim: true, maxlength: 300 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false
  }
);

questionVersionSchema.index({ questionId: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('QuestionVersion', questionVersionSchema);
