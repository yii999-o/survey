# 基于 MongoDB 的在线问卷系统（第一阶段）

一个简化版“问卷星 / Google Forms”：

- 注册用户创建问卷，设置题型、校验规则和跳转逻辑；
- 发布后生成 `/survey/:code` 分享链接；
- 登录用户或匿名用户填写，服务端按答题路径校验；
- 创建者查看实时统计（选项人数、多选次数、数字平均值、文本原文）。

> **阶段说明**：本仓库完成的是课程项目的**第一阶段**。第二阶段需求变更尚未发布，因此没有虚构“第二阶段已完成”。数据库中的 `schemaVersion`、`status`、`jumps` 等字段和共享逻辑模块为后续迭代预留了扩展点，详见 [项目完成报告](docs/07-项目完成报告.md)。

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
| 数据 | MongoDB 三集合、JSON Schema 校验、索引、Mongoose 模型 |

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

### 4. 初始化数据库并导入演示数据（可选）

```bash
pnpm db:init
pnpm seed
```

`db:init` 会创建集合、MongoDB JSON Schema 校验器和索引；`seed` 会创建演示用户和一份含跳转的问卷。

### 5. 启动

```bash
pnpm start
# 开发模式：pnpm dev
```

打开 <http://localhost:3000>。

演示账号：

- 用户名：`demo`
- 密码：`demo123`
- 公开问卷：<http://localhost:3000/survey/democode0001>

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

最近一次结果：**6 个测试套件、70 个测试全部通过**。详细用例见 [测试用例文档](docs/05-测试用例.md)。

浏览器端到端（需先启动应用和 MongoDB，且本机有 Chrome/Edge）：

```bash
pnpm test:e2e
```

它会验证登录、我的问卷、统计、编辑发布、跳转填写、必答提示、登录限制，并自动清理测试数据；截图在 `docs/screenshots/`。

## 界面截图

| 我的问卷 | 统计结果 |
| --- | --- |
| ![我的问卷](docs/screenshots/01-dashboard.png) | ![统计结果](docs/screenshots/02-stats.png) |

| 编辑问卷 | 填写与跳转 |
| --- | --- |
| ![编辑问卷](docs/screenshots/03-edit.png) | ![填写与跳转](docs/screenshots/04-fill.png) |

## 目录结构

```text
survey/
├─ src/
│  ├─ app.js                  Express 应用、静态资源与 /survey/:code
│  ├─ server.js               启动、优雅退出
│  ├─ config.js               环境变量
│  ├─ db.js                   MongoDB 连接
│  ├─ models/                 User / Survey / Response（Mongoose）
│  ├─ routes/                 auth / surveys / responses
│  ├─ services/               校验、跳转、统计
│  ├─ middleware/             JWT、错误处理
│  └─ utils/                  异步包装、分享码
├─ shared/
│  └─ survey-engine.js        前后端共用的跳转与校验引擎（UMD）
├─ public/                    HTML / CSS / 浏览器脚本
├─ tests/                     Jest + Supertest
├─ scripts/                   db:init、seed、静态检查
├─ docs/                      设计、数据库、API、测试、AI 日志、报告
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
- [项目完成报告](docs/07-项目完成报告.md)

## 关键设计一句话

- **题目嵌入 Survey**：一次查询拿到整卷和跳转规则，适合“整卷读取”的填写场景。
- **答案嵌入 Response**：一份答卷原子写入，统计用聚合管道按题分组。
- **跳转规则数据化**：`jumps[].when` 描述条件，`goto` 指向 qid；不在代码里写死具体题目。
- **前后端共用引擎**：`shared/survey-engine.js` 同时被 Node.js 和浏览器加载，避免两套逻辑漂移。
- **发布后锁定题目结构**：保证历史答卷的 qid 与题目含义一致。

## 已知边界

- 匿名填写无法可靠识别“同一个人”，`allowMultiple=false` 的重复限制只对登录用户生效。
- 题目发布后不允许改结构；如需改题，应新建问卷（第二阶段可扩展“问卷版本”）。
- 文本/数字题暂不支持按内容跳转；第一阶段需求只要求单选、多选、数字跳转。
- 测试依赖本机 `mongod` 可执行文件。
