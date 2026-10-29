# 九、第二阶段 API、迁移与测试

## 9.1 兼容性约定

第二阶段新增接口都使用 `Authorization: Bearer <token>`。原有接口字段不删除：

- `Survey.questions[]` 新增可选 `sourceQuestionId/sourceVersionId/sourceVersion`；
- `Response.answers[]` 新增可选 `questionId/questionVersionId`；
- 旧问卷/旧答卷没有这些字段，仍按第一阶段逻辑读取和统计。

## 9.2 题库 API

### GET `/api/banks`

返回当前用户的题库；首次调用会自动创建默认题库“我的题库”。

```json
[
  {
    "_id": "6712...",
    "name": "我的题库",
    "description": "系统自动创建的默认题库",
    "isDefault": true,
    "questionCount": 2
  }
]
```

### POST `/api/banks`

```json
{ "name": "课程常用题", "description": "导师组共享" }
```

响应 `201`；同名返回 `409`。

### PUT `/api/banks/:id`

修改 `name/description`，只能操作自己的题库。

### DELETE `/api/banks/:id`

默认题库返回 `409`；题库中仍有题目返回 `409`。

## 9.3 题目 API

### GET `/api/questions`

查询参数：

| 参数 | 说明 |
| --- | --- |
| `scope` | `mine`（默认）/`shared`/`all` |
| `bankId` | 按题库筛选（我的题目） |
| `q` | 标题模糊搜索 |

返回：

```json
{
  "total": 2,
  "items": [
    {
      "id": "6712...",
      "title": "你的年龄段",
      "type": "single",
      "currentVersion": 2,
      "version": { "id": "...", "version": 2, "title": "你的年龄段（细分）", "options": [] },
      "bank": { "id": "...", "name": "我的题库", "isDefault": true },
      "owner": { "id": "...", "username": "demo" },
      "isShared": false,
      "isOwner": true,
      "usageCount": 2,
      "updatedAt": "..."
    }
  ]
}
```

### POST `/api/questions`

```json
{
  "bankId": "可选，缺省用默认题库",
  "title": "你的年龄段",
  "type": "single",
  "options": [
    { "key": "A", "label": "18 岁以下" },
    { "key": "B", "label": "18-25 岁" }
  ],
  "changeNote": "创建题目"
}
```

响应 `201`：

```json
{
  "question": { "id": "...", "currentVersion": 1, "title": "你的年龄段", "type": "single" },
  "version": { "id": "...", "version": 1, "options": [ ... ], "changeNote": "创建题目" },
  "bank": { ... },
  "owner": { ... },
  "permissions": { "isOwner": true, "canEdit": true, "canShare": true }
}
```

校验复用第一阶段题目定义规则：单选/多选至少 2 个选项、文本长度、数字范围、qid 无关等。

### GET `/api/questions/:id`

可选 `?version=1` 查看指定版本；`version` 字段返回指定版本，`currentVersion` 始终返回最新版本。

### PUT `/api/questions/:id`

```json
{
  "title": "你的年龄段（细分）",
  "options": [
    { "key": "A", "label": "18 岁以下" },
    { "key": "B", "label": "18-25 岁" },
    { "key": "C", "label": "26-35 岁" },
    { "key": "D", "label": "36-45 岁" },
    { "key": "E", "label": "46 岁以上" }
  ],
  "changeNote": "增加年龄段"
}
```

- 只有所有者可调用；
- 总是创建新版本，不覆盖旧版本；
- 类型不可变，尝试改类型返回 `400`；
- 返回 `createdVersion`。

### GET `/api/questions/:id/versions`

```json
{
  "questionId": "...",
  "currentVersion": 2,
  "items": [
    {
      "version": 1,
      "title": "你的年龄段",
      "changeNote": "创建题目",
      "parentVersion": null,
      "restoredFromVersion": null,
      "createdAt": "..."
    },
    {
      "version": 2,
      "parentVersion": 1,
      "restoredFromVersion": null
    }
  ]
}
```

### POST `/api/questions/:id/restore`

```json
{ "version": 1, "changeNote": "恢复 v1 的措辞" }
```

会创建 v3（不是把 v2 改成 v1），`restoredFromVersionId` 指向 v1。

### POST `/api/questions/:id/fork`

把当前/指定版本另存为用户自己的新题：

```json
{ "version": 2, "bankId": "可选" }
```

返回新题目（v1），`forkedFromQuestionId/forkedFromVersionId` 记录来源。

### DELETE `/api/questions/:id`

软归档，设置 `archivedAt`；默认列表不再显示，历史版本保留。

## 9.4 共享 API

### POST `/api/questions/:id/share`

```json
{ "username": "shareReceiver" }
```

- 只有所有者；
- 不能共享给自己；
- 目标不存在 `404`；
- 重复共享幂等（唯一索引 + upsert）。

### GET `/api/questions/:id/shares`

```json
[
  { "id": "...", "user": { "id": "...", "username": "shareReceiver" }, "permission": "use", "createdAt": "..." }
]
```

### DELETE `/api/questions/:id/shares/:userId`

取消共享。已使用该题创建的问卷快照不受影响。

## 9.5 使用情况与跨问卷统计

### GET `/api/questions/:id/usage`

只有所有者可调用。

```json
{
  "questionId": "...",
  "totalSurveys": 2,
  "items": [
    {
      "surveyId": "...",
      "title": "题库复用演示 A（年龄 v1）",
      "status": "published",
      "questionCount": 1,
      "questions": [{ "qid": "q1", "version": 1 }],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### GET `/api/questions/:id/stats`

只有所有者可调用；跨所有使用该题的问卷汇总。

```json
{
  "question": { "id": "...", "title": "你的年龄段（细分）", "type": "single", "currentVersion": 2 },
  "surveyCount": 2,
  "versionCount": 2,
  "totalResponses": 4,
  "answeredResponses": 4,
  "type": "single",
  "counts": { "A": 1, "B": 1, "C": 1, "D": 1, "E": 0 },
  "options": [
    { "key": "A", "label": "18 岁以下", "count": 1, "percent": 25 }
  ],
  "currentVersion": { "version": 2, "options": [ ... ] },
  "perVersion": [
    { "version": 2, "answered": 2, "counts": { "A": 0, "B": 0, "C": 1, "D": 1, "E": 0 } },
    { "version": 1, "answered": 2, "counts": { "A": 1, "B": 1, "C": 0, "D": 0 } }
  ],
  "surveys": [
    { "surveyId": "...", "title": "...", "status": "published",
      "totalResponses": 2, "answeredResponses": 2,
      "questions": [{ "qid": "q1", "version": 1 }] }
  ]
}
```

统计口径：

- `totalResponses`：包含该题的问卷全部答卷数；
- `answeredResponses`：其中实际回答该题的人数；
- 单选 `counts` 合计 = `answeredResponses`；
- 多选 `counts` 可超过回答人数；
- 版本拆分按 `questionVersionId`；不同版本选项 label 分别显示。

## 9.6 问卷接口的兼容变化

### POST/PUT `/api/surveys`

题目数组可以带：

```json
{
  "qid": "q1",
  "type": "single",
  "title": "你的年龄段",
  "sourceQuestionId": "6712...",
  "sourceVersionId": "6713...",
  "sourceVersion": 1,
  "options": [ ... ]
}
```

服务端会：

1. 用第一阶段规则校验题目内容；
2. 确认来源题目存在、当前用户有权限；
3. 确认版本属于该题；
4. 固定 `sourceVersion`；
5. 把内容快照保存到 Survey。

无权使用返回 `403`；来源/版本不存在返回 `400`。

### POST `/api/responses/:code`

服务端在保存答案时自动补：

```json
{
  "qid": "q1",
  "value": "A",
  "questionId": "6712...",
  "questionVersionId": "6713..."
}
```

非题库题为 null，旧答卷仍可读。

## 9.7 数据迁移脚本

`scripts/migrate-stage2.js`（可重复执行）：

- 为每个用户补默认题库；
- 为来源问卷补齐 `sourceVersionId/sourceVersion`；
- 为来源答卷的答案补 `questionId/questionVersionId`；
- 不删除旧字段、不改旧问卷内容。

执行：

```bash
pnpm db:init
pnpm migrate:stage2
pnpm seed
```

## 9.8 第二阶段自动化测试

新增 `tests/questions.test.js`，共 **11** 个测试：

| # | 用例 | 结果 |
| --- | --- | --- |
| 1 | 默认题库自动创建、创建题目 v1 | 通过 |
| 2 | 修改生成 v2，v1 内容不变 | 通过 |
| 3 | 恢复 v1 生成 v3，记录恢复来源 | 通过 |
| 4 | 题目类型不能跨版本修改 | 通过 |
| 5 | 共享后对方可见/只读，可另存 | 通过 |
| 6 | 问卷保存版本快照，题库更新不影响旧问卷 | 通过 |
| 7 | 所有者查看题目被哪些问卷使用 | 通过 |
| 8 | 共享用户不能查看使用情况 | 通过 |
| 9 | 取消共享后旧问卷快照仍可读取 | 通过 |
| 10 | 同一题在两个问卷/两个版本的跨问卷统计 | 通过 |
| 11 | 共享用户不能查看跨问卷统计 | 通过 |

全量测试结果：

```text
Test Suites: 7 passed, 7 total
Tests:       81 passed, 81 total
```

原有 70 个第一阶段测试全部保留并通过，证明旧功能未被破坏。

## 9.9 浏览器 E2E

`pnpm test:e2e` 新增检查：

- 打开题目库，至少 2 道题；
- 打开“你的年龄段”历史版本，至少 2 个版本；
- 打开跨问卷统计，使用问卷数 ≥2；
- 新建问卷时从题库添加题目，出现“题库来源 vN”提示；
- 发布后锁定结构；
- 其余第一阶段登录/填写/必答/登录限制检查继续通过。

截图：

- `docs/screenshots/06-library.png`
- `docs/screenshots/07-question-stats.png`

## 9.10 测试局限

- 未做共享用户的并发访问压力测试；
- 未做超大数据量下跨问卷聚合性能测试；
- 未覆盖所有版本组合（单选/多选/文本/数字）的跨问卷统计，但核心单选已覆盖，其余复用同一统计结构；
- 浏览器 E2E 依赖本机 Chrome/Edge。
