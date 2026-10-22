const Response = require('../models/Response');

function buildChoiceResult(q, rows, totalAnswers) {
  const counts = {};
  (q.options || []).forEach((o) => { counts[o.key] = 0; });

  rows.forEach((row) => {
    const value = row._id.value;
    if (Array.isArray(value)) {
      value.forEach((key) => {
        if (counts[key] !== undefined) counts[key] += row.count;
      });
    } else if (value != null && counts[value] !== undefined) {
      counts[value] += row.count;
    }
  });

  const options = (q.options || []).map((o) => ({
    key: o.key,
    label: o.label,
    count: counts[o.key] || 0,
    // 多选题的百分比 = 选择该选项人数 / 回答该题人数，可能合计超过 100%。
    percent: totalAnswers > 0
      ? Number(((counts[o.key] || 0) / totalAnswers * 100).toFixed(2))
      : 0
  }));

  return { counts, options };
}

/**
 * 用 MongoDB 聚合按「题目 + 答案值」分组，然后在 Node 侧按题型组装。
 * 不把全部原始答卷拉到内存，数据量大时仍然只传输聚合结果。
 */
async function computeStats(survey, onlyQid = null) {
  const questions = [...survey.questions]
    .filter((q) => !onlyQid || q.qid === onlyQid)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const qids = questions.map((q) => q.qid);
  const rows = qids.length === 0 ? [] : await Response.aggregate([
    { $match: { surveyId: survey._id } },
    { $unwind: '$answers' },
    { $match: { 'answers.qid': { $in: qids } } },
    {
      $group: {
        _id: { qid: '$answers.qid', value: '$answers.value' },
        count: { $sum: 1 }
      }
    }
  ]);

  const totalResponses = await Response.countDocuments({ surveyId: survey._id });

  const result = questions.map((q) => {
    const mine = rows.filter((r) => r._id.qid === q.qid);
    // 对单选/数字/文本，一条分组行代表 count 份答卷；
    // 对多选，值是数组，一条分组行同样代表 count 份答卷（不是选项个数）。
    const totalAnswers = mine.reduce((sum, r) => sum + r.count, 0);

    if (q.type === 'single' || q.type === 'multi') {
      return {
        qid: q.qid,
        title: q.title,
        type: q.type,
        required: q.required,
        totalAnswers,
        ...buildChoiceResult(q, mine, totalAnswers)
      };
    }

    if (q.type === 'number') {
      const values = [];
      mine.forEach((r) => {
        const n = Number(r._id.value);
        if (Number.isFinite(n)) {
          for (let i = 0; i < r.count; i += 1) values.push(n);
        }
      });
      const sum = values.reduce((a, b) => a + b, 0);
      return {
        qid: q.qid,
        title: q.title,
        type: q.type,
        required: q.required,
        totalAnswers,
        average: values.length ? Number((sum / values.length).toFixed(4)) : null,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
        values
      };
    }

    const values = [];
    mine.forEach((r) => {
      for (let i = 0; i < r.count; i += 1) values.push(r._id.value);
    });
    return {
      qid: q.qid,
      title: q.title,
      type: q.type,
      required: q.required,
      totalAnswers,
      values
    };
  });

  return { totalResponses, questions: result };
}

module.exports = { computeStats };
