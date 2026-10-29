# 三、API 说明

## 3.1 基本约定

- Base URL：`http://localhost:3000`
- 数据格式：`application/json; charset=utf-8`
- 认证：除注册、登录、公开问卷读取、提交答卷外，均需请求头：

```http
Authorization: Bearer <JWT>
```

- ObjectId 在 JSON 中以 24 位十六进制字符串返回。
- 时间使用 ISO 8601（UTC）字符串。
- 错误统一格式：

```json
{
  "error": "人类可读的错误信息",
  "details": ["可选：多条校验错误"]
}
```

- 字段校验失败返回 `400`；未登录 `401`；无权限/不存在 `404`（不泄露资源存在性）；状态冲突 `409`；问卷关闭/截止 `410`。

## 3.2 接口总表

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 否 | 服务与数据库状态 |
| POST | `/api/auth/register` | 否 | 注册 |
| POST | `/api/auth/login` | 否 | 登录 |
| GET | `/api/auth/me` | 是 | 当前用户 |
| POST | `/api/surveys` | 是 | 创建问卷（草稿） |
| GET | `/api/surveys` | 是 | 我的问卷列表 |
| GET | `/api/surveys/by-code/:code` | 可选 | 按分享码读取公开问卷 |
| GET | `/api/surveys/:id` | 是 | 我的问卷详情 |
| PUT | `/api/surveys/:id` | 是 | 修改元数据/草稿题目 |
| DELETE | `/api/surveys/:id` | 是 | 删除草稿 |
| POST | `/api/surveys/:id/publish` | 是 | 发布 |
| POST | `/api/surveys/:id/close` | 是 | 关闭 |
| GET | `/api/surveys/:id/stats` | 是 | 统计（可 `?qid=`） |
| POST | `/api/responses/:code` | 可选 | 提交答卷 |
| GET | `/api/responses/survey/:id` | 是 | 答卷明细 |

---

## 3.3 健康检查

### GET `/api/health`

响应 `200`：

```json
{ "ok": true, "db": "connected", "time": "2026-10-22T10:14:54.544Z" }
```

`db` 为 `connected` 或 `disconnected`。

---

## 3.4 认证

### POST `/api/auth/register`

请求：

```json
{ "username": "alice", "password": "secret123" }
```

校验：用户名 3–32 个字符，只含中英文/数字/下划线/点/短横线；密码至少 6 位，UTF-8 编码后不超过 72 字节。

响应 `201`：

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "6712...",
    "username": "alice",
    "createdAt": "2026-10-22T10:00:00.000Z"
  }
}
```

错误：

- `400` 用户名/密码不合规；
- `409` 用户名已存在。

### POST `/api/auth/login`

请求同上。响应 `200`，结构同注册。

错误：`401 用户名或密码错误`（不区分账号不存在与密码错误）。

### GET `/api/auth/me`

响应 `200`：

```json
{ "user": { "id": "6712...", "username": "alice", "createdAt": "..." } }
```

---

## 3.5 问卷管理

### POST `/api/surveys`

创建草稿。`questions` 可省略；创建后仍可通过 `PUT` 补充。

请求：

```json
{
  "title": "课程反馈",
  "description": "请花 1 分钟填写",
  "allowAnonymous": true,
  "allowMultiple": true,
  "deadline": "2026-12-31T15:59:00.000Z",
  "questions": [
    {
      "qid": "q1",
      "type": "single",
      "title": "你的性别",
      "required": true,
      "options": [
        { "key": "A", "label": "男" },
        { "key": "B", "label": "女" },
        { "key": "C", "label": "其他" }
      ],
      "jumps": []
    }
  ]
}
```

`title` 必填，最长 120 字；`description` 最长 2000 字；`deadline` 可为 `null` 或 ISO 时间。

响应 `201`：

```json
{
  "_id": "6712...",
  "ownerId": "6712...",
  "title": "课程反馈",
  "allowAnonymous": true,
  "allowMultiple": true,
  "status": "draft",
  "shareCode": "a1b2c3d4e5f6",
  "publicUrl": "http://localhost:3000/survey/a1b2c3d4e5f6",
  "questions": [ ... ],
  "responseCount": 0,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### GET `/api/surveys`

返回当前用户创建的问卷（不返回 `questions`，减少列表体积），按创建时间倒序。每项附加：

- `publicUrl`：完整填写链接；
- `responseCount`：答卷数量（聚合得到）。

### GET `/api/surveys/:id`

返回自己的问卷完整文档（含 questions）及 `responseCount`。他人问卷返回 `404`。

### PUT `/api/surveys/:id`

可修改：`title`、`description`、`allowAnonymous`、`allowMultiple`、`deadline`。

- `status=draft` 时可同时提交 `questions` 全量覆盖；
- `status=published/closed` 时提交 `questions` 返回 `409`；
- 题目数组的顺序即展示顺序（服务端写入 `order`）。

请求示例（只改题目）：

```json
{
  "questions": [
    {
      "qid": "q1",
      "type": "number",
      "title": "年龄",
      "required": true,
      "min": 0,
      "max": 120,
      "integerOnly": true,
      "jumps": [
        { "when": { "op": ">=", "value": 18 }, "goto": "q2" }
      ]
    },
    { "qid": "q2", "type": "text", "title": "备注" }
  ]
}
```

### DELETE `/api/surveys/:id`

仅草稿、且无答卷时可删除。响应：

```json
{ "ok": true }
```

### POST `/api/surveys/:id/publish`

发布前会重新校验整卷（至少 1 题、跳转目标存在、只能向前跳、截止时间未过）。

响应 `200`：

```json
{
  "status": "published",
  "shareCode": "a1b2c3d4e5f6",
  "url": "/survey/a1b2c3d4e5f6",
  "publicUrl": "http://localhost:3000/survey/a1b2c3d4e5f6"
}
```

重复发布已发布问卷是幂等的，返回相同分享码。已关闭返回 `409`。

### POST `/api/surveys/:id/close`

已发布 → 已关闭。重复关闭幂等。草稿调用返回 `409`。

```json
{ "status": "closed", "closedAt": "2026-10-22T10:20:00.000Z" }
```

### GET `/api/surveys/by-code/:code`

公开填写入口调用的接口。

- `draft`：创建者登录后可以预览；其他人 `403`；
- `closed` / 截止：`410`；
- `allowAnonymous=false` 且未登录：`401`；
- 成功返回填写所需字段，不含 `ownerId`：

```json
{
  "_id": "6712...",
  "shareCode": "a1b2c3d4e5f6",
  "title": "课程反馈",
  "description": "请花 1 分钟填写",
  "allowAnonymous": true,
  "allowMultiple": true,
  "status": "published",
  "deadline": null,
  "publishedAt": "...",
  "questions": [ ... ],
  "serverTime": "...",
  "isOwnerPreview": false
}
```

### GET `/api/surveys/:id/stats`

查询参数：

- `qid`（可选）：只返回该题统计；不存在返回 `404`。

响应：

```json
{
  "surveyId": "6712...",
  "title": "课程反馈",
  "status": "published",
  "totalResponses": 3,
  "questions": [
    {
      "qid": "q1",
      "title": "你的性别",
      "type": "single",
      "required": true,
      "totalAnswers": 3,
      "counts": { "A": 2, "B": 1, "C": 0 },
      "options": [
        { "key": "A", "label": "男", "count": 2, "percent": 66.67 },
        { "key": "B", "label": "女", "count": 1, "percent": 33.33 },
        { "key": "C", "label": "其他", "count": 0, "percent": 0 }
      ]
    },
    {
      "qid": "q2",
      "title": "年龄",
      "type": "number",
      "totalAnswers": 3,
      "average": 30,
      "min": 20,
      "max": 40,
      "values": [20, 30, 40]
    },
    {
      "qid": "q3",
      "title": "备注",
      "type": "text",
      "totalAnswers": 3,
      "values": ["hi", "ok", "yo"]
    }
  ]
}
```

说明：

- `totalResponses` 是问卷全部答卷数；
- `totalAnswers` 是实际回答该题的人数（被跳过的答卷不计入该题）；
- 多选 `counts` 的合计可以超过 `totalAnswers`；`percent = 选项人数 / totalAnswers`，可能超过 100%；
- 数字题 `average` 保留 4 位小数，空数据为 `null`。

---

## 3.6 答卷

### POST `/api/responses/:code`

请求：

```json
{
  "answers": [
    { "qid": "q1", "value": "A" },
    { "qid": "q2", "value": ["A", "C"] },
    { "qid": "q3", "value": 25 },
    { "qid": "q4", "value": "一些建议" }
  ]
}
```

服务端会：

1. 检查问卷已发布、未关闭、未过期；
2. 根据 `allowAnonymous` 检查登录；
3. 用本次答案计算路径；
4. 只校验路径上的题；拒绝路径外答案（防止客户端绕过跳转）；
5. 校验题型、必答、min/max、文本长度、数字范围；
6. 保存 `answers` 和实际 `visitedPath`。

成功 `201`：

```json
{
  "ok": true,
  "responseId": "6712...",
  "submittedAt": "2026-10-22T10:05:00.000Z"
}
```

错误示例：

```json
{ "error": "「水果」至少选择 2 个" }
```

`allowMultiple=false` 且登录用户已提交：`409`。

### GET `/api/responses/survey/:id`

仅问卷所有者。查询参数：`skip`（默认 0）、`limit`（默认 100，最大 500）。

```json
{
  "total": 3,
  "skip": 0,
  "limit": 100,
  "items": [
    {
      "_id": "...",
      "surveyId": "...",
      "respondentId": null,
      "answers": [ ... ],
      "visitedPath": ["q1", "q3"],
      "submittedAt": "..."
    }
  ]
}
```

---

## 3.7 请求示例（PowerShell）

```powershell
$base = "http://127.0.0.1:3000"
$login = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" `
  -ContentType "application/json" `
  -Body (@{ username = "demo"; password = "demo123" } | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.token)" }

# 我的问卷
Invoke-RestMethod -Uri "$base/api/surveys" -Headers $headers

# 统计
$survey = (Invoke-RestMethod -Uri "$base/api/surveys" -Headers $headers)[0]
Invoke-RestMethod -Uri "$base/api/surveys/$($survey._id)/stats" -Headers $headers

# 公开问卷 + 提交
Invoke-RestMethod -Uri "$base/api/surveys/by-code/democode0001"
$body = @{ answers = @(
  @{ qid = "q1"; value = "A" },
  @{ qid = "q3"; value = @("A", "B") },
  @{ qid = "q4"; value = 10 }
) } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "$base/api/responses/democode0001" `
  -ContentType "application/json" -Body $body
```

## 3.8 第二阶段题库 API

完整请求/响应和测试见 [第二阶段 API 文档](09-第二阶段API与测试.md)。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/banks` | 题库列表（自动创建默认题库） |
| POST | `/api/banks` | 创建题库 |
| PUT | `/api/banks/:id` | 重命名/修改说明 |
| DELETE | `/api/banks/:id` | 删除空题库（默认题库不可删） |
| GET | `/api/questions` | 我的/共享/全部题目；`scope`、`bankId`、`q` |
| POST | `/api/questions` | 创建题目 v1 |
| GET | `/api/questions/:id` | 题目详情，可 `?version=1` |
| PUT | `/api/questions/:id` | 修改并生成新版本（仅所有者） |
| DELETE | `/api/questions/:id` | 软归档 |
| GET | `/api/questions/:id/versions` | 版本历史 |
| GET | `/api/questions/:id/versions/:version` | 指定版本内容 |
| POST | `/api/questions/:id/restore` | 恢复旧版为新版本 |
| POST | `/api/questions/:id/fork` | 另存为新题 |
| POST | `/api/questions/:id/share` | 按用户名共享 |
| GET | `/api/questions/:id/shares` | 共享列表 |
| DELETE | `/api/questions/:id/shares/:userId` | 取消共享 |
| GET | `/api/questions/:id/usage` | 被哪些问卷使用（所有者） |
| GET | `/api/questions/:id/stats` | 跨问卷单题统计（所有者） |

### 问卷题目的来源字段

`POST/PUT /api/surveys` 的 `questions[]` 可以额外带：

```json
{
  "sourceQuestionId": "6712...",
  "sourceVersionId": "6713...",
  "sourceVersion": 1
}
```

服务端会校验来源题目/版本、当前用户使用权，并把内容快照保存在问卷中。返回的问卷仍包含完整题目字段。

### 答卷的来源字段

`POST /api/responses/:code` 的请求仍只需要 `qid/value`；服务端自动在 `answers[]` 中补：

```json
{ "questionId": "...", "questionVersionId": "..." }
```

## 3.9 HTTP 状态码

| 状态码 | 场景 |
| --- | --- |
| 200 | 查询/修改/发布/关闭成功 |
| 201 | 注册、创建问卷、创建题目、恢复/另存、提交答卷成功 |
| 400 | 参数格式错误、题目定义非法、答案校验失败 |
| 401 | 未登录、token 失效、问卷要求登录 |
| 403 | 访问未发布问卷（非创建者）、草稿提交 |
| 404 | 资源不存在或无权访问（管理接口） |
| 409 | 用户名重复、发布后改题、重复填写、状态冲突 |
| 410 | 问卷已关闭/已截止 |
| 500 | 未捕获的服务端错误（不返回堆栈） |
