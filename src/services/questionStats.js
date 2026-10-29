const Survey = require('../models/Survey');
const Response = require('../models/Response');
const QuestionVersion = require('../models/QuestionVersion');

function keyString(value) {
  return String(value);
}

function baseChoiceCounts(options) {
  const counts = {};
  (options || []).forEach((o) => { counts[o.key] = 0; });
  return counts;
}

function applyChoiceValue(counts, value, count) {
  if (Array.isArray(value)) {
    value.forEach((key) => {
      counts[key] = (counts[key] || 0) + count;
    });
  } else if (value != null) {
    const key = keyString(value);
    counts[key] = (counts[key] || 0) + count;
  }
}

function optionList(version) {
  return (version.options || []).map((o) => ({
    key: o.key,
    label: o.label
  }));
}

function mergeOptionLabels(target, version) {
  (version.options || []).forEach((o) => {
    if (!target.has(o.key)) target.set(o.key, o.label);
  });
}

/**
 * 跨问卷单题统计。
 *
 * 统计口径：
 * - 只统计题库来源的题目（answers.questionId 匹配）；
 * - 问卷可以引用同一题目的不同版本，按版本拆分；
 * - 单选题/多选题按选项 key 汇总，label 优先取当前版本；
 * - 数字题计算总体平均/最小/最大；
 * - 文本题返回原文。
 */
async function computeQuestionStats(question) {
  const currentVersion = question.currentVersionId
    ? await QuestionVersion.findOne({
      _id: question.currentVersionId,
      questionId: question._id
    }).lean()
    : null;

  const surveys = await Survey.find({
    'questions.sourceQuestionId': question._id
  })
    .select('title status ownerId questions updatedAt createdAt')
    .sort({ updatedAt: -1 })
    .lean();

  const usages = [];
  surveys.forEach((survey) => {
    (survey.questions || []).forEach((q) => {
      if (q.sourceQuestionId && String(q.sourceQuestionId) === String(question._id)) {
        usages.push({
          surveyId: survey._id,
          surveyTitle: survey.title,
          surveyStatus: survey.status,
          surveyOwnerId: survey.ownerId,
          qid: q.qid,
          version: q.sourceVersion || 1,
          versionId: q.sourceVersionId || null
        });
      }
    });
  });

  const surveyIds = [...new Set(usages.map((u) => String(u.surveyId)))]
    .map((id) => usages.find((u) => String(u.surveyId) === id).surveyId);
  const versionIds = [...new Set(usages.map((u) => u.versionId).filter(Boolean).map(String))];
  const versionDocs = versionIds.length
    ? await QuestionVersion.find({ _id: { $in: versionIds } }).lean()
    : [];
  const versionById = new Map(versionDocs.map((v) => [String(v._id), v]));

  const [totalAgg, answeredCount, rows, perSurveyTotals, perSurveyAnswered] = await Promise.all([
    surveyIds.length
      ? Response.aggregate([
        { $match: { surveyId: { $in: surveyIds } } },
        { $group: { _id: null, total: { $sum: 1 } } }
      ])
      : [],
    Response.countDocuments({ 'answers.questionId': question._id }),
    Response.aggregate([
      { $match: { 'answers.questionId': question._id } },
      { $unwind: '$answers' },
      { $match: { 'answers.questionId': question._id } },
      {
        $group: {
          _id: {
            value: '$answers.value',
            surveyId: '$surveyId',
            versionId: '$answers.questionVersionId'
          },
          count: { $sum: 1 }
        }
      }
    ]),
    surveyIds.length
      ? Response.aggregate([
        { $match: { surveyId: { $in: surveyIds } } },
        { $group: { _id: '$surveyId', total: { $sum: 1 } } }
      ])
      : [],
    surveyIds.length
      ? Response.aggregate([
        { $match: { 'answers.questionId': question._id } },
        { $group: { _id: '$surveyId', responses: { $addToSet: '$_id' } } },
        { $project: { count: { $size: '$responses' } } }
      ])
      : []
  ]);

  const totalResponses = totalAgg.length ? totalAgg[0].total : 0;
  const totalBySurvey = new Map(perSurveyTotals.map((r) => [String(r._id), r.total]));
  const answeredBySurvey = new Map(perSurveyAnswered.map((r) => [String(r._id), r.count]));

  const labelMap = new Map();
  if (currentVersion) mergeOptionLabels(labelMap, currentVersion);
  versionDocs.forEach((v) => mergeOptionLabels(labelMap, v));
  usages.forEach((u) => {
    if (u.versionId && versionById.has(String(u.versionId))) {
      mergeOptionLabels(labelMap, versionById.get(String(u.versionId)));
    }
  });

  const versionRows = new Map();
  const overallCounts = baseChoiceCounts([...labelMap.entries()].map(([key, label]) => ({ key, label })));
  const overallValues = [];
  const numericValues = [];

  rows.forEach((row) => {
    const versionKey = row._id.versionId ? String(row._id.versionId) : 'current';
    if (!versionRows.has(versionKey)) {
      versionRows.set(versionKey, {
        counts: baseChoiceCounts([...labelMap.entries()].map(([key, label]) => ({ key, label }))),
        answered: 0,
        numeric: [],
        text: []
      });
    }
    const bucket = versionRows.get(versionKey);
    bucket.answered += row.count;

    if (question.type === 'single' || question.type === 'multi') {
      applyChoiceValue(overallCounts, row._id.value, row.count);
      applyChoiceValue(bucket.counts, row._id.value, row.count);
    } else if (question.type === 'number') {
      const n = Number(row._id.value);
      if (Number.isFinite(n)) {
        for (let i = 0; i < row.count; i += 1) {
          numericValues.push(n);
          bucket.numeric.push(n);
        }
      }
    } else {
      for (let i = 0; i < row.count; i += 1) {
        overallValues.push(row._id.value);
        bucket.text.push(row._id.value);
      }
    }
  });

  const versionNumberById = new Map();
  usages.forEach((u) => {
    if (u.versionId) versionNumberById.set(String(u.versionId), u.version);
  });

  const allVersionIds = new Set(versionRows.keys());
  const perVersion = [...allVersionIds].map((versionKey) => {
    const bucket = versionRows.get(versionKey);
    const versionDoc = versionKey === 'current'
      ? currentVersion
      : versionById.get(versionKey);
    const versionNumber = versionKey === 'current'
      ? (currentVersion ? currentVersion.version : question.currentVersion)
      : (versionNumberById.get(versionKey) || (versionDoc ? versionDoc.version : null));
    const base = {
      versionId: versionKey === 'current' ? null : versionKey,
      version: versionNumber,
      answered: bucket.answered,
      title: versionDoc ? versionDoc.title : (currentVersion ? currentVersion.title : question.title),
      options: versionDoc ? optionList(versionDoc) : (currentVersion ? optionList(currentVersion) : []),
      changeNote: versionDoc ? versionDoc.changeNote : ''
    };

    if (question.type === 'single' || question.type === 'multi') {
      return { ...base, counts: bucket.counts };
    }
    if (question.type === 'number') {
      const sum = bucket.numeric.reduce((a, b) => a + b, 0);
      return {
        ...base,
        average: bucket.numeric.length
          ? Number((sum / bucket.numeric.length).toFixed(4))
          : null,
        min: bucket.numeric.length ? Math.min(...bucket.numeric) : null,
        max: bucket.numeric.length ? Math.max(...bucket.numeric) : null,
        values: bucket.numeric
      };
    }
    return { ...base, values: bucket.text };
  }).sort((a, b) => (b.version || 0) - (a.version || 0));

  const surveyList = surveys.map((survey) => {
    const surveyUsages = usages.filter((u) => String(u.surveyId) === String(survey._id));
    return {
      surveyId: survey._id,
      title: survey.title,
      status: survey.status,
      ownerId: survey.ownerId,
      totalResponses: totalBySurvey.get(String(survey._id)) || 0,
      answeredResponses: answeredBySurvey.get(String(survey._id)) || 0,
      questions: surveyUsages.map((u) => ({ qid: u.qid, version: u.version }))
    };
  });

  const result = {
    question: {
      id: question._id,
      title: question.title,
      type: question.type,
      currentVersion: question.currentVersion
    },
    surveyCount: surveys.length,
    versionCount: new Set(usages.map((u) => u.version)).size,
    totalResponses,
    answeredResponses: answeredCount,
    currentVersion: currentVersion ? {
      id: currentVersion._id,
      version: currentVersion.version,
      title: currentVersion.title,
      type: currentVersion.type,
      options: optionList(currentVersion)
    } : null,
    perVersion,
    surveys: surveyList
  };

  if (question.type === 'single' || question.type === 'multi') {
    result.type = question.type;
    result.counts = overallCounts;
    result.options = [...labelMap.entries()].map(([key, label]) => ({
      key,
      label,
      count: overallCounts[key] || 0,
      percent: answeredCount > 0
        ? Number(((overallCounts[key] || 0) / answeredCount * 100).toFixed(2))
        : 0
    }));
  } else if (question.type === 'number') {
    const sum = numericValues.reduce((a, b) => a + b, 0);
    result.type = question.type;
    result.average = numericValues.length
      ? Number((sum / numericValues.length).toFixed(4))
      : null;
    result.min = numericValues.length ? Math.min(...numericValues) : null;
    result.max = numericValues.length ? Math.max(...numericValues) : null;
    result.values = numericValues;
  } else {
    result.type = question.type;
    result.values = overallValues;
  }

  return result;
}

module.exports = { computeQuestionStats };
