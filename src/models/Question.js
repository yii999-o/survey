const mongoose = require('mongoose');

/**
 * 逻辑题目（题目实体）。
 * 题目内容不直接放在这里，而是放在不可变的 QuestionVersion 中：
 * 每次修改生成新版本，旧版本和引用旧版本的问卷都不受影响。
 */
const questionSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, default: 2 },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    bankId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionBank',
      required: true,
      index: true
    },
    // 以下两个字段是当前版本的缓存，便于列表展示；真正内容在 QuestionVersion。
    title: { type: String, required: true, trim: true, maxlength: 200 },
    type: {
      type: String,
      enum: ['single', 'multi', 'text', 'number'],
      required: true
    },
    currentVersion: { type: Number, default: 1, min: 1 },
    currentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionVersion',
      default: null
    },
    archivedAt: { type: Date, default: null },
    forkedFromQuestionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      default: null
    },
    forkedFromVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionVersion',
      default: null
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

questionSchema.index({ ownerId: 1, bankId: 1, updatedAt: -1 });
questionSchema.index({ title: 'text' });

module.exports = mongoose.model('Question', questionSchema);
