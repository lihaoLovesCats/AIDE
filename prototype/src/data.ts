import type {
  Change,
  Commit,
  DiffFile,
  DispatchRef,
  FileNode,
  Message,
  Project,
  Session,
  Status,
} from './types'

let seq = 0
const nextId = () => `msg-${++seq}`

const user = (text: string, time = '刚刚'): Message => ({ id: nextId(), role: 'user', kind: 'text', text, time })
const say = (text: string, time = '刚刚'): Message => ({ id: nextId(), role: 'assistant', kind: 'text', text, time })
const think = (text: string, seconds: number, time = '刚刚'): Message => ({
  id: nextId(),
  role: 'assistant',
  kind: 'thinking',
  text,
  seconds,
  time,
})
const tool = (
  name: string,
  input: string,
  duration = '0.3s',
  output?: string,
  status: 'ok' | 'fail' | 'running' = 'ok',
): Message => ({ id: nextId(), role: 'assistant', kind: 'tool', tool: { name, input, status, duration, output }, time: '刚刚' })
const dispatch = (entries: DispatchRef[], time = '刚刚'): Message => ({
  id: nextId(),
  role: 'assistant',
  kind: 'dispatch',
  entries,
  time,
})
const diff = (files: DiffFile[], note: string): Message => ({ id: nextId(), role: 'assistant', kind: 'diff', files, note, time: '刚刚' })
const result = (tokens: number, cost: number, duration: string): Message => ({
  id: nextId(),
  role: 'assistant',
  kind: 'result',
  tokens,
  cost,
  duration,
  time: '刚刚',
})
const fail = (text: string): Message => ({ id: nextId(), role: 'system', kind: 'error', text, time: '刚刚' })

const dir = (name: string, children: FileNode[]): FileNode => ({ name, type: 'dir', children })
const file = (name: string, status?: 'M' | 'A' | 'D' | 'U'): FileNode => ({ name, type: 'file', status })

function session(partial: Omit<Session, 'projectId'> & { projectId?: string }): Session {
  return { projectId: partial.projectId ?? 'order-center', ...partial }
}

/* ------------------------------------------------------------------ */
/* 项目一：order-center（完整演示数据）                                  */
/* ------------------------------------------------------------------ */

const orderTree: FileNode[] = [
  dir('.mvn', [dir('wrapper', [file('maven-wrapper.properties')])]),
  dir('src', [
    dir('main', [
      dir('java', [
        dir('com.acme.order', [
          dir('controller', [file('OrderController.java', 'M'), file('RefundController.java'), file('HealthController.java')]),
          dir('service', [file('OrderService.java', 'M'), file('OrderQueryService.java'), dir('impl', [file('OrderServiceImpl.java', 'A')])]),
          dir('domain', [file('Order.java'), file('OrderStatus.java', 'M'), file('PageResult.java', 'A')]),
          dir('mapper', [file('OrderMapper.java')]),
          dir('config', [file('MyBatisConfig.java'), file('WebMvcConfig.java')]),
        ]),
      ]),
      dir('resources', [file('application.yml', 'M'), file('application-dev.yml'), dir('mapper', [file('OrderMapper.xml', 'A')])]),
    ]),
    dir('test', [
      dir('java', [
        dir('com.acme.order', [dir('service', [file('OrderServiceTest.java', 'A')]), dir('controller', [file('OrderControllerTest.java')])]),
      ]),
    ]),
  ]),
  file('pom.xml', 'M'),
  file('README.md'),
  file('.gitignore'),
]

const managerSession: Session = session({
  id: 'mgr',
  name: '项目经理',
  role: '路由 · 编排',
  status: 'running',
  branch: 'main',
  worktree: 'G:\\workspace\\order-center',
  model: 'sonnet-4.5',
  elapsed: 128,
  cost: 0.31,
  tokens: 48200,
  turns: 12,
  activity: '正在派发任务给「后端-订单」',
  isManager: true,
  messages: [
    user('订单列表接口现在没有分页，数据量一大就超时。帮我改成分页查询，顺便补上单元测试。', '14:02'),
    think('涉及后端分页改造、前端列表适配和回归测试三段。先读 Controller 确认现状，再决定拆给谁、怎么并行。', 6, '14:02'),
    tool(
      'Read',
      'src/main/java/com/acme/order/controller/OrderController.java',
      '0.3s',
      ' 42  @GetMapping\n 43  public List<OrderVO> list(@RequestParam(required = false) String status) {\n 44      return orderService.listAll(status);\n 45  }',
    ),
    tool('Grep', '"listAll|selectList" · 3 处命中', '0.1s'),
    say(
      '现状确认：`/api/orders` 直接 `selectList` 全表返回，没有 page/size。\n\n我拆成三段并行：\n1. **后端-订单**：分页参数 + PageResult 返回体 + Mapper count/limit；\n2. **前端-列表**：表格接分页、保留筛选条件；\n3. **测试-回归**：补分页边界用例（越界页、size 上限）。\n\n先派发前两个，测试等后端接口落定后启动。',
      '14:03',
    ),
    dispatch(
      [
        {
          toSessionId: 'be-order',
          toName: '后端-订单',
          task: '把 OrderController#list 改成分页：page/size 参数，返回 PageResult<OrderVO>；Mapper 增加 count 与 limit 查询；同步更新 PageHelper 配置。',
          reason: '改动集中在 Controller + Mapper 两层，后端会话已持有写锁，分支基于 main 最新提交',
          confidence: 94,
          status: 'working',
        },
        {
          toSessionId: 'fe-list',
          toName: '前端-列表',
          task: '订单列表接入 page/size，表格底部加页码；筛选条件在翻页时保持。接口契约见 PageResult。',
          reason: '列表模板改动独立于 Java 层，可并行进行，且不依赖后端编译结果',
          confidence: 87,
          status: 'sent',
        },
      ],
      '14:03',
    ),
    say('后端编译通过后我会让「测试-回归」跑一遍边界，再统一提交推送。当前后端正在执行 Maven 编译。', '14:05'),
    result(12840, 0.061, '1m 42s'),
  ],
})

const backendSession: Session = session({
  id: 'be-order',
  name: '后端-订单',
  role: 'Spring Boot',
  status: 'running',
  branch: 'aide/order-api',
  worktree: 'G:\\workspace\\order-center\\.aide\\worktrees\\order-api',
  model: 'sonnet-4.5',
  elapsed: 761,
  cost: 0.42,
  tokens: 62300,
  turns: 9,
  activity: 'mvn -q -DskipTests compile',
  port: 18080,
  runStatus: 'running',
  messages: [
    user('把 OrderController#list 改成分页：page/size 参数，返回 PageResult<OrderVO>；Mapper 增加 count 与 limit 查询；同步更新 PageHelper 配置。', '14:03'),
    say('收到。先读现有 Controller 与 Mapper，确认字段与返回结构。', '14:03'),
    tool('Read', 'src/main/java/com/acme/order/controller/OrderController.java', '0.2s'),
    tool('Read', 'src/main/resources/mapper/OrderMapper.xml', '0.2s'),
    think('需要新增 PageResult<T>，把 listAll 拆成 count + limit 两条 SQL，并对 size 做上限保护；PageHelper 已在依赖里，只需补配置。', 4, '14:04'),
    tool('Edit', 'OrderController.java · 重写 list 方法', '0.2s'),
    tool('Write', 'domain/PageResult.java · 新建', '0.1s'),
    tool('Edit', 'mapper/OrderMapper.xml · 新增 countPage / selectPage', '0.2s'),
    tool('Bash', 'mvn -q -DskipTests compile', '38s', '[INFO] BUILD SUCCESS\n[INFO] Total time: 37.842 s'),
    say('编译通过。默认 `page=1&size=20`，size 上限 200；空结果返回 `total=0` 而不是 404。接下来我会补一个 Controller 层的参数校验。', '14:12'),
    diff(
      [
        { path: 'controller/OrderController.java', add: 48, del: 12, status: 'M' },
        { path: 'domain/PageResult.java', add: 28, del: 0, status: 'A' },
        { path: 'resources/mapper/OrderMapper.xml', add: 64, del: 0, status: 'A' },
      ],
      '分页主链路已完成，等待前端确认响应结构',
    ),
    result(9460, 0.038, '9m 21s'),
  ],
})

const frontendSession: Session = session({
  id: 'fe-list',
  name: '前端-列表',
  role: 'Thymeleaf · JS',
  status: 'waiting_user',
  branch: 'aide/web-list',
  worktree: 'G:\\workspace\\order-center\\.aide\\worktrees\\web-list',
  model: 'sonnet-4.5',
  elapsed: 402,
  cost: 0.18,
  tokens: 21400,
  turns: 4,
  activity: '分页交互待确认：页码 or 加载更多？',
  port: 18081,
  runStatus: 'stopped',
  messages: [
    user('订单列表接入 page/size，表格底部加页码；筛选条件在翻页时保持。接口契约见 PageResult。', '14:03'),
    say('收到。我先改造列表模板和分页组件，接口字段按 `records / total / page / size` 处理；如果后端字段有差异我再对齐。', '14:04'),
    tool('Read', 'src/main/resources/templates/order/list.html', '0.2s'),
    diff([{ path: 'templates/order/list.html', add: 76, del: 21, status: 'M' }], '分页条已渲染，等待接口联调'),
    say(
      '分页条已经按「页码 + 每页条数」实现了一版。这里需要你确认一下交互：**页码条**（后台表格常用）还是**加载更多**（移动端更顺手）？确认后我再定稿样式。',
      '14:09',
    ),
  ],
})

const testSession: Session = session({
  id: 'qa-regress',
  name: '测试-回归',
  role: 'JUnit · MockMvc',
  status: 'error',
  branch: 'aide/test-regression',
  worktree: 'G:\\workspace\\order-center\\.aide\\worktrees\\test-regression',
  model: 'sonnet-4.5',
  elapsed: 95,
  cost: 0.09,
  tokens: 7800,
  turns: 2,
  activity: '上下文超限，进程已退出',
  port: 18082,
  runStatus: 'stopped',
  messages: [
    user('后端接口落定后，补分页边界用例：越界页、size 上限、空结果。', '14:06'),
    say('开始补 OrderControllerTest 的分页用例，先跑一遍现有测试基线。', '14:06'),
    tool('Bash', 'mvn -q -Dtest=OrderServiceTest test', '51s', 'Tests run: 12, Failures: 0, Errors: 0, Skipped: 0', 'ok'),
    fail('进程退出码 1：上下文超限（1,000,000 tokens）。建议新建会话或执行 /compact 后重试。'),
  ],
})

const securitySession: Session = session({
  id: 'sec-review',
  name: '审查-安全',
  role: '代码审查',
  status: 'queued',
  branch: 'aide/security-review',
  worktree: 'G:\\workspace\\order-center\\.aide\\worktrees\\security-review',
  model: 'sonnet-4.5',
  elapsed: 0,
  cost: 0,
  tokens: 0,
  turns: 0,
  activity: '等待「后端-订单」释放写锁',
  queuePos: 2,
  port: 18083,
  runStatus: 'stopped',
  messages: [],
})

const migrationSession: Session = session({
  id: 'db-migrate',
  name: '数据-迁移',
  role: 'Flyway · SQL',
  status: 'waiting_permission',
  branch: 'aide/db-index',
  worktree: 'G:\\workspace\\order-center\\.aide\\worktrees\\db-index',
  model: 'sonnet-4.5',
  elapsed: 154,
  cost: 0.06,
  tokens: 11300,
  turns: 3,
  activity: '请求执行 DDL：ALTER TABLE orders ADD INDEX',
  port: 18084,
  runStatus: 'stopped',
  messages: [
    user('orders 按 created_at 查询很慢，加个索引，写一版 Flyway 迁移脚本。', '14:01'),
    say('已生成 `V20261116_01__idx_orders_created_at.sql`，对 `created_at` 与 `status` 建联合索引，走在线 DDL。', '14:04'),
    tool('Write', 'db/migration/V20261116_01__idx_orders_created_at.sql', '0.3s', 'CREATE INDEX idx_orders_created_status ON orders (created_at, status);'),
    say('脚本已就绪。执行 `ALTER TABLE ... ADD INDEX` 属于 DDL，按权限策略需要你授权后我才能跑。', '14:05'),
  ],
})

const orderCommits: Commit[] = [
  {
    sha: '9f2a1c4',
    msg: 'fix(order): 修复分页参数越界',
    meta: 'lihao',
    time: '12 分钟前',
    lane: 0,
    tone: 'accent',
    refs: ['main'],
  },
  { sha: '4d1e77b', msg: 'feat(order): 新增订单查询接口', meta: 'lihao', time: '2 小时前', lane: 0, tone: 'accent', refs: ['main'] },
  { sha: '8b3c02d', msg: 'chore: 升级 Spring Boot 3.2.5', meta: 'lihao', time: '昨天', lane: 0, tone: 'dim' },
  {
    sha: '2f81aa9',
    msg: 'merge: aide/web-list → main',
    meta: 'aide',
    time: '昨天',
    lane: 1,
    tone: 'violet',
    merge: true,
  },
  { sha: '71c9de2', msg: 'feat(web): 订单列表页骨架', meta: '前端-列表', time: '2 天前', lane: 1, tone: 'violet', refs: ['aide/web-list'] },
  { sha: 'c04a3f1', msg: 'test: 补充订单状态机用例', meta: '测试-回归', time: '3 天前', lane: 2, tone: 'ok' },
]

const orderChanges: Change[] = [
  { path: 'src/main/java/com/acme/order/controller/OrderController.java', status: 'M', add: 48, del: 12 },
  { path: 'src/main/java/com/acme/order/domain/PageResult.java', status: 'A', add: 28, del: 0 },
  { path: 'src/main/java/com/acme/order/domain/OrderStatus.java', status: 'M', add: 3, del: 1 },
  { path: 'src/main/resources/mapper/OrderMapper.xml', status: 'A', add: 64, del: 0 },
  { path: 'src/main/resources/application.yml', status: 'M', add: 4, del: 2 },
  { path: 'src/test/java/com/acme/order/service/OrderServiceTest.java', status: 'A', add: 86, del: 0 },
  { path: 'pom.xml', status: 'M', add: 6, del: 0 },
]

/* ------------------------------------------------------------------ */
/* 项目二 / 三：简化数据                                                */
/* ------------------------------------------------------------------ */

const mallTree: FileNode[] = [
  dir('src', [
    dir('main', [
      dir('java', [dir('com.acme.mall', [dir('web', [file('HomeController.java', 'M'), file('CartController.java')]), dir('service', [file('CartService.java')])])]),
      dir('resources', [
        dir('templates', [dir('home', [file('index.html', 'M')]), dir('cart', [file('cart.html')])]),
        file('application.properties'),
      ]),
    ]),
  ]),
  file('pom.xml'),
]

const mallManager: Session = session({
  projectId: 'mall-web',
  id: 'mgr-mall',
  name: '项目经理',
  role: '路由 · 编排',
  status: 'idle',
  branch: 'main',
  worktree: 'G:\\workspace\\mall-web',
  model: 'sonnet-4.5',
  elapsed: 64,
  cost: 0.12,
  tokens: 16800,
  turns: 5,
  activity: '空闲，等待指令',
  isManager: true,
  messages: [
    user('首页秒杀区块在移动端错位，先看下模板结构。', '10:20'),
    say('这是纯前端样式问题，我直接改，不需要开新 Agent。', '10:20'),
    result(6200, 0.021, '38s'),
  ],
})

const mallPage: Session = session({
  projectId: 'mall-web',
  id: 'fe-mall',
  name: '前端-首页',
  role: 'Thymeleaf · CSS',
  status: 'idle',
  branch: 'aide/home-fix',
  worktree: 'G:\\workspace\\mall-web\\.aide\\worktrees\\home-fix',
  model: 'sonnet-4.5',
  elapsed: 240,
  cost: 0.07,
  tokens: 9600,
  turns: 3,
  activity: '样式已修复，待合并',
  messages: [
    user('修一下首页秒杀区块在 390px 宽度下的错位。', '10:22'),
    say('已定位到 `.seckill-grid` 的固定宽度，改成 grid + minmax 自适应，并补了窄屏断点。', '10:27'),
  ],
})

const mallCommits: Commit[] = [
  { sha: 'a71c9de', msg: 'style(home): 秒杀区块窄屏自适应', meta: 'lihao', time: '3 小时前', lane: 0, tone: 'ok', refs: ['main'] },
  { sha: 'f20b3aa', msg: 'feat(cart): 购物车合并结算', meta: 'lihao', time: '昨天', lane: 0, tone: 'ok' },
  { sha: 'b93ce11', msg: 'init: Spring MVC 商城前台', meta: 'lihao', time: '5 天前', lane: 0, tone: 'dim' },
]

const mallChanges: Change[] = [
  { path: 'src/main/resources/templates/home/index.html', status: 'M', add: 32, del: 18 },
  { path: 'src/main/resources/static/css/home.css', status: 'M', add: 41, del: 6 },
]

const userTree: FileNode[] = [
  dir('src', [
    dir('main', [
      dir('java', [dir('com.acme.user', [dir('auth', [file('AuthController.java'), file('JwtFilter.java', 'M')]), dir('service', [file('UserService.java')])])]),
      file('resources/application.yml', 'M'),
    ]),
  ]),
  file('pom.xml'),
]

const userManager: Session = session({
  projectId: 'user-service',
  id: 'mgr-user',
  name: '项目经理',
  role: '路由 · 编排',
  status: 'idle',
  branch: 'main',
  worktree: 'G:\\workspace\\user-service',
  model: 'sonnet-4.5',
  elapsed: 30,
  cost: 0.04,
  tokens: 7200,
  turns: 2,
  activity: '空闲，等待指令',
  isManager: true,
  messages: [
    user('JWT 过期时间改成可配置。', '09:41'),
    say('已确认改动点只有 JwtFilter 和 application.yml，交给「鉴权」会话处理。', '09:41'),
  ],
})

const userAuth: Session = session({
  projectId: 'user-service',
  id: 'be-auth',
  name: '鉴权',
  role: 'Spring Security',
  status: 'running',
  branch: 'aide/jwt-ttl',
  worktree: 'G:\\workspace\\user-service\\.aide\\worktrees\\jwt-ttl',
  model: 'sonnet-4.5',
  elapsed: 312,
  cost: 0.15,
  tokens: 18300,
  turns: 4,
  activity: 'Edit JwtFilter.java',
  messages: [
    user('JWT 过期时间改成可配置，默认 2h，支持按环境覆盖。', '09:42'),
    say('改为读取 `auth.jwt.ttl`，缺省 2h，并在 dev 环境覆盖为 8h。', '09:45'),
    tool('Edit', 'JwtFilter.java · ttl 注入', '0.3s'),
  ],
})

const userCommits: Commit[] = [
  { sha: 'd11a8c2', msg: 'feat(auth): JWT 过期时间可配置', meta: 'lihao', time: '4 小时前', lane: 0, tone: 'warn', refs: ['main'] },
  { sha: 'e09b7d1', msg: 'fix(auth): 刷新令牌重复签发', meta: 'lihao', time: '昨天', lane: 0, tone: 'warn' },
]

const userChanges: Change[] = [
  { path: 'src/main/java/com/acme/user/auth/JwtFilter.java', status: 'M', add: 18, del: 7 },
  { path: 'src/main/resources/application.yml', status: 'M', add: 4, del: 0 },
]

/* ------------------------------------------------------------------ */

export const projects: Project[] = [
  {
    id: 'order-center',
    name: 'order-center',
    path: 'G:\\workspace\\order-center',
    color: '#5b8cff',
    color2: '#7c5cff',
    branch: 'main',
    ahead: 2,
    behind: 0,
    dirty: true,
    isGit: true,
    vcs: 'git',
    sessions: [managerSession, backendSession, frontendSession, testSession, securitySession, migrationSession],
    tree: orderTree,
    commits: orderCommits,
    branches: [
      { name: 'main', ahead: 2, behind: 0, tone: 'accent', main: true, lastCommit: 'fix(order): 修复分页参数越界', time: '12 分钟前', status: 'clean' },
      { name: 'aide/order-api', sessionId: 'be-order', ahead: 3, behind: 1, tone: 'run', lastCommit: 'feat(order): 分页查询与 PageResult', time: '刚刚', status: 'changes' },
      { name: 'aide/web-list', sessionId: 'fe-list', ahead: 1, behind: 3, tone: 'violet', lastCommit: 'feat(web): 列表分页条', time: '14 分钟前', status: 'clean' },
      { name: 'aide/test-regression', sessionId: 'qa-regress', ahead: 0, behind: 3, tone: 'warn', lastCommit: 'test: 分页边界用例（未提交）', time: '20 分钟前', status: 'changes' },
      { name: 'aide/db-index', sessionId: 'db-migrate', ahead: 1, behind: 2, tone: 'pink', lastCommit: 'perf(db): orders 联合索引', time: '30 分钟前', status: 'changes' },
      { name: 'aide/security-review', sessionId: 'sec-review', ahead: 0, behind: 3, tone: 'err', lastCommit: '—', time: '排队中', status: 'clean' },
    ],
    changes: orderChanges,
    runPort: 18080,
    runStatus: 'running',
    stack: 'Spring Boot 3.2 · Maven',
  },
  {
    id: 'mall-web',
    name: 'mall-web',
    path: 'G:\\workspace\\mall-web',
    color: '#22c55e',
    color2: '#0ea5a5',
    branch: 'main',
    ahead: 0,
    behind: 0,
    dirty: true,
    isGit: true,
    vcs: 'git',
    sessions: [mallManager, mallPage],
    tree: mallTree,
    commits: mallCommits,
    branches: [
      { name: 'main', ahead: 0, tone: 'ok', main: true },
      { name: 'aide/home-fix', sessionId: 'fe-mall', ahead: 1, tone: 'violet' },
    ],
    changes: mallChanges,
    runPort: 18081,
    runStatus: 'stopped',
    stack: 'Spring MVC · Thymeleaf',
  },
  {
    id: 'user-service',
    name: 'user-service',
    path: 'G:\\workspace\\user-service',
    color: '#f59e0b',
    color2: '#f97316',
    branch: 'main',
    ahead: 0,
    behind: 1,
    dirty: true,
    isGit: true,
    vcs: 'git',
    sessions: [userManager, userAuth],
    tree: userTree,
    commits: userCommits,
    branches: [
      { name: 'main', ahead: 0, tone: 'warn', main: true },
      { name: 'aide/jwt-ttl', sessionId: 'be-auth', ahead: 2, tone: 'run' },
    ],
    changes: userChanges,
    runPort: 18082,
    runStatus: 'stopped',
    stack: 'Spring Cloud · Security',
  },
]

export const fileContents: Record<string, string> = {
  'src/main/java/com/acme/order/controller/OrderController.java': `package com.acme.order.controller;

import com.acme.order.domain.OrderVO;
import com.acme.order.domain.PageResult;
import com.acme.order.service.OrderService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
public class OrderController {

    private final OrderService orderService;

    /**
     * 订单分页查询。
     * page 从 1 开始，size 上限 200，避免被刷全表。
     */
    @GetMapping
    public PageResult<OrderVO> list(@RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int size,
                                    @RequestParam(required = false) String status) {
        return orderService.page(page, Math.min(size, 200), status);
    }

    @GetMapping("/{id}")
    public OrderVO detail(@PathVariable Long id) {
        return orderService.getById(id);
    }
}
`,
  'src/main/java/com/acme/order/domain/PageResult.java': `package com.acme.order.domain;

import java.util.List;

/**
 * 统一分页返回体。
 */
public record PageResult<T>(List<T> records, long total, int page, int size) {

    public static <T> PageResult<T> empty(int page, int size) {
        return new PageResult<>(List.of(), 0L, page, size);
    }
}
`,
  'src/main/resources/mapper/OrderMapper.xml': `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.acme.order.mapper.OrderMapper">

    <select id="countPage" resultType="long">
        SELECT COUNT(1) FROM orders
        <where>
            <if test="status != null and status != ''">
                AND status = #{status}
            </if>
        </where>
    </select>

    <select id="selectPage" resultType="com.acme.order.domain.OrderVO">
        SELECT id, order_no, user_id, amount, status, created_at
        FROM orders
        <where>
            <if test="status != null and status != ''">
                AND status = #{status}
            </if>
        </where>
        ORDER BY created_at DESC
        LIMIT #{size} OFFSET #{offset}
    </select>
</mapper>
`,
  'src/main/resources/application.yml': `server:
  port: \${SERVER_PORT:8080}

spring:
  datasource:
    url: jdbc:mysql://127.0.0.1:3306/order_center?useSSL=false
    username: \${DB_USER:root}
    password: \${DB_PASS:root}

pagehelper:
  helper-dialect: mysql
  reasonable: true
  support-methods-arguments: true
  params: count=countPage

logging:
  level:
    com.acme.order.mapper: debug
`,
  'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.5</version>
    <relativePath/>
  </parent>

  <groupId>com.acme</groupId>
  <artifactId>order-center</artifactId>
  <version>1.4.0-SNAPSHOT</version>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>com.github.pagehelper</groupId>
      <artifactId>pagehelper-spring-boot-starter</artifactId>
      <version>2.1.0</version>
    </dependency>
  </dependencies>
</project>
`,
  'src/main/java/com/acme/order/service/OrderService.java': `package com.acme.order.service;

import com.acme.order.domain.OrderVO;
import com.acme.order.domain.PageResult;

public interface OrderService {

    PageResult<OrderVO> page(int page, int size, String status);

    OrderVO getById(Long id);
}
`,
}

export const fileDiffs: Record<string, { type: 'add' | 'del' | 'ctx'; text: string; no: number }[]> = {
  'src/main/java/com/acme/order/controller/OrderController.java': [
    { type: 'ctx', text: '@RestController', no: 9 },
    { type: 'ctx', text: '@RequestMapping("/api/orders")', no: 10 },
    { type: 'ctx', text: '@RequiredArgsConstructor', no: 11 },
    { type: 'ctx', text: 'public class OrderController {', no: 12 },
    { type: 'ctx', text: '', no: 13 },
    { type: 'ctx', text: '    private final OrderService orderService;', no: 14 },
    { type: 'ctx', text: '', no: 15 },
    { type: 'del', text: '    @GetMapping', no: 16 },
    { type: 'del', text: '    public List<OrderVO> list(@RequestParam(required = false) String status) {', no: 17 },
    { type: 'del', text: '        return orderService.listAll(status);', no: 18 },
    { type: 'del', text: '    }', no: 19 },
    { type: 'add', text: '    @GetMapping', no: 16 },
    { type: 'add', text: '    public PageResult<OrderVO> list(@RequestParam(defaultValue = "1") int page,', no: 17 },
    { type: 'add', text: '                                    @RequestParam(defaultValue = "20") int size,', no: 18 },
    { type: 'add', text: '                                    @RequestParam(required = false) String status) {', no: 19 },
    { type: 'add', text: '        return orderService.page(page, Math.min(size, 200), status);', no: 20 },
    { type: 'add', text: '    }', no: 21 },
    { type: 'ctx', text: '', no: 22 },
    { type: 'ctx', text: '    @GetMapping("/{id}")', no: 23 },
  ],
}

export const commitMessageDraft = `feat(order): 订单列表改为分页查询

- OrderController#list 增加 page/size 参数，返回 PageResult<OrderVO>
- OrderMapper 增加 countPage / selectPage，避免全表扫描
- 新增 PageResult 统一分页返回体，空结果返回 total=0
- application.yml 启用 PageHelper 合理化分页，size 上限 200
- 补充 OrderServiceTest 分页边界用例（首屏 / 越界页 / size 上限）
`

export const roleTemplates = [
  { id: 'backend', name: '后端工程师', desc: 'Spring Boot / Mapper / 单测', tone: 'accent' as const },
  { id: 'frontend', name: '前端工程师', desc: 'Thymeleaf / JS / 样式', tone: 'violet' as const },
  { id: 'qa', name: '测试工程师', desc: 'JUnit / MockMvc / 回归', tone: 'ok' as const },
  { id: 'review', name: '代码审查', desc: '安全 / 性能 / 规范', tone: 'warn' as const },
  { id: 'devops', name: '构建运维', desc: 'Maven / 部署 / 日志', tone: 'run' as const },
  { id: 'custom', name: '自定义角色', desc: '完全自定义系统提示词', tone: 'dim' as const },
]

export const statusText: Record<Status, string> = {
  starting: '启动中',
  running: '运行中',
  thinking: '思考中',
  idle: '空闲',
  queued: '排队中',
  error: '异常',
  stopped: '已停止',
  waiting_user: '等待确认',
  waiting_permission: '等待授权',
}

export const quickPrompts = [
  '先看一遍项目结构，告诉我怎么启动',
  '跑一遍测试，失败就修',
  '检查未提交的改动并总结',
  '把代码里的 TODO 清理掉',
]
