/**
 * 问卷核心逻辑（服务端 / 浏览器共用）
 *
 * 这里刻意不依赖任何框架：题型校验、题目跳转、整卷校验都在此实现。
 * 浏览器通过 <script src="/shared/survey-engine.js"> 使用，Node.js 通过
 * require('../../shared/survey-engine') 使用，避免前后端两套跳转逻辑不一致。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SurveyEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const QUESTION_TYPES = ['single', 'multi', 'text', 'number'];
  const JUMP_OPS = ['>', '>=', '<', '<=', '=='];
  const QID_RE = /^[A-Za-z0-9_-]{1,32}$/;

  function isBlank(value) {
    return value === undefined || value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);
  }

  function toFiniteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function toNullableNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    return toFiniteNumber(value);
  }

  function textLength(value) {
    // 按 Unicode 码点计数，避免 emoji 被算成两个字符。
    return Array.from(String(value)).length;
  }

  function normalizeQuestion(input, index) {
    const q = input || {};
    const options = Array.isArray(q.options)
      ? q.options.map((o) => ({
        key: o && o.key != null ? String(o.key).trim() : '',
        label: o && o.label != null ? String(o.label).trim() : ''
      }))
      : [];

    const jumps = Array.isArray(q.jumps)
      ? q.jumps.map((j) => {
        const when = j && j.when && typeof j.when === 'object'
          ? { ...j.when }
          : {};
        return {
          when,
          goto: j && j.goto != null && j.goto !== '' ? String(j.goto) : null
        };
      })
      : [];

    return {
      qid: q.qid != null && String(q.qid).trim() !== ''
        ? String(q.qid).trim()
        : `q${index + 1}`,
      type: q.type,
      title: q.title != null ? String(q.title).trim() : '',
      required: q.required === true,
      order: index,
      options,
      minSelect: toNullableNumber(q.minSelect),
      maxSelect: toNullableNumber(q.maxSelect),
      minLength: toNullableNumber(q.minLength),
      maxLength: toNullableNumber(q.maxLength),
      min: toNullableNumber(q.min),
      max: toNullableNumber(q.max),
      integerOnly: q.integerOnly === true,
      // 第二阶段：题库来源信息。普通问卷题保持 null。
      sourceQuestionId: q.sourceQuestionId || null,
      sourceVersionId: q.sourceVersionId || null,
      sourceVersion: q.sourceVersion != null ? Number(q.sourceVersion) : null,
      jumps
    };
  }

  function sortQuestions(surveyOrQuestions) {
    const list = Array.isArray(surveyOrQuestions)
      ? surveyOrQuestions
      : (surveyOrQuestions && Array.isArray(surveyOrQuestions.questions)
        ? surveyOrQuestions.questions
        : []);
    return list
      .map((q, index) => ({ q, index }))
      .sort((a, b) => {
        const ao = Number.isFinite(Number(a.q && a.q.order)) ? Number(a.q.order) : a.index;
        const bo = Number.isFinite(Number(b.q && b.q.order)) ? Number(b.q.order) : b.index;
        return ao - bo || a.index - b.index;
      })
      .map((item) => item.q);
  }

  function questionMap(surveyOrQuestions) {
    const map = new Map();
    sortQuestions(surveyOrQuestions).forEach((q) => {
      if (q && q.qid != null) map.set(String(q.qid), q);
    });
    return map;
  }

  function answersToMap(answers) {
    const map = new Map();
    if (answers instanceof Map) {
      answers.forEach((value, key) => map.set(String(key), value));
      return map;
    }
    if (Array.isArray(answers)) {
      answers.forEach((item) => {
        if (item && item.qid != null) map.set(String(item.qid), item.value);
      });
      return map;
    }
    if (answers && typeof answers === 'object') {
      Object.keys(answers).forEach((key) => map.set(key, answers[key]));
    }
    return map;
  }

  /**
   * 判断一条跳转规则是否命中当前答案。
   * 规则字段全部来自问卷文档，不在代码里写死任何具体题目。
   */
  function matchJump(jump, value) {
    if (!jump || !jump.when || typeof jump.when !== 'object') return false;
    if (isBlank(value)) return false;

    const when = jump.when;

    if (Object.prototype.hasOwnProperty.call(when, 'option')) {
      if (Array.isArray(value)) return value.map(String).includes(String(when.option));
      return String(value) === String(when.option);
    }

    if (Object.prototype.hasOwnProperty.call(when, 'includes')) {
      return Array.isArray(value) &&
        value.map(String).includes(String(when.includes));
    }

    if (when.countAtLeast != null) {
      return Array.isArray(value) && value.length >= Number(when.countAtLeast);
    }
    if (when.countAtMost != null) {
      return Array.isArray(value) && value.length <= Number(when.countAtMost);
    }
    if (when.countEquals != null) {
      return Array.isArray(value) && value.length === Number(when.countEquals);
    }

    if (when.op != null) {
      const n = toFiniteNumber(value);
      const target = toFiniteNumber(when.value);
      if (n === null || target === null) return false;
      switch (when.op) {
        case '>': return n > target;
        case '>=': return n >= target;
        case '<': return n < target;
        case '<=': return n <= target;
        case '==': return n === target;
        default: return false;
      }
    }

    return false;
  }

  /**
   * 根据当前答案计算答题路径。
   * 规则按题目上的 jumps 数组顺序匹配，第一条命中生效；goto=null 表示结束问卷。
   * 只允许向后跳转，因此在数据校验阶段即可排除循环；运行期仍做循环保护。
   */
  function walkPath(surveyOrQuestions, answers) {
    const questions = sortQuestions(surveyOrQuestions);
    const indexByQid = new Map();
    questions.forEach((q, i) => {
      if (q && q.qid != null) indexByQid.set(String(q.qid), i);
    });

    const ansMap = answersToMap(answers);
    const path = [];
    const visited = new Set();
    let terminated = false;
    let error = null;
    let i = 0;

    while (i >= 0 && i < questions.length) {
      const q = questions[i];
      const qid = String(q.qid);

      if (visited.has(qid)) {
        error = `检测到循环跳转：${qid}`;
        break;
      }
      visited.add(qid);
      path.push(qid);

      let chosen = null;
      const jumps = Array.isArray(q.jumps) ? q.jumps : [];
      for (const jump of jumps) {
        if (matchJump(jump, ansMap.get(qid))) {
          chosen = jump;
          break;
        }
      }

      if (!chosen) {
        i += 1;
        continue;
      }

      if (chosen.goto === null || chosen.goto === undefined || chosen.goto === '') {
        terminated = true;
        break;
      }

      const targetQid = String(chosen.goto);
      if (!indexByQid.has(targetQid)) {
        error = `跳转目标不存在：${targetQid}`;
        break;
      }
      const targetIndex = indexByQid.get(targetQid);
      if (targetIndex <= i) {
        error = `不允许回跳或跳到当前题：${targetQid}`;
        break;
      }
      i = targetIndex;
    }

    return {
      path,
      error,
      terminated,
      completed: !error && (terminated || i >= questions.length)
    };
  }

  function validateAnswer(q, raw) {
    if (!q) return { ok: false, error: '题目不存在' };

    if (isBlank(raw)) {
      if (q.required) return { ok: false, error: `「${q.title}」为必答题` };
      return { ok: true, value: null };
    }

    switch (q.type) {
      case 'single': {
        if (typeof raw !== 'string' && typeof raw !== 'number') {
          return { ok: false, error: `「${q.title}」必须选择一个选项` };
        }
        const value = String(raw);
        if (!(q.options || []).some((o) => String(o.key) === value)) {
          return { ok: false, error: `「${q.title}」选项非法` };
        }
        return { ok: true, value };
      }

      case 'multi': {
        if (!Array.isArray(raw)) {
          return { ok: false, error: `「${q.title}」需提交选项数组` };
        }
        const keys = new Set((q.options || []).map((o) => String(o.key)));
        const values = raw.map(String);
        if (values.some((v) => !keys.has(v))) {
          return { ok: false, error: `「${q.title}」包含非法选项` };
        }
        if (new Set(values).size !== values.length) {
          return { ok: false, error: `「${q.title}」选项重复` };
        }
        if (q.minSelect != null && values.length < Number(q.minSelect)) {
          return { ok: false, error: `「${q.title}」至少选择 ${q.minSelect} 个` };
        }
        if (q.maxSelect != null && values.length > Number(q.maxSelect)) {
          return { ok: false, error: `「${q.title}」最多选择 ${q.maxSelect} 个` };
        }
        return { ok: true, value: values };
      }

      case 'text': {
        if (typeof raw !== 'string') {
          return { ok: false, error: `「${q.title}」需为文本` };
        }
        const len = textLength(raw);
        if (q.minLength != null && len < Number(q.minLength)) {
          return { ok: false, error: `「${q.title}」至少 ${q.minLength} 个字` };
        }
        if (q.maxLength != null && len > Number(q.maxLength)) {
          return { ok: false, error: `「${q.title}」最多 ${q.maxLength} 个字` };
        }
        return { ok: true, value: raw };
      }

      case 'number': {
        if (typeof raw !== 'number' && typeof raw !== 'string') {
          return { ok: false, error: `「${q.title}」需为数字` };
        }
        const value = toFiniteNumber(raw);
        if (value === null) {
          return { ok: false, error: `「${q.title}」需为数字` };
        }
        if (q.integerOnly && !Number.isInteger(value)) {
          return { ok: false, error: `「${q.title}」需为整数` };
        }
        if (q.min != null && value < Number(q.min)) {
          return { ok: false, error: `「${q.title}」不能小于 ${q.min}` };
        }
        if (q.max != null && value > Number(q.max)) {
          return { ok: false, error: `「${q.title}」不能大于 ${q.max}` };
        }
        return { ok: true, value };
      }

      default:
        return { ok: false, error: `「${q.title}」题型未知：${q.type}` };
    }
  }

  /**
   * 整卷校验：先按答案计算路径，再只校验路径上的题目。
   * 被跳过的题不要求作答；提交路径外的答案会被拒绝，防止客户端绕过跳转。
   */
  function validateSubmission(survey, answers) {
    const questions = sortQuestions(survey);
    if (questions.length === 0) {
      return { ok: false, error: '问卷没有题目' };
    }
    if (!Array.isArray(answers)) {
      return { ok: false, error: 'answers 必须是数组' };
    }

    const duplicateQuestion = questions
      .map((q) => String(q.qid))
      .find((qid, index, all) => all.indexOf(qid) !== index);
    if (duplicateQuestion) {
      return { ok: false, error: `问卷题目 qid 重复：${duplicateQuestion}` };
    }

    const qMap = questionMap(questions);
    const seen = new Set();
    for (const item of answers) {
      if (!item || item.qid == null) {
        return { ok: false, error: '答案缺少 qid' };
      }
      const qid = String(item.qid);
      if (seen.has(qid)) {
        return { ok: false, error: `题目 ${qid} 重复作答` };
      }
      seen.add(qid);
      if (!qMap.has(qid)) {
        return { ok: false, error: `题目 ${qid} 不存在` };
      }
    }

    const ansMap = answersToMap(answers);
    const walked = walkPath(questions, ansMap);
    if (walked.error) {
      return { ok: false, error: walked.error };
    }

    const onPath = new Set(walked.path);
    for (const qid of seen) {
      if (!onPath.has(qid)) {
        return { ok: false, error: `题目 ${qid} 已被跳转跳过，不能作答` };
      }
    }

    const normalized = [];
    for (const qid of walked.path) {
      const q = qMap.get(qid);
      const result = validateAnswer(q, ansMap.get(qid));
      if (!result.ok) return result;
      if (result.value !== null) {
        normalized.push({ qid, value: result.value });
      }
    }

    return {
      ok: true,
      answers: normalized,
      path: walked.path,
      terminated: walked.terminated
    };
  }

  /**
   * 校验问卷定义（创建/更新/发布时调用）。
   * 题目数组顺序即展示顺序；跳转目标必须位于当前题之后，从结构上杜绝循环。
   */
  function validateSurveyDefinition(input, options) {
    const opts = options || {};
    const rawQuestions = input && Array.isArray(input.questions) ? input.questions : [];
    const errors = [];
    const addError = (message) => {
      if (errors.length < 20) errors.push(message);
    };

    if (!opts.allowEmptyQuestions && rawQuestions.length === 0) {
      addError('问卷至少需要一道题目');
    }
    if (rawQuestions.length > 100) {
      addError('问卷最多 100 道题目');
    }

    const questions = rawQuestions.map((q, index) => normalizeQuestion(q, index));
    const byQid = new Map();
    const indexByQid = new Map();

    questions.forEach((q, index) => {
      const label = `第 ${index + 1} 题`;
      const rawQ = rawQuestions[index] || {};

      // 规范化会把非法数字转成 null，因此先检查原始输入，避免“悄悄修正”。
      ['minSelect', 'maxSelect', 'minLength', 'maxLength', 'min', 'max'].forEach((field) => {
        const rawValue = rawQ[field];
        if (rawValue !== undefined && rawValue !== null && rawValue !== '' &&
          toFiniteNumber(rawValue) === null) {
          addError(`${label}的 ${field} 必须是有效数字`);
        }
      });
      ['required', 'integerOnly'].forEach((field) => {
        if (rawQ[field] !== undefined && typeof rawQ[field] !== 'boolean') {
          addError(`${label}的 ${field} 必须是布尔值`);
        }
      });
      if (rawQ.options !== undefined && !Array.isArray(rawQ.options)) {
        addError(`${label}的 options 必须是数组`);
      }
      if (rawQ.jumps !== undefined && !Array.isArray(rawQ.jumps)) {
        addError(`${label}的 jumps 必须是数组`);
      }

      if (!QID_RE.test(q.qid)) {
        addError(`${label}的 qid 非法（只能包含字母、数字、下划线、短横线，1-32 位）`);
      }
      if (byQid.has(q.qid)) {
        addError(`${label}的 qid 重复：${q.qid}`);
      } else {
        byQid.set(q.qid, q);
        indexByQid.set(q.qid, index);
      }

      if (!QUESTION_TYPES.includes(q.type)) {
        addError(`${label}的题型非法：${q.type}`);
      }
      if (!q.title) {
        addError(`${label}缺少标题`);
      } else if (q.title.length > 200) {
        addError(`${label}标题过长（最多 200 字）`);
      }

      if (q.type === 'single' || q.type === 'multi') {
        if (q.options.length < 2) {
          addError(`${label}至少需要两个选项`);
        }
        const keys = new Set();
        q.options.forEach((o, oi) => {
          if (!o.key) addError(`${label}第 ${oi + 1} 个选项缺少 key`);
          if (!o.label) addError(`${label}第 ${oi + 1} 个选项缺少文字`);
          if (o.key && keys.has(o.key)) addError(`${label}选项 key 重复：${o.key}`);
          if (o.key) keys.add(o.key);
        });
      } else if (q.options.length > 0) {
        addError(`${label}是填空题，不应包含选项`);
      }

      if (q.type === 'multi') {
        if (q.minSelect != null && (!Number.isInteger(q.minSelect) || q.minSelect < 1)) {
          addError(`${label}的最少选择数必须是大于 0 的整数`);
        }
        if (q.maxSelect != null && (!Number.isInteger(q.maxSelect) || q.maxSelect < 1)) {
          addError(`${label}的最多选择数必须是大于 0 的整数`);
        }
        if (q.minSelect != null && q.maxSelect != null && q.minSelect > q.maxSelect) {
          addError(`${label}的最少选择数不能大于最多选择数`);
        }
        if (q.maxSelect != null && q.maxSelect > q.options.length) {
          addError(`${label}的最多选择数不能超过选项总数`);
        }
        if (q.minSelect != null && q.minSelect > q.options.length) {
          addError(`${label}的最少选择数不能超过选项总数`);
        }
      }

      if (q.type === 'text') {
        if (q.minLength != null &&
          (!Number.isInteger(q.minLength) || q.minLength < 0 || q.minLength > 10000)) {
          addError(`${label}的最少字数必须是 0-10000 的整数`);
        }
        if (q.maxLength != null &&
          (!Number.isInteger(q.maxLength) || q.maxLength < 0 || q.maxLength > 10000)) {
          addError(`${label}的最多字数必须是 0-10000 的整数`);
        }
        if (q.minLength != null && q.maxLength != null && q.minLength > q.maxLength) {
          addError(`${label}的最少字数不能大于最多字数`);
        }
      }

      if (q.type === 'number') {
        if (q.min != null && !Number.isFinite(q.min)) addError(`${label}的最小值非法`);
        if (q.max != null && !Number.isFinite(q.max)) addError(`${label}的最大值非法`);
        if (q.min != null && q.max != null && q.min > q.max) {
          addError(`${label}的最小值不能大于最大值`);
        }
      }

      if (!Array.isArray(q.jumps)) {
        addError(`${label}的跳转规则必须是数组`);
      } else if (q.jumps.length > 50) {
        addError(`${label}的跳转规则最多 50 条`);
      }
    });

    // 第二遍：跳转规则依赖全部 qid，必须等 qid 表建好后再校验。
    questions.forEach((q, index) => {
      const label = `第 ${index + 1} 题`;
      if (!Array.isArray(q.jumps)) return;

      if (q.type === 'text' && q.jumps.length > 0) {
        addError(`${label}是文本题，暂不支持跳转`);
        return;
      }

      q.jumps.forEach((jump, ji) => {
        const jumpLabel = `${label}第 ${ji + 1} 条跳转规则`;
        const when = jump.when || {};
        const keys = Object.keys(when);

        if (keys.length !== 1) {
          addError(`${jumpLabel}必须且只能设置一个条件`);
        }

        if (q.type === 'single') {
          if (keys[0] !== 'option') {
            addError(`${jumpLabel}单选题只能按选项跳转`);
          } else if (!(q.options || []).some((o) => String(o.key) === String(when.option))) {
            addError(`${jumpLabel}引用了不存在的选项：${when.option}`);
          }
        } else if (q.type === 'multi') {
          const key = keys[0];
          if (!['includes', 'countAtLeast', 'countAtMost', 'countEquals'].includes(key)) {
            addError(`${jumpLabel}多选题条件非法`);
          } else if (key === 'includes') {
            if (!(q.options || []).some((o) => String(o.key) === String(when.includes))) {
              addError(`${jumpLabel}引用了不存在的选项：${when.includes}`);
            }
          } else {
            const n = when[key];
            if (!Number.isInteger(n) || n < 0 || n > q.options.length) {
              addError(`${jumpLabel}的选择数量必须是 0-${q.options.length} 的整数`);
            }
          }
        } else if (q.type === 'number') {
          if (keys.length !== 2 || !keys.includes('op') || !keys.includes('value')) {
            addError(`${jumpLabel}数字题需要同时设置比较符和数值`);
          } else if (!JUMP_OPS.includes(when.op)) {
            addError(`${jumpLabel}比较符非法：${when.op}`);
          } else if (toFiniteNumber(when.value) === null) {
            addError(`${jumpLabel}比较数值非法`);
          }
        }

        if (jump.goto !== null) {
          if (!indexByQid.has(jump.goto)) {
            addError(`${jumpLabel}的目标题目不存在：${jump.goto}`);
          } else if (indexByQid.get(jump.goto) <= index) {
            addError(`${jumpLabel}只能跳到后面的题目（不支持回跳）：${jump.goto}`);
          }
        }
      });
    });

    return {
      ok: errors.length === 0,
      error: errors[0] || null,
      errors,
      questions
    };
  }

  return {
    QUESTION_TYPES,
    JUMP_OPS,
    normalizeQuestion,
    sortQuestions,
    questionMap,
    answersToMap,
    matchJump,
    walkPath,
    validateAnswer,
    validateSubmission,
    validateSurveyDefinition
  };
});
