# AIDE Server（P1 服务骨架 + P2 Agent 运行时）

Node 24 + TypeScript + Fastify 5 + `node:sqlite`，负责项目/文件/Git 只读接口、真实 `claude` 会话进程、SSE 事件流。

## 运行方式

```bash
cd server
pnpm install
pnpm dev            # tsc 编译后启动，默认 http://127.0.0.1:7800
```

包含前端构建产物时（`prototype/dist` 存在），服务会直接托管前端，7800 即为完整应用；
根目录的 `pnpm build && pnpm start` 就是这种单端口模式。

环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `AIDE_PORT` | `7800` | 监听端口 |
| `AIDE_HOST` | `127.0.0.1` | 监听地址（默认仅本机） |
| `AIDE_DATA` | `server/data` | SQLite 与运行数据目录 |
| `AIDE_LOG` | `info` | Fastify 日志级别 |
| `CLAUDE_BIN` | 自动探测 | claude 可执行文件路径 |
| `AIDE_CLAUDE_TIMEOUT` | `600000` | 单回合超时（ms） |

`claude` 探测顺序：`CLAUDE_BIN` → `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` → `npm root -g`。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务、claude 版本/是否可用（`claude.available`）、DB、SSE 连接数 |
| GET | `/api/settings` | 全局设置 + 工具链版本 + 本地用户（git config） |
| PATCH | `/api/settings` | `{javaHome?, mavenHome?, pythonPath?, nodePath?, usageDisplay?}`，保存前校验对应可执行文件 |
| POST | `/api/settings/detect` | 扫描 PATH / JAVA_HOME / .jdks / Program Files 等并验证版本 |
| GET | `/api/fs/list?path=` | 文件夹浏览（盘符、父目录、子目录），用于项目选择器 |
| PATCH | `/api/sessions/:sid` | 修改会话标题（Agent 自设模块名），广播 `session.updated` |
| POST | `/api/dispatches/:did/revoke` | 撤销执行中的派发，回写消息状态并广播 |
| GET | `/api/settings/install/status` | AI 工具链安装状态、日志、结果 |
| POST | `/api/settings/install` | 启动 AI 安装 Agent（winget/choco/镜像下载） |
| POST | `/api/settings/install/cancel` | 取消安装 |
| GET | `/api/projects` | 项目列表（含 stack、会话数） |
| POST | `/api/projects` | `{name?, path}` 注册本地目录（Git 可选） |
| GET | `/api/projects/:id` | 项目详情 |
| DELETE | `/api/projects/:id` | 删除项目记录、会话、消息、worktree；保留磁盘目录与分支 |
| GET | `/api/projects/:id/tree?path=` | 懒加载目录（忽略 `.git/node_modules/target/...`，带 git 状态） |
| GET | `/api/projects/:id/file?path=` | 只读文本（≤2MB，二进制拒绝） |
| GET | `/api/projects/:id/knowledge` | 项目知识：来源、`.aide` 文档、任务状态 |
| POST | `/api/projects/:id/knowledge/generate` | 启动 Claude 知识整理任务（只写 `.aide`） |
| GET | `/api/projects/:id/knowledge/status` | 知识任务进度/日志 |
| POST | `/api/projects/:id/knowledge/cancel` | 取消知识任务 |
| POST | `/api/projects/:id/notes` | 追加 `{title, content, sessionId?}` 到 `.aide/KNOWLEDGE.md` |
| GET | `/api/projects/:id/git/status` | Git/SVN 状态（`vcs` 字段区分） |
| GET | `/api/projects/:id/git/log?limit=` | Git/SVN 提交日志（SVN 返回 `rN`） |
| GET | `/api/projects/:id/git/branches` | 仅 Git：本地分支 + ahead/behind |
| GET | `/api/projects/:id/git/diff?path=` | Git/SVN 单文件 diff |
| GET | `/api/projects/:id/sessions` | 会话列表（附 runtime：alive/turnActive/queued） |
| POST | `/api/projects/:id/sessions` | `{title?, role?, model?}` 创建并启动会话 |
| GET | `/api/sessions/:sid` | 会话详情 |
| GET | `/api/sessions/:sid/messages?limit=` | 消息（user/text、assistant/text|thinking|tool_use、tool_result、result） |
| POST | `/api/sessions/:sid/messages` | `{text}` 发送；回合进行中会自动排队 |
| POST | `/api/sessions/:sid/stop` | 杀进程树，状态 `stopped` |
| DELETE | `/api/sessions/:sid` | 停止、删除会话并回收 worktree |
| GET | `/api/sessions/:sid/git/status` | 会话工作区状态（Git worktree / SVN 共享工作副本） |
| POST | `/api/sessions/:sid/git/commit` | Git 提交并推送 / SVN 提交：`{message?, force?, skipTests?}` |
| POST | `/api/projects/:id/git/merge` | `{branch}` 合并到主干（`--no-ff`） |
| POST | `/api/projects/:id/git/prune` | 清理失效 worktree 与已合并的 `aide/*` 分支 |
| PATCH | `/api/projects/:id/settings` | `{testCommand}` 项目级测试命令 |
| POST | `/api/projects/:id/dispatch` | `{sessionId, task, reason?, confidence?, fromSessionId?}` 派发任务 |
| POST | `/api/projects/:id/peer` | `{fromSessionId, toSessionId, text}` 跨模块协作消息（异步，对方回复回到发送方会话） |
| GET | `/api/system` | 内存/CPU/端口池与实例统计 |
| GET | `/api/projects/:id/runs` | 项目运行实例列表（含日志尾部） |
| POST | `/api/sessions/:sid/run` | `{port?, command?}` 启动实例（端口池 18080–18120） |
| POST | `/api/sessions/:sid/run/stop` | 停止实例 |
| GET | `/api/runs/:rid/log?tail=` | 实例日志 |
| GET | `/api/events` | SSE：`hello` / `session.status` / `session.message` / `session.result` / `session.updated` / `dispatch.status` / `git.progress` / `git.done` / `run.status` / `run.log` / `toolchain.install` |

SSE 每条为 `data: {type, sessionId?, projectId?, payload?, at}\n\n`，另有 15s 心跳注释行。

## 会话实现

- 每个会话一个**长驻** `claude -p --input-format stream-json --output-format stream-json --verbose` 进程；
- `--session-id <uuid>` 首次启动，`--resume <uuid>` 恢复（进程退出/服务重启后）；
- `--permission-mode bypassPermissions` + `--add-dir <工作区>`；
- 状态机：`starting → running ⇄ idle`，异常 `error`，手动 `stopped`；
- 回合进行中再发消息进入内存队列，`result` 后自动发送；
- 回合超时（默认 10 分钟）会杀进程并标记 `error`；
- 服务启动时把上次遗留的 `running/starting` 复位为 `idle`（进程已不存在），下次发消息自动 `--resume`；
- 成本/Token/回合数取自 `result` 事件（`total_cost_usd`、`usage`、`num_turns`）并累计入 SQLite。

## Worktree（P3）

- 新建 Worker 会话时自动创建独立工作区与分支：
  `git worktree add -b aide/<slug>-<id6> <project>/.aide/worktrees/<slug>-<id6> <main>`
- `sessions.cwd` 指向 worktree，`sessions.branch` 记录分支；`--add-dir` 与进程 cwd 都用 worktree；
- `.aide/` 会自动写入项目的 `.git/info/exclude`，主工作区保持干净；
- **项目经理**会话跑在主工作区（`main`），不建 worktree；
- 删除会话：`git worktree remove --force`，**保留分支**（合并策略在 P5）；
- 多个 Worker 可并行修改各自 worktree，互不影响。

## Git 流水线（P5）

- `POST /api/sessions/:sid/git/commit`
  - Agent 回合进行中直接拒绝（409 `busy`）；
  - **测试门禁**优先级：项目 `testCommand` → `AIDE_TEST_CMD` → 按技术栈自动检测：
    Maven/Gradle（`mvnw/mvn/gradlew/gradle test`）、Node（`npm/pnpm/yarn/bun test` 脚本）、
    Python（`pytest` / Django `test` / `unittest`）、Go（`go test ./...`）、Rust（`cargo test`）；
  - 未检测到命令：`skipped` 并写明原因（本机未装对应工具链时即如此）；
  - 测试失败：返回 409 + `test.output`，**不提交**；
  - `force: true`：跳过门禁提交，并写入 `audit`（`force_commit`）；
  - `message` 留空：单次 `claude -p` 根据 diff 生成 Conventional Commits，失败则回退为 `chore: 更新 N 个文件`；
  - 成功后 `git add -A` → `git commit` → `git push -u <remote> <branch>`；没有远程仓库时返回 `pushed=false`。
- `POST /api/projects/:id/git/merge`：要求主工作区干净且位于主干；`git merge --no-ff`；
  冲突时收集冲突文件 → `merge --abort` → 409 返回 `conflicts`。
- 审计表 `audit` 记录 `commit`、`force_commit`、`merge`（含分支、sha、信息、是否强制）。
- 提交与合并按项目串行（内存写锁队列），避免并发操作主工作区或重复推送。
- 合并提交只在本地，不会自动推送主干（可后续加"合并并推送"）。

## 项目经理 MCP（P4）

- 「项目经理」会话在 spawn 时自动写入 `data/mcp/<sessionId>.json`，通过 `--mcp-config` 启动
  `mcp/aide-mcp.mjs`（stdio，零依赖，JSON-RPC 2.0）；
- 环境：`AIDE_API`、`AIDE_PROJECT`、`AIDE_SESSION`，工具回调本地 HTTP API；
- 工具：
  | 工具 | 作用 |
  |------|------|
  | `aide_list_sessions` | 列出会话、状态、分支、花费 |
  | `aide_dispatch` | 派发任务（忙时排队），可带理由与置信度 |
  | `aide_create_session` | 新建模块负责人（Git worktree/分支，SVN 共享工作区），标题=模块名 |
  | `aide_rename_session` | 修改某个 Agent 的标题（模块范围变化时） |
  | `aide_message_agent` | 给某个 Agent 发协作消息（模块间对齐接口/传递信息） |
  | `aide_read_agent` | 读取某个 Agent 最近的文本/结论 |
  | `aide_note` | 追加踩坑/决策到项目 `.aide/KNOWLEDGE.md` |
  | `aide_git_status` | 查看会话或主工作区变更 |
  | `aide_commit_push` | Git 提交并推送 / SVN 提交（走测试门禁，失败返回输出） |
  | `aide_run_app` | 启动某个会话的预览实例（端口池，受内存准入） |
  | `aide_stop_app` | 停止实例 |
- **经理只做调度与汇报**：spawn 时附带 `--tools Read,Glob,Grep`，编辑/命令/子代理工具不可用，无法改代码或提交；
- 路由模型是**功能模块负责人**：一个模块只有一个 Agent，负责该模块前后端全部改动；经理按用户任务涉及的模块派发，
  没有负责人时新建（标题=模块名，角色=模块负责人）；同一模块不得拆给多个 Agent；
- **允许并行**：模块之间互不依赖（或接口已对齐）时可以同时派发、并行开发；有依赖时先让双方用 `aide_message_agent`
  对齐接口/数据结构，再并行或串行；并行不是目标，条件允许才用；
- 跨模块协作：Worker 之间可以 `aide_list_agents` 找到负责人、`aide_message_agent` 直接通信、`aide_read_agent` 读取结论；
  经理也可以代为转达；
- 派发时会在经理会话里追加一条 `dispatch` 消息（含目标、任务、理由、置信度），前端渲染成派发卡片；
- 派发记录写入 `dispatches` 表：目标会话每轮结束自动置为 `done`/`failed`，`failed` 会显示在卡片上；
  撤销接口只允许撤销 `working` 状态的派发，已完成的不会被改写。

### Worker 自设标题与协作

- 每个 Worker 通过 `--mcp-config` 挂载 `mcp/aide-agent-mcp.mjs`，暴露 `aide_set_title` / `aide_list_agents` /
  `aide_message_agent` / `aide_read_agent` / `aide_note`；
- 系统提示要求开始任务时把标题改成负责的模块（如「订单模块」「订单 + 支付」）；
- `PATCH /api/sessions/:sid` 更新标题并广播 `session.updated`，UI 标签页与会话列表实时更新。

## 运行实例与资源准入（P6）

- 端口池 **18080–18120**，按会话启动；同一会话同时只允许一个活跃实例；
- 运行命令优先级：项目 `runCommand` → `AIDE_RUN_CMD` → 按技术栈自动检测：
  Maven/Gradle（`spring-boot:run` / `bootRun`）、Python（uvicorn/Flask/Django/`main.py`）、
  Node（`dev/start` 脚本；Vite/Next 自动加端口与 `127.0.0.1`）、Go、Rust、静态 HTML；
  没有可用命令时返回 400，提示在项目设置里配置 `runCommand`；
- 内存准入：`os.totalmem/freemem`，预计新增 `perRunMb`（默认 320MB，`AIDE_RUN_MEM_MB` 可调）；
  预计使用率超过 `AIDE_MEM_LIMIT`（默认 90%）时返回 409 并带当前统计；
- 就绪探测：每秒 TCP connect 端口，监听后标记 `ready` 并广播；
- 日志：stdout/stderr 按行聚合，`run.log` SSE 推送，每个实例保留 400 行；
- 停止：`taskkill /T /F`（POSIX 为 SIGKILL），端口立即释放；
- 实例状态保存在内存中，服务重启后实例消失（进程随服务关闭），不写入数据库。

## 全局设置与工具链

- `settings` 表存 `javaHome` / `mavenHome` / `pythonPath` / `nodePath` / `usageDisplay`；
- 保存前校验：`java -version`、`mvn -v`（Maven 用所配置的 JDK 执行）、`python --version`、`node --version`，失败返回 400 不落库；
- 自动检测：`JAVA_HOME`、`PATH`、`%USERPROFILE%\.jdks`、`Program Files\{Java,Eclipse Adoptium,Microsoft,Amazon Corretto,Zulu,BellSoft}`，
  Maven 额外扫描 `MAVEN_HOME`、`PATH`、`Program Files\Apache`、Chocolatey、`C:\apache-maven-*`；
  Python 扫描 `PATH`（python/python3/py）、`%LOCALAPPDATA%\Programs\Python`、`C:\Python*`、conda；
  Node 扫描 `PATH`、`Program Files\nodejs`、nvm；逐个执行版本命令验证；
- 所有 Agent 进程、测试门禁、运行实例、`claude` 生成提交信息的一次性调用都使用 `applyToolchainEnv()`：
  注入 `JAVA_HOME`/`MAVEN_HOME`，把 JDK/Maven/Python/Node 目录前置到 `PATH`，并设置 Python UTF-8 环境；
- Agent 系统提示会带上工具链路径与项目技术栈/测试/运行命令，Agent 不需要猜工具位置；
- 测试/运行命令优先使用项目 wrapper，其次使用已配置的可执行文件，最后才回退 PATH。

## 多语言项目

- `stacks.ts` 负责技术栈识别与命令生成，支持 Java（Maven/Gradle）、Python（FastAPI/Flask/Django）、
  Node/JS/TS（Vite/Next/Nest/Express）、Go、Rust、静态 HTML；
- 项目列表与 API 返回 `stack` 标签（如 `Python · Flask`、`Node · TypeScript · Vite`）；
- 会话系统提示注入 `stackPrompt(cwd)`：技术栈、测试命令、运行命令，并提醒 Agent 先读清单文件；
- 文件树忽略 `__pycache__`、`.pytest_cache`、`.venv`、`venv`、`.next` 等构建/缓存目录；
- 多语言命令的端口占位符在 Windows 用 `%PORT%`、POSIX 用 `${PORT}`，由运行实例注入。

## 非 Git 项目

- 注册时不再强制 `.git`，记录 `projects.is_git`；
- 非 Git 项目的会话 `cwd = 项目目录`、`branch` 为空，不创建 worktree；
- Git 状态接口返回 `{isGit:false}`，提交/合并/清理/差异返回 400；
- 测试门禁与运行预览仍然可用。

## Claude CLI 缺失

- `/api/health` 返回 `claude.available=false`；
- 创建 Agent、发送消息、派发、跨模块协作统一返回 **503**，body：
  `{error: "未检测到 Claude Code CLI…", code: "claude_missing"}`；
- 项目注册、文件树、Git、设置仍可用；前端顶部提示条提供安装说明与“重试检测”；
- `claudeVersion` 失败不缓存，安装后重试即可恢复，无需重启服务。

## 删除项目

- `DELETE /api/projects/:id`：停止运行实例与 Agent，逐个删除会话并清理 worktree，
  事务删除 `messages` / `dispatches` / `audit` / `sessions` / `projects`；
- 不删除磁盘目录与 Git 仓库；未合并的 `aide/*` 分支保留；
- 广播 `project.deleted`。

## SVN 项目

- 注册时检测 `.svn`，`projects.vcs = 'svn'`；`main_branch` 存 `svn info` 的 `relative-url`；
- 状态/日志/差异/提交复用 `/git/*` 路由，但按 `vcs` 分派到 `svn.ts`；
- `svn commit` 前会自动 `svn add` 未版本控制文件（过滤 `.aide`/构建目录）；测试门禁与 AI 提交信息逻辑一致；
- SVN 会话使用**共享工作副本**（不创建 worktree、无分支合并），多个 Agent 并发写需协调；
- 需要本机 `svn` 命令行；缺失时状态/提交返回明确错误。

## 项目知识 .aide

- 注册时创建 `<project>/.aide/`，Git 自动写入 `.git/info/exclude`，SVN 状态过滤该目录；
- 检测 `CLAUDE.md` / `.claude/CLAUDE.md` / `AGENTS.md` / `.cursorrules` 等作为生成来源；
- 知识生成是一次性 Claude 任务：只允许写 `.aide/PROJECT.md`、`KNOWLEDGE.md`、`HISTORY.md`；
- 会话系统提示注入 `.aide` 摘要；Agent 可通过 MCP `aide_note` 追加踩坑到 `KNOWLEDGE.md`；
- `.aide` 默认不纳入版本控制；删除项目不会删除该目录。

## 已验证（真实 claude 2.1.224）

- 注册仓库、文件树、git status/log/branches；
- 新建会话 → 发消息 → 流式事件 → `idle`，成本与 token 入库；
- 同一会话连续两轮、快速连发第二条自动排队；
- 停止会话 → 再发消息 `--resume`，能回忆前文；
- 重启服务 → 状态复位 → 发消息 `--resume`，仍能回忆前文；
- SSE 收到 `session.status` / `session.message` / `session.result`；
- Worktree：Worker 在独立目录创建文件，主工作区 `git status` 仍为空；删除会话后 worktree 目录消失、分支保留。
- 提交：Agent 在 worktree 创建文件 → 提交成功并推送到 `origin`（本地 bare 仓库），远程分支可查；
- 测试门禁：项目测试命令失败时返回 409 阻止提交；强制提交成功并写审计；
- 合并：`--no-ff` 合并到主干成功；冲突场景返回 409 + `conflicts:["README.md"]`，主工作区保持干净；
- AI 提交信息：留空 message 时生成 `test: 添加 AI 提交信息生成测试文件`。
- MCP：经理会话一次回合内依次调用 `aide_list_sessions` → `aide_create_session` → `aide_dispatch`，
  新建的「MCP 测试」Worker 收到任务并回复「已收到 MCP 派发任务」，经理汇总报告准确。
- 运行实例：`node preview.mjs` 在 18080 启动，1s 内标记 ready，预览页与 `/healthz` 均 200；
  日志包含启动行与就绪行；端口冲突返回 409；第二个实例自动分配 18081；停止后端口关闭。
- 资源准入：本机基线内存 79%，在 80% 阈值下尝试启动被 409 拒绝并返回统计；
  随后将默认阈值调整为 90%（见 docs），以便在 16GB 机器上正常使用。
- 清理：`POST /git/prune` 删除 3 个已合并孤儿分支，保留被 worktree 占用的分支；
- 单端口：7800 同时提供前端静态资源与 API，浏览器无 console 错误。
- 工具链：保存 Corretto 1.8 后，Agent 执行 `node -e "console.log(process.env.JAVA_HOME)"` 返回
  `C:\Users\<user>\.jdks\corretto-1.8.0_492`；进程命令行里的系统提示也包含该路径；
- 多语言：Python/Flask 示例 `pytest` 通过，运行实例在 18080 返回 `/api/ping`；TS/Vite 示例 `npm test` 通过，
  Vite 实例绑定 127.0.0.1；工具链检测同时识别 Python 3.14 与 Node 24；
- 非 Git：注册 `sandbox/plain-demo` → `isGit=0`、会话无分支/worktree、提交返回 400。

- SVN：`sandbox/svn-demo` 注册 `vcs=svn`、`branch=^/`；修改 README 后提交 r2，未版本控制 `extra.txt` 自动 add 并提交 r6；
  `svn log` 返回 `rN`，UI 提交 r5；
- 项目知识：`.aide` 自动创建，来源检测到 `CLAUDE.md`；Claude 生成 2.1KB `PROJECT.md` + `KNOWLEDGE.md` + `HISTORY.md`；
  `aide_note` 追加成功；新会话命令行系统提示包含 `.aide` 内容与 `aide_note`。

## 已知限制

- SVN 是共享工作副本：多个 Agent 并发修改同一文件会互相覆盖，没有 per-agent worktree/分支/合并；
- 知识生成只靠提示词约束写 `.aide`，没有文件系统沙箱；生成质量取决于项目可读信息；
- `.aide` 默认不提交，团队共享需手动加入版本控制；
- 暂无鉴权，仅监听 `127.0.0.1`。
