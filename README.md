# AIDE

**Agent 驱动的多语言 Web IDE** —— 没有编辑区，只有项目、Agent 和 Git/SVN。

> 当前阶段：**P1–P7 已完成，进入多语言 + SVN + 项目知识迭代。** 单端口 `pnpm start`（7800）即可使用：项目经理通过 MCP 调度 Agent，每个 Agent 独立 worktree，提交走测试门禁，运行实例带端口池与内存准入。
>
> 整体说明与迭代记录：[docs/aide-overview.html](docs/aide-overview.html)
> · 0.1.0 → 0.3.0 逐项更新：[docs/changelog-0.1.0-to-0.3.0.html](docs/changelog-0.1.0-to-0.3.0.html)

### 支持的项目类型

| 类型 | 识别依据 | 测试门禁 | 运行预览 |
|------|----------|----------|----------|
| Java | `pom.xml` / `build.gradle*` / `src/main/java` | `mvnw/mvn test`、`gradlew/gradle test` | `spring-boot:run` / `bootRun` |
| Python | `pyproject.toml` / `requirements.txt` / `manage.py` | `pytest`、Django `test`、`unittest` | FastAPI（uvicorn）、Flask、Django、`main.py` |
| Node / JS / TS | `package.json`（Vite / Next / Nest / Express 等） | `npm`/`pnpm`/`yarn`/`bun` 的 `test` 脚本 | `dev`/`start` 脚本，Vite/Next 自动带端口与 `127.0.0.1` |
| Go / Rust | `go.mod` / `Cargo.toml` | `go test ./...` / `cargo test` | `go run .` / `cargo run` |
| 静态 HTML | `index.html` | 跳过 | `python -m http.server` |

技术栈会在项目列表/会话系统提示中显示；无法识别时可在项目设置里手动填写 `testCommand` / `runCommand`。
「设置 → 开发工具链」可配置或自动检测 JDK、Maven、Python、Node。

### 版本控制

| 类型 | 识别 | 能力 | 限制 |
|------|------|------|------|
| Git | `.git` | 每会话独立 worktree + 分支，状态/日志/差异、提交/推送、合并 | 需要 Git |
| SVN | `.svn` | 共享工作副本，状态/日志/差异、`svn commit` | 需要 `svn` 命令行客户端；没有独立 worktree / 分支合并 |
| 无 | 其他目录 | 文件树、Agent、测试门禁、运行预览 | 不支持提交 |

SVN 项目注册时读取 `svn info` 的 `relative-url` 作为分支展示；提交前同样会运行测试门禁，并支持 `.aide` 等本地目录过滤。

### 项目知识 `.aide/`

- 添加项目时自动创建 `<项目>/.aide/`；检测 `CLAUDE.md`、`CLAUDE.local.md`、`.claude/CLAUDE.md`、`AGENTS.md`、`.cursorrules` 等现成资料；
- 项目头部「项目知识」按钮 → 「生成知识」，调用 Claude 阅读项目/版本库日志，生成：
  - `.aide/PROJECT.md`：概览、技术栈、目录、启动/测试命令、约定；
  - `.aide/KNOWLEDGE.md`：架构决策、踩坑点（Agent 可用 `aide_note` 追加）；
  - `.aide/HISTORY.md`：项目历史快照；
- 知识会注入所有 Agent 的系统提示，后续 Agent 不用重复踩坑；`.aide` 默认不纳入 Git，SVN 状态中也会过滤。

---

## 目录

```
C:\path\to\AIDE
├─ docs/
│  ├─ 01-需求分析与开发计划.md      需求拆解、架构草案、风险
│  ├─ 02-技术决策与实施方案.md      已确认的技术决策、实施记录
│  ├─ aide-overview.html            产品整体说明与迭代记录（自包含）
│  ├─ changelog-0.1.0-to-0.3.0.html 0.1.0 → 0.3.0 更新总结（自包含）
│  └─ preview/                      原型与实机截图
├─ prototype/                       前端（React 19 + Vite + Tailwind 4）
│  ├─ src/
│  └─ public/
├─ server/                          后端（Fastify + SQLite + claude 运行时 + MCP）
│  ├─ src/
│  ├─ mcp/aide-mcp.mjs              项目经理 MCP 工具桥
│  └─ README.md                     API、SSE、会话/提交/运行说明
├─ sandbox/py-demo/                 Python + Flask 示例（pytest / 运行预览）
├─ sandbox/ts-demo/                 TypeScript + Vite 示例（Vitest / 运行预览）
├─ sandbox/plain-demo/              无版本控制项目示例
├─ scripts/dev.mjs                  同时启动前后端
├─ package.json                     根脚本（setup / dev / build / start）
└─ README.md
```

---

## 快速开始（正式版 · 单端口）

```bash
cd AIDE
pnpm setup        # 安装 server 与 prototype 依赖
pnpm build        # 构建前端 + 后端
pnpm start        # http://127.0.0.1:7800  （API + 前端静态资源）
```

开发模式（前后端分开、前端 HMR）：

```bash
pnpm dev          # server 7800 + web 5180
```

要求：Node 24+、Git（可选）、SVN 命令行客户端（可选）、已安装并登录的 `claude` CLI（v2.1+）。

> **未安装 Claude Code CLI 时**：AIDE 仍可启动、注册项目、浏览文件树与设置；顶部会出现红色提示，
> 创建 Agent / 发送消息 / 派发 / 协作会返回 503 并说明安装地址。安装并登录后点击「重试检测」即可。
>
> **删除项目**：在左侧项目图标上右键 →「删除项目」。只删除 AIDE 中的项目记录、会话、消息与 worktree，
> 磁盘上的项目文件、Git/SVN 仓库和未合并分支都会保留。
>
> 项目目录**不要求是 Git 仓库**：Git 项目会为每个 Agent 创建独立 worktree 并支持提交/分支；SVN 项目使用共享工作副本；
> 其他目录直接在主目录运行，跳过提交与分支相关能力。SVN 需要安装 `svn` 命令行客户端（如 SlikSVN / TortoiseSVN CLI）。

## 快速开始（后端）

```bash
cd server
pnpm install
pnpm dev        # http://127.0.0.1:7800
```

先注册一个本地目录（Git 可选），再建会话：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:7800/api/projects `
  -ContentType 'application/json' `
  -Body (@{ name='py-demo'; path='C:\path\to\AIDE\sandbox\py-demo' } | ConvertTo-Json)

# 之后：POST /api/projects/:id/sessions 建会话，POST /api/sessions/:sid/messages 发消息，
# GET /api/events 订阅 SSE（session.status / session.message / session.result）
```

API 与事件格式见 [server/README.md](server/README.md)。

---

## 打包 Windows 安装包（内部测试）

```powershell
pnpm package:win                  # 构建 web/server + 单文件服务端 bundle + ZIP + 安装包
node scripts/package.mjs --skip-build   # 复用已有 dist，仅重新打包
```

前置：Node 24、pnpm、Inno Setup 6（`choco install innosetup -y`，默认安装到 Program Files (x86)）。
产物在 `dist-package/`：

- `AIDE-0.3.0-win-x64.zip`：免安装，解压后双击 `start-aide.cmd`；
- `AIDE-Setup-0.3.0.exe`：用户级安装（`%LOCALAPPDATA%\Programs\AIDE`），带开始菜单、停止快捷方式与卸载。

打包内容：自带 `node.exe`；服务端用 esbuild 打成单文件 ESM（不携带 node_modules）；前端在 `app/web`；
MCP 脚本在 `app/server/mcp`。运行数据在 `%APPDATA%\AIDE`（可用 `AIDE_DATA` 覆盖），默认端口 7800（可用 `AIDE_PORT` 覆盖）。
停止：关闭启动窗口，或运行 `stop-aide.cmd`（按 `server.pid` 杀进程树，含 Agent 子进程）。
安装包未签名，SmartScreen 会提示未知发布者；安装向导为英文（内部测试用）。

## 使用方式

1. 启动 AIDE 后注册本地项目（Git / SVN / 普通目录均可）。
2. 对「项目经理」描述目标；它按模块拆解并派发给负责人，不亲自写代码。
3. 模块 Agent 在 Git worktree（或 SVN 共享工作副本）中开发，运行测试并汇报。
4. 检查变更 → 测试门禁 → AI 提交信息 → `git push` / `svn commit`。
5. 启动运行实例查看预览；Agent 用 `aide_note` 把踩坑记录到 `.aide/KNOWLEDGE.md`。

## 正式开发进度

| 阶段 | 状态 | 说明 |
|------|------|------|
| P1 服务骨架 | ✅ | Fastify + `node:sqlite`、项目注册、文件树、Git 只读、SSE |
| P2 Agent 运行时 | ✅ | 真实 claude 长驻进程、流式事件、停止 / `--resume`、回合排队、成本统计 |
| P2.5 前端联调 | ✅ | 项目/文件树/Git/会话全部接真实 API，SSE 实时状态与消息，去掉 Mock |
| P3 Worktree | ✅ | 每 Worker 会话独立 worktree + `aide/*` 分支，`.aide/` 自动排除；P5 接入合并 |
| P4 项目经理 | ✅ | MCP 工具桥：查看 / 新建 / 派发 Agent、Git 状态与提交；派发卡片展示理由与置信度 |
| P5 Git 流水线 | ✅ | 会话级提交、AI 提交信息、测试门禁、强制提交审计、`--no-ff` 合并 + 冲突回滚 |
| P6 运行预览 | ✅ | 端口池 18080–18120、会话级实例、日志 SSE、内存准入、新标签预览 |
| P7 打磨 | ✅ | 单端口托管前端、项目设置、Ctrl+K、完成通知、分支/worktree 清理、根脚本 |

已验证：真实 claude 两轮对话、排队、停止后恢复、重启后恢复；前端创建会话 → Agent 在独立 worktree 工作 → 主工作区保持干净；删除会话回收 worktree；提交 → 测试门禁 → 强制提交 → 推送 → 合并全链路（含冲突回滚）；项目经理通过 MCP 新建并派发 Agent，Worker 收到任务并回执；运行实例按会话启动、端口冲突/自动分配、日志 SSE、停止释放端口、内存准入拒绝。

---

## 反馈修正（2026-11-16）

| # | 反馈 | 处理 |
|---|------|------|
| 1 | Markdown 代码块未渲染 | 接入 `react-markdown` + GFM：代码块/表格/列表/引用/链接，代码块带语言与复制 |
| 2 | Java/Maven 配置应全局、对 Agent 可见、可自动检索 | 「设置 → 工具链」：自动扫描并验证 JDK/Maven，保存后注入所有 Agent、测试门禁、运行实例与系统提示 |
| 3 | 头像与左下角设置是 Mock | 头像与菜单使用 `git config` 真实身份；头像菜单与左下角齿轮均打开真实设置弹窗 |
| 4 | 计费如何计算，需支持 Token/费用选择 | 汇总 claude 每轮 `total_cost_usd` 与 token；新增「费用 + Token / 仅费用 / 仅 Token」显示切换 |
| 5 | 新增项目要能选择文件夹 | 新增 `/api/fs/list` 与文件夹选择器（盘符、目录、手输路径） |
| 6 | 应支持非 Git 项目 | 注册不再要求 `.git`：非 Git 项目直接在主目录运行，禁用提交/分支/合并 |
| 7 | 限制原因 | 见 [02-技术决策与实施方案.md §16.7](docs/02-技术决策与实施方案.md) |

### 第二轮反馈（2026-11-16 深夜）

| # | 反馈 | 处理 |
|---|------|------|
| 1 | 文件夹选择 UI 展示不全 | 选择器改为 Portal 挂到 body，脱离父弹窗裁剪；1280×720 下标题/列表/底部完整 |
| 2 | JDK/Maven 缺失时 AI 自动安装 | 「设置 → 工具链」新增“让 Agent 自动安装”：winget → choco → 镜像下载，实时日志/取消，校验后写入设置；实测装好 JDK 21.0.13 + Maven 3.10.1 |
| 3 | 派发卡片状态实时更新 | 新增 dispatches 表，目标完成/失败自动回写并推送；卡片显示执行中/已完成/失败/已撤销，撤销只允许执行中的派发 |
| 4 | 经理应按模块分配，而不是并行开发 | 经理改为模块调度者：一个模块一个负责人（前后端都归它），跨模块才拆分；禁止并行拆同一模块；禁止经理本人改代码/跑命令 |
| 5 | 经理只汇报与调度，Agent 自设标题 | 经理进程限制为只读工具（实测无法 Bash）；每个 Worker 挂 `aide_set_title`，按模块自动改标题并实时同步到 UI |

### 第三轮反馈（2026-11-17）

| # | 反馈 | 处理 |
|---|------|------|
| 1 | 模块间配合时 Agent 要互相可见、可通信 | Worker 增加 `aide_list_agents` / `aide_message_agent` / `aide_read_agent`；新增 peer 消息接口与“跨模块协作”卡片；实测订单模块 ↔ 后端工程师双向通信 |
| 2 | 模块聚合不等于禁止并行 | 经理提示改为“模块独立/接口对齐时可并行，同模块不拆；有依赖先对齐接口”；实测经理明确回答可并行及前提 |
| 3 | 新建 Agent 仍要选角色、填名称 | 弹窗改为只填「模块 / 任务」，统一为模块负责人；标题由 Agent 启动后自动设置（实测 16.5s 自动改名） |

---

## 已确认的技术决策

| 决策 | 结论 |
|------|------|
| AIDE 自身栈 | Node.js + TypeScript（Fastify）+ React 19 + Vite + Tailwind（与被开发项目语言解耦） |
| Agent 引擎 | 每会话一个长驻 `claude.exe`，stdin/stdout 双向 `stream-json` |
| 会话恢复 | 持久化 `claude_session_id`，进程退出后用 `--resume` 重建 |
| 项目经理 | 自身是 claude 会话，通过 MCP 工具（`aide_*`）列会话、派发、新建、提交 |
| 并发隔离 | 每会话独立 **git worktree + 分支**（`aide/<slug>`），基线 = 创建时 main HEAD |
| 分支回收 | 会话完成后合并回 main；冲突时拉起合并 Agent |
| 一键提交 | 专用临时 Git 会话生成提交信息，后端执行 `git add/commit/push` |
| 提交门禁 | 提交前可自动跑 `mvn test`，失败即中止；强制提交需二次确认并写审计 |
| 派发卡片 | 展示判断依据 + 置信度，支持改派 / 撤销；撤销会通知目标 Agent 回滚 |
| 会话状态 | 运行/思考/空闲/排队/异常/已停止 + **等待确认/等待授权** |
| 运行预览 | 每 worktree 独立实例，端口池可手工改，预览在新标签打开；资源水位超阈值拒绝启动 |
| 外观 | 深空 / 浅色双主题 + 三档界面缩放，localStorage 记忆 |
| 权限 | `bypassPermissions` 全自动 + 路径/命令护栏 |
| 存储 | SQLite（`node:sqlite`，零原生依赖） |

细节见 [技术决策与实施方案](docs/02-技术决策与实施方案.md)。

---

## 当前环境基线

- Claude Code CLI **2.1.224**（Windows 原生 `claude.exe`）；
- Node 24.15 / pnpm 11；Fastify 5 + React 19 + Vite；
- JDK 21 / Maven 3.10 / Python 3.14 / Node 24（可在「设置 → 工具链」配置）；
- Git 2.54；SVN 客户端 SlikSVN（可选，SVN 项目需要）。

## 当前状态

- 当前版本 **0.3.0**（2026-11-18），内部测试；
- 产品整体说明与迭代记录：[docs/aide-overview.html](docs/aide-overview.html)；
- 0.1.0 → 0.3.0 逐项更新：[docs/changelog-0.1.0-to-0.3.0.html](docs/changelog-0.1.0-to-0.3.0.html)；
- 已知限制见 [02-技术决策与实施方案 §22.5](docs/02-技术决策与实施方案.md)：SVN 共享工作副本、知识生成提示词约束、混合前后端单主类型、仅 Windows x64/未签名。
