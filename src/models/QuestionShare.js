const mongoose = require('mongoose');

/**
 * 题目共享记录：共享后对方可以查看、在自己的问卷中使用和另存为新题，
 * 但不能修改原题；原题的修改通过新版本完成，不会影响对方已建问卷。
 */
const questionShareSchema = new mongoose.Schema(
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
    sharedWithUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    permission: { type: String, enum: ['use'], default: 'use' }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false
  }
);

questionShareSchema.index(
  { questionId: 1, sharedWithUserId: 1 },
  { unique: true }
);
questionShareSchema.index({ sharedWithUserId: 1, createdAt: -1 });

module.exports = mongoose.model('QuestionShare', questionShareSchema);
