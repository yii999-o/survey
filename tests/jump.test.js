const Engine = require('../shared/survey-engine');

function baseSurvey() {
  return {
    questions: [
      {
        qid: 'q1', order: 0, type: 'single', title: '入口题', required: true,
        options: [{ key: 'A', label: '走捷径' }, { key: 'B', label: '走普通路径' }],
        jumps: [{ when: { option: 'A' }, goto: 'q3' }]
      },
      { qid: 'q2', order: 1, type: 'text', title: '被跳过的必答题', required: true },
      { qid: 'q3', order: 2, type: 'number', title: '数字题', required: false },
      { qid: 'q4', order: 3, type: 'text', title: '最后一题', required: false }
    ]
  };
}

describe('跳转引擎', () => {
  test('单选题命中规则时跳过中间题目', () => {
    const result = Engine.walkPath(baseSurvey(), { q1: 'A' });
    expect(result.error).toBeNull();
    expect(result.path).toEqual(['q1', 'q3', 'q4']);
  });

  test('单选题未命中时按顺序进入下一题', () => {
    const result = Engine.walkPath(baseSurvey(), { q1: 'B' });
    expect(result.path).toEqual(['q1', 'q2', 'q3', 'q4']);
  });

  test('goto=null 时提前结束问卷', () => {
    const survey = {
      questions: [
        {
          qid: 'q1', order: 0, type: 'single', title: '是否结束',
          options: [{ key: 'A' }, { key: 'B' }],
          jumps: [{ when: { option: 'A' }, goto: null }]
        },
        { qid: 'q2', order: 1, type: 'text', title: '后续题' }
      ]
    };
    const result = Engine.walkPath(survey, { q1: 'A' });
    expect(result.path).toEqual(['q1']);
    expect(result.terminated).toBe(true);
  });

  test('多选题按包含选项跳转', () => {
    const survey = {
      questions: [
        {
          qid: 'q1', order: 0, type: 'multi', title: '水果',
          options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }],
          jumps: [{ when: { includes: 'C' }, goto: 'q3' }]
        },
        { qid: 'q2', order: 1, type: 'text', title: '中间题' },
        { qid: 'q3', order: 2, type: 'text', title: '目标题' }
      ]
    };
    expect(Engine.walkPath(survey, { q1: ['A', 'C'] }).path).toEqual(['q1', 'q3']);
    expect(Engine.walkPath(survey, { q1: ['A', 'B'] }).path).toEqual(['q1', 'q2', 'q3']);
  });

  test('多选题按选择数量跳转', () => {
    const survey = {
      questions: [
        {
          qid: 'q1', order: 0, type: 'multi', title: '水果',
          options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }],
          jumps: [{ when: { countAtLeast: 2 }, goto: 'q3' }]
        },
        { qid: 'q2', order: 1, type: 'text', title: '中间题' },
        { qid: 'q3', order: 2, type: 'text', title: '目标题' }
      ]
    };
    expect(Engine.walkPath(survey, { q1: ['A', 'B'] }).path).toEqual(['q1', 'q3']);
  });

  test('数字题按比较符跳转', () => {
    const survey = {
      questions: [
        {
          qid: 'q1', order: 0, type: 'number', title: '年龄',
          jumps: [{ when: { op: '>=', value: 18 }, goto: 'q3' }]
        },
        { qid: 'q2', order: 1, type: 'text', title: '未成年题' },
        { qid: 'q3', order: 2, type: 'text', title: '成年题' }
      ]
    };
    expect(Engine.walkPath(survey, { q1: 20 }).path).toEqual(['q1', 'q3']);
    expect(Engine.walkPath(survey, { q1: 17 }).path).toEqual(['q1', 'q2', 'q3']);
  });

  test('多条规则按顺序匹配第一条', () => {
    const survey = {
      questions: [
        {
          qid: 'q1', order: 0, type: 'number', title: '分数',
          jumps: [
            { when: { op: '>=', value: 60 }, goto: 'q3' },
            { when: { op: '>=', value: 0 }, goto: 'q2' }
          ]
        },
        { qid: 'q2', order: 1, type: 'text', title: '低分' },
        { qid: 'q3', order: 2, type: 'text', title: '及格' }
      ]
    };
    expect(Engine.walkPath(survey, { q1: 80 }).path).toEqual(['q1', 'q3']);
    expect(Engine.walkPath(survey, { q1: 30 }).path).toEqual(['q1', 'q2', 'q3']);
  });

  test('被跳过的必答题不参与整卷校验', () => {
    const result = Engine.validateSubmission(baseSurvey(), [{ qid: 'q1', value: 'A' }]);
    expect(result.ok).toBe(true);
    expect(result.path).toEqual(['q1', 'q3', 'q4']);
    expect(result.answers).toEqual([{ qid: 'q1', value: 'A' }]);
  });

  test('路径外答案被拒绝', () => {
    const result = Engine.validateSubmission(baseSurvey(), [
      { qid: 'q1', value: 'A' },
      { qid: 'q2', value: '不应提交' }
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('已被跳转跳过');
  });
});

describe('问卷定义校验', () => {
  test('跳转目标必须存在于问卷中', () => {
    const result = Engine.validateSurveyDefinition({
      questions: [{
        qid: 'q1', type: 'single', title: '题',
        options: [{ key: 'A', label: 'A' }, { key: 'B', label: 'B' }],
        jumps: [{ when: { option: 'A' }, goto: 'q9' }]
      }]
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('目标题目不存在');
  });

  test('禁止回跳和跳到自身', () => {
    const result = Engine.validateSurveyDefinition({
      questions: [
        {
          qid: 'q1', type: 'single', title: '第一题',
          options: [{ key: 'A', label: 'A' }, { key: 'B', label: 'B' }],
          jumps: [{ when: { option: 'A' }, goto: 'q1' }]
        },
        { qid: 'q2', type: 'text', title: '第二题' }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('只能跳到后面的题目');
  });

  test('qid 重复被拒绝', () => {
    const result = Engine.validateSurveyDefinition({
      questions: [
        { qid: 'q1', type: 'text', title: 'A' },
        { qid: 'q1', type: 'text', title: 'B' }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('qid 重复');
  });

  test('文本题不支持跳转', () => {
    const result = Engine.validateSurveyDefinition({
      questions: [
        { qid: 'q1', type: 'text', title: '文本', jumps: [{ when: { option: 'A' }, goto: null }] },
        { qid: 'q2', type: 'text', title: '下一题' }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('文本题');
  });

  test('多选题数量范围校验', () => {
    const result = Engine.validateSurveyDefinition({
      questions: [{
        qid: 'q1', type: 'multi', title: '水果', minSelect: 3, maxSelect: 2,
        options: [{ key: 'A', label: 'A' }, { key: 'B', label: 'B' }]
      }]
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('最少选择数不能大于最多选择数');
  });

  test('合法问卷返回规范化题目', () => {
    const result = Engine.validateSurveyDefinition({
      questions: [{
        qid: 'q1', type: 'single', title: '  标题  ', required: true,
        options: [{ key: 'A', label: ' 选项 A ' }, { key: 'B', label: '选项 B' }],
        jumps: [{ when: { option: 'A' }, goto: 'q2' }]
      }, {
        qid: 'q2', type: 'number', title: '数字', min: 0, max: 120, integerOnly: true
      }]
    });
    expect(result.ok).toBe(true);
    expect(result.questions[0].title).toBe('标题');
    expect(result.questions[0].options[0].label).toBe('选项 A');
    expect(result.questions[0].order).toBe(0);
  });
});
