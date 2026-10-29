const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    qid: { type: String, required: true },
    // single: String；multi: [String]；text: String；number: Number
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    // 第二阶段：题库题的来源信息，用于跨问卷单题统计。
    // 非题库题为 null，旧答卷也可以继续读取。
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      default: null
    },
    questionVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionVersion',
      default: null
    }
  },
  { _id: false }
);

const responseSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, default: 2 },
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
responseSchema.index({ 'answers.questionId': 1, submittedAt: -1 });

module.exports = mongoose.model('Response', responseSchema);
