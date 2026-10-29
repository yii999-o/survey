# 基于 MongoDB 的在线问卷系统（第一、二阶段）

一个简化版“问卷星 / Google Forms”：

- 注册用户创建问卷，设置题型、校验规则和跳转逻辑；
- 发布后生成 `/survey/:code` 分享链接，登录用户或匿名用户填写；
- 创建者查看实时统计（选项人数、多选次数、数字平均值、文本原文）；
- **第二阶段**新增题目库、题目共享、不可变版本历史、版本恢复、使用情况查询和跨问卷单题统计。

> **阶段说明**：第一阶段完成账号、问卷、题型、跳转、校验、填写和统计；第二阶段在原有代码上增量扩展，保留第一阶段数据和接口。旧问卷仍可正常打开，新字段均可为空。

## 功能清单

| 模块 | 已实现 |
| --- | --- |
| 用户 | 注册、登录、JWT 鉴权、查看当前用户；只能访问自己的问卷 |
| 问卷 | 创建、读取、修改说明、删除草稿、发布、关闭、截止时间、公开链接 |
| 题型 | 单选、多选、文本填空、数字填空 |
| 校验 | 必答、选项合法性、多选 min/max、文本长度、数字范围/整数 |
| 跳转 | 单选按选项、多选按包含/选择数量、数字按比较符；`goto=null` 提前结束 |
| 填写 | 登录/匿名、条件跳转、前后端同源校验、多人提交、可选重复填写 |
| 统计 | 总答卷数、单选/多选计数与百分比、数字平均/最小/最大、文本列表、按题过滤 |
| **题库** | 默认题库 + 自定义题库、题目创建/编辑/搜索、按题库筛选 |
| **版本** | 不可变版本、修改生成新版本、历史列表、恢复旧版生成新版本、父子/恢复来源 |
| **共享** | 按用户名共享、共享列表、取消共享、共享题只读（可另存为新题） |
| **引用** | 问卷保存题目内容快照 + 来源 `questionId/versionId`；题库更新不影响旧问卷 |
| **使用情况** | 查看某题被哪些问卷使用、qid 和版本 |
| **跨问卷统计** | 单道题在所有使用问卷中的总体统计，按版本拆分 |
| 数据 | MongoDB 七集合、JSON Schema 校验、索引、Mongoose 模型 |

## 技术栈

- Node.js 18+ / Express 4
- MongoDB 6+ / Mongoose 8
- 原生 HTML + CSS + JavaScript（无前端框架，便于阅读和答辩）
- JWT + bcryptjs
- Jest + Supertest（真实 HTTP 接口测试）
- Playwright Core（复用本机 Chrome/Edge，做浏览器端到端检查）

## 快速开始

### 1. 安装依赖

```bash
pnpm install
# 或者 npm install
```

> 仓库包含 `pnpm-workspace.yaml`，将 pnpm 的 `nodeLinker` 设为 `hoisted`，避免 Windows 下符号链接解析问题。

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，至少修改 `JWT_SECRET`：

```bash
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/survey_app
JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=7d
```

### 3. 启动 MongoDB

Windows 示例（路径按本机安装位置调整）：

```powershell
New-Item -ItemType Directory -Force .\data\db
& "D:\Program Files\MongoDB\Server\9.0\bin\mongod.exe" `
  --dbpath (Resolve-Path .\data\db) --port 27017 --bind_ip 127.0.0.1
```

也可以使用已有 MongoDB 服务，只要 `MONGO_URI` 能连接即可。

### 4. 初始化数据库、迁移与演示数据

```bash
pnpm db:init          # 七集合、JSON Schema 校验器、索引
pnpm migrate:stage2   # 可选：为旧数据补默认题库/来源版本/答卷题目 ID
pnpm seed             # demo 用户 + 两份阶段一演示 + 两份题库演示
```

### 5. 启动

```bash
pnpm start
# 开发模式：pnpm dev
```

打开 <http://localhost:3000>。

演示账号：

- 用户名：`demo`
- 密码：`demo123`
- 第一阶段问卷：<http://localhost:3000/survey/democode0001>
- 题库复用 A（年龄 v1）：<http://localhost:3000/survey/demolib00001>
- 题库复用 B（年龄 v2）：<http://localhost:3000/survey/demolib00002>
- 题目库：<http://localhost:3000/library.html>

## 测试

测试会启动一个**独立端口的临时 mongod 进程**，不会修改 `survey_app` 数据库。

```bash
pnpm test
pnpm check
```

如果 `mongod` 不在默认安装路径，设置：

```powershell
$env:MONGOD_BINARY = "C:\path\to\mongod.exe"
pnpm test
```

最近一次结果：**7 个测试套件、81 个测试全部通过**。详细用例见 [测试用例文档](docs/05-测试用例.md)。

浏览器端到端（需先启动应用和 MongoDB，且本机有 Chrome/Edge）：

```bash
pnpm test:e2e
```

它会验证登录、我的问卷、统计、题目库、版本历史、跨问卷统计、从题库添加题目、编辑发布、跳转填写、必答提示和登录限制，并自动清理测试数据；截图在 `docs/screenshots/`。

## 界面截图

| 我的问卷 | 统计结果 |
| --- | --- |
| ![我的问卷](docs/screenshots/01-dashboard.png) | ![统计结果](docs/screenshots/02-stats.png) |

| 编辑问卷 | 填写与跳转 |
| --- | --- |
| ![编辑问卷](docs/screenshots/03-edit.png) | ![填写与跳转](docs/screenshots/04-fill.png) |

| 题目库 | 跨问卷单题统计 |
| --- | --- |
| ![题目库](docs/screenshots/06-library.png) | ![跨问卷统计](docs/screenshots/07-question-stats.png) |

## 目录结构

```text
survey/
├─ src/
│  ├─ app.js                  Express 应用、页面路由
│  ├─ server.js               启动、优雅退出
│  ├─ config.js               环境变量
│  ├─ db.js                   MongoDB 连接
│  ├─ models/                 User/Survey/Response/QuestionBank/Question/QuestionVersion/QuestionShare
│  ├─ routes/                 auth/surveys/responses/banks/questions
│  ├─ services/               校验、跳转、统计、题目库、跨问卷统计
│  ├─ middleware/             JWT、错误处理
│  └─ utils/                  异步包装、分享码
├─ shared/
│  └─ survey-engine.js        前后端共用的跳转与校验引擎（UMD）
├─ public/                    login/dashboard/edit/fill/stats/library/question-stats
├─ tests/                     7 个 Jest 测试文件
├─ scripts/                   db:init / seed / migrate:stage2 / check / e2e-ui
├─ docs/                      系统、数据库、API、逻辑、测试、AI、两份报告
├─ .env.example
├─ pnpm-workspace.yaml
└─ package.json
```

## 文档索引

- [系统说明与总体设计](docs/01-系统说明.md)
- [MongoDB 数据库设计](docs/02-数据库设计.md)
- [API 说明](docs/03-API说明.md)
- [关键逻辑说明（跳转/校验/统计）](docs/04-关键逻辑说明.md)
- [测试用例与结果](docs/05-测试用例.md)
- [AI 使用日志](docs/06-AI使用日志.md)
- [第一阶段项目完成报告](docs/07-项目完成报告.md)
- [第二阶段需求分析与设计](docs/08-第二阶段需求与设计.md)
- [第二阶段 API、迁移与测试](docs/09-第二阶段API与测试.md)
- [第二阶段项目完成报告](docs/10-第二阶段项目完成报告.md)

## 关键设计一句话

- **题目嵌入 Survey**：一次查询拿到整卷和跳转规则，适合“整卷读取”的填写场景。
- **答案嵌入 Response**：一份答卷原子写入，统计用聚合管道按题分组。
- **题库逻辑题 + 不可变版本**：`Question` 指向当前 `QuestionVersion`；修改只新增版本，不覆盖历史。
- **问卷保存快照**：Survey 中保存题目内容 + `sourceQuestionId/sourceVersionId`，题库改版不会改变旧问卷。
- **共享是使用权，不是编辑权**：被共享人可以在问卷中使用或另存，原题只有所有者能改。
- **跨问卷统计按 `answers.questionId` 聚合**：新版答卷在答案上冗余来源 ID，避免扫描所有问卷。

## 已知边界

- 匿名填写无法可靠识别“同一个人”，`allowMultiple=false` 的重复限制只对登录用户生效。
- 共享目前按用户名指定，不支持公开链接共享/团队组织架构。
- 跨问卷单题统计只统计题库来源的题目；第一阶段普通题目仍按单问卷统计。
- 题目类型在版本之间不可变；如需不同类型，应新建题目。
- 测试依赖本机 `mongod` 可执行文件；浏览器 E2E 依赖本机 Chrome/Edge。
