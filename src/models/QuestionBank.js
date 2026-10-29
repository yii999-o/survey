const mongoose = require('mongoose');

/**
 * 题目库（题库）是用户的题目集合。
 * 每个用户有一个默认题库；也可以创建多个自定义题库。
 */
const questionBankSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, default: 2 },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: '', trim: true, maxlength: 500 },
    isDefault: { type: Boolean, default: false }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

questionBankSchema.index({ ownerId: 1, name: 1 }, { unique: true });
questionBankSchema.index(
  { ownerId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

module.exports = mongoose.model('QuestionBank', questionBankSchema);
