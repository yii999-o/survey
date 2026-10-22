const { validateAnswer, validateSubmission } = require('../src/services/validation');

describe('单题答案校验', () => {
  const single = {
    type: 'single', title: '性别', required: true,
    options: [{ key: 'A' }, { key: 'B' }]
  };

  test('单选必答题为空时报错', () => {
    expect(validateAnswer(single, '').ok).toBe(false);
    expect(validateAnswer(single, undefined).ok).toBe(false);
    expect(validateAnswer(single, []).ok).toBe(false);
  });

  test('单选非法选项报错', () => {
    const result = validateAnswer(single, 'Z');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('选项非法');
  });

  test('单选合法通过', () => {
    expect(validateAnswer(single, 'A')).toEqual({ ok: true, value: 'A' });
  });

  test('非必答题留空通过且值为 null', () => {
    const required = false;
    expect(validateAnswer({ ...single, required }, '')).toEqual({ ok: true, value: null });
  });

  const multi = {
    type: 'multi', title: '水果', minSelect: 2, maxSelect: 3,
    options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }]
  };

  test('多选数量下限和上限', () => {
    expect(validateAnswer(multi, ['A']).ok).toBe(false);
    expect(validateAnswer(multi, ['A', 'B']).ok).toBe(true);
    expect(validateAnswer(multi, ['A', 'B', 'C']).ok).toBe(true);
    expect(validateAnswer(multi, ['A', 'B', 'C', 'D']).ok).toBe(false);
  });

  test('多选重复选项和非法选项报错', () => {
    expect(validateAnswer(multi, ['A', 'A']).ok).toBe(false);
    expect(validateAnswer(multi, ['A', 'Z']).ok).toBe(false);
    expect(validateAnswer(multi, 'A').ok).toBe(false);
  });

  test('文本长度限制按 Unicode 字符计数', () => {
    const q = { type: 'text', title: '简介', minLength: 3, maxLength: 5 };
    expect(validateAnswer(q, 'ab').ok).toBe(false);
    expect(validateAnswer(q, 'abcd').ok).toBe(true);
    expect(validateAnswer(q, '😀😀😀').ok).toBe(true);
    expect(validateAnswer(q, 'abcdef').ok).toBe(false);
  });

  test('数字范围、整数和 0 值', () => {
    const q = {
      type: 'number', title: '年龄', min: 0, max: 120, integerOnly: true,
      required: true
    };
    expect(validateAnswer(q, 25).ok).toBe(true);
    expect(validateAnswer(q, 0)).toEqual({ ok: true, value: 0 });
    expect(validateAnswer(q, '25').ok).toBe(true);
    expect(validateAnswer(q, 25.5).ok).toBe(false);
    expect(validateAnswer(q, -1).ok).toBe(false);
    expect(validateAnswer(q, 130).ok).toBe(false);
    expect(validateAnswer(q, 'abc').ok).toBe(false);
    expect(validateAnswer(q, Infinity).ok).toBe(false);
  });
});

describe('整卷答案校验', () => {
  const survey = {
    questions: [
      {
        qid: 'q1', order: 0, type: 'single', title: '入口', required: true,
        options: [{ key: 'A' }, { key: 'B' }],
        jumps: [{ when: { option: 'A' }, goto: 'q3' }]
      },
      { qid: 'q2', order: 1, type: 'text', title: '中间题', required: true },
      { qid: 'q3', order: 2, type: 'number', title: '数字', min: 0, max: 10 }
    ]
  };

  test('被跳过的必答题不校验', () => {
    const result = validateSubmission(survey, [{ qid: 'q1', value: 'A' }]);
    expect(result.ok).toBe(true);
    expect(result.path).toEqual(['q1', 'q3']);
  });

  test('路径上的必答题缺失时报错', () => {
    const result = validateSubmission(survey, [{ qid: 'q1', value: 'B' }]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('中间题');
  });

  test('路径外答案被拒绝', () => {
    const result = validateSubmission(survey, [
      { qid: 'q1', value: 'A' },
      { qid: 'q2', value: '不该有' }
    ]);
    expect(result.ok).toBe(false);
  });

  test('答案 qid 重复被拒绝', () => {
    const result = validateSubmission(survey, [
      { qid: 'q1', value: 'B' },
      { qid: 'q1', value: 'A' }
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('重复作答');
  });

  test('不存在的题目被拒绝', () => {
    const result = validateSubmission(survey, [
      { qid: 'q1', value: 'B' },
      { qid: 'q9', value: 'x' }
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('不存在');
  });

  test('空问卷提交被拒绝', () => {
    expect(validateSubmission({ questions: [] }, []).ok).toBe(false);
  });
});
