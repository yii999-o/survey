const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    qid: { type: String, required: true },
    // single: String；multi: [String]；text: String；number: Number
    value: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  { _id: false }
);

const responseSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, default: 1 },
    surveyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Survey',
      required: true,
      index: true
    },
    // 匿名填写时为 null。
    respondentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // 保存实际答题路径，便于审计跳转；answers 只保存路径上的答案。
    answers: { type: [answerSchema], default: [] },
    visitedPath: { type: [String], default: [] },
    submittedAt: { type: Date, default: Date.now }
  },
  {
    versionKey: false
  }
);

// 统计按问卷 + 时间读取；重复填写检查按问卷 + 用户读取。
responseSchema.index({ surveyId: 1, submittedAt: -1 });
responseSchema.index({ surveyId: 1, respondentId: 1 });
responseSchema.index({ surveyId: 1, 'answers.qid': 1 });

module.exports = mongoose.model('Response', responseSchema);
