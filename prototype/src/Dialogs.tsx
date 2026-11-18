import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  Circle,
  FlaskConical,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitCommit,
  GitMerge,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { commitMessageDraft } from './data'
import { FolderPicker } from './FolderPicker'
import type { Project } from './types'
import { Chip, Modal, ModalHeader, cn } from './ui'

const baseSteps = ['汇总工作区变更', 'Git Agent 生成提交描述']
const tailSteps = ['git add · git commit', 'git push origin', '合并回 main']

export function CommitDialog({
  open,
  project,
  onClose,
  onConfirm,
}: {
  open: boolean
  project: Project
  onClose: () => void
  onConfirm: () => void
}) {
  const [phase, setPhase] = useState<'review' | 'running' | 'done' | 'failed'>('review')
  const [step, setStep] = useState(0)
  const [msg, setMsg] = useState(commitMessageDraft)
  const [merge, setMerge] = useState(true)
  const [autoTest, setAutoTest] = useState(true)
  const [forceFail, setForceFail] = useState(false)
  const [confirmForce, setConfirmForce] = useState(false)
  const [forced, setForced] = useState(false)
  const [snapshot, setSnapshot] = useState(project.changes)

  const steps = autoTest ? [...baseSteps, '运行 mvn test（412 个用例）', ...tailSteps] : [...baseSteps, ...tailSteps]
  const testIndex = autoTest ? 2 : -1

  useEffect(() => {
    if (!open) return
    setPhase('review')
    setStep(0)
    setMsg(commitMessageDraft)
    setMerge(true)
    setAutoTest(true)
    setForceFail(false)
    setConfirmForce(false)
    setForced(false)
    setSnapshot(project.changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const runFrom = (startAt: number, skipTest: boolean) => {
    setPhase('running')
    setStep(startAt)
    let i = startAt
    const timer = window.setInterval(() => {
      i += 1
      if (!skipTest && forceFail && testIndex >= 0 && i === testIndex + 1) {
        window.clearInterval(timer)
        setStep(testIndex)
        setPhase('failed')
        return
      }
      setStep(i)
      if (i >= steps.length) {
        window.clearInterval(timer)
        setTimeout(() => {
          setPhase('done')
          onConfirm()
        }, 450)
      }
    }, 720)
  }

  const run = () => runFrom(0, false)

  const add = snapshot.reduce((a, c) => a + c.add, 0)
  const del = snapshot.reduce((a, c) => a + c.del, 0)

  const stepState = (i: number): 'done' | 'active' | 'todo' | 'fail' => {
    if (phase === 'done' || i < step) return 'done'
    if (phase === 'failed' && i === step) return 'fail'
    if (i === step) return 'active'
    return 'todo'
  }

  return (
    <Modal open={open} onClose={onClose} width={820}>
      <ModalHeader
        title="一键提交并推送"
        subtitle={`${project.name} · ${snapshot.length} 个文件 · +${add} −${del} · 由专用 Git Agent 生成描述`}
        icon={<GitCommit size={16} />}
        onClose={onClose}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr]">
        <div className="flex min-h-0 flex-col border-r border-line">
          <div className="flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider text-faint">
            <GitBranch size={11} />
            变更文件
            <span className="ml-auto normal-case tracking-normal">工作区</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
            {snapshot.map((c) => (
              <div key={c.path} className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-soft">
                <span
                  className={cn(
                    'w-3 shrink-0 text-center font-mono text-[9px] font-bold',
                    c.status === 'M' && 'text-warn',
                    c.status === 'A' && 'text-ok',
                    c.status === 'D' && 'text-err',
                  )}
                >
                  {c.status}
                </span>
                <span className="truncate font-mono text-[10px] text-dim" title={c.path}>
                  {c.path}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[9px]">
                  <span className="text-ok">+{c.add}</span> <span className="text-err">−{c.del}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-line px-3 py-2 text-[9.5px] leading-relaxed text-faint">
            提交将执行 <span className="font-mono text-dim">git add -A</span>，请确认没有敏感文件与构建产物。
          </div>
          <div className="space-y-1 border-t border-line px-3 py-2 text-[10px] text-faint">
            <div className="flex items-center justify-between">
              <span>修改 / 新增 / 删除</span>
              <span className="font-mono text-dim">
                {snapshot.filter((c) => c.status === 'M').length} / {snapshot.filter((c) => c.status === 'A').length} /{' '}
                {snapshot.filter((c) => c.status === 'D').length}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>敏感文件扫描</span>
              <span className="flex items-center gap-1 text-ok">
                <Check size={9} /> 通过
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>构建产物</span>
              <span className="text-dim">target/ 已忽略</span>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-accent/15 text-accent2">
              <Bot size={11} />
            </div>
            <span className="text-[11px] font-medium text-ink">Git Agent 生成的提交信息</span>
            <Chip tone="accent">临时会话</Chip>
            <span className="ml-auto flex items-center gap-1 text-[9.5px] text-ok">
              <Check size={10} />
              读取 7 个文件的 diff
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            <textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              spellCheck={false}
              className="h-[188px] w-full resize-none rounded-lg border border-line2 bg-sunken p-3 font-mono text-[11px] leading-[1.7] text-ink/90 focus:border-accent/40"
            />
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-soft px-3 py-2">
              <Wand2 size={12} className="text-violet" />
              <span className="text-[10.5px] text-dim">
                Agent 说明：按 Conventional Commits 归类为 <span className="font-mono text-ink">feat(order)</span>，覆盖分页参数、Mapper
                查询、配置与测试四处改动。
              </span>
              <button
                type="button"
                onClick={() => setMsg(commitMessageDraft)}
                className="ml-auto shrink-0 rounded border border-line2 px-1.5 py-0.5 text-[9.5px] text-dim hover:bg-hover"
              >
                重新生成
              </button>
            </div>

            <div className="mt-3 space-y-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-dim">
                <input
                  type="checkbox"
                  checked={merge}
                  onChange={(e) => setMerge(e.target.checked)}
                  className="h-3 w-3 accent-[#5b8cff]"
                />
                推送后自动合并回 <span className="font-mono text-ink">{project.branch}</span>（来自 aide/order-api）
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-dim">
                <input
                  type="checkbox"
                  checked={autoTest}
                  onChange={(e) => setAutoTest(e.target.checked)}
                  disabled={phase !== 'review'}
                  className="h-3 w-3 accent-[#5b8cff]"
                />
                提交前运行 <span className="font-mono text-ink">mvn test</span>，失败则中止推送
              </label>
              {autoTest && phase === 'review' && (
                <button
                  type="button"
                  onClick={() => setForceFail((v) => !v)}
                  className={cn(
                    'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9.5px] transition-colors',
                    forceFail
                      ? 'border-err/40 bg-err/10 text-err'
                      : 'border-line2 text-faint hover:border-line2 hover:text-dim',
                  )}
                >
                  <FlaskConical size={9} />
                  {forceFail ? '演示失败已开启' : '演示：模拟测试失败'}
                </button>
              )}
              <div className="flex items-center gap-1.5 text-[10px] text-faint">
                <ArrowRight size={9} />
                目标：<span className="font-mono">origin/aide/order-api</span> → <span className="font-mono">origin/main</span>
              </div>
            </div>
          </div>

          {phase !== 'review' && (
            <div className="border-t border-line px-4 py-2.5">
              <div className="space-y-1.5">
                {steps.map((s, i) => {
                  const state = stepState(i)
                  return (
                    <div key={s} className="flex items-center gap-2 text-[10.5px]">
                      {state === 'done' && <Check size={11} className="text-ok" />}
                      {state === 'active' && <Loader2 size={11} className="animate-spin text-accent2" />}
                      {state === 'todo' && <Circle size={9} className="text-faint/50" />}
                      {state === 'fail' && <X size={11} className="text-err" />}
                      <span
                        className={cn(
                          state === 'todo' ? 'text-faint' : state === 'fail' ? 'text-err' : 'text-ink/85',
                          'font-mono',
                        )}
                      >
                        {s}
                      </span>
                      {state === 'done' && s.startsWith('git add') && <span className="text-faint">a31f9c2</span>}
                      {state === 'done' && s.startsWith('运行 mvn test') && (
                        forced ? (
                          <span className="text-err">已跳过（强制提交）</span>
                        ) : (
                          <span className="text-ok">412 passed</span>
                        )
                      )}
                    </div>
                  )
                })}
              </div>

              {phase === 'done' && (
                <div className="mt-2 flex items-center gap-1.5 rounded border border-ok/25 bg-ok/[0.07] px-2 py-1.5 text-[10.5px] text-ok">
                  <Check size={11} />
                  已推送到 origin/main · 合并完成，工作区已清理
                </div>
              )}

              {phase === 'failed' && (
                <div className="mt-2 overflow-hidden rounded border border-err/30 bg-err/[0.06]">
                  <div className="flex items-center gap-1.5 border-b border-err/20 px-2 py-1.5 text-[10.5px] font-medium text-err">
                    <AlertTriangle size={11} />
                    测试未通过，已中止提交与推送
                  </div>
                  <pre className="px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-dim">
{`Tests run: 412, Failures: 1, Errors: 0, Skipped: 3
[ERROR] OrderServiceTest.shouldClampPageSize:88 expected 200 but was 500`}
                  </pre>
                  <div className="flex items-center gap-2 border-t border-err/20 px-2 py-1">
                    <span className="text-[9.5px] text-faint">工作区保持原样，未执行 commit / push</span>
                    <button
                      type="button"
                      onClick={() => setPhase('review')}
                      className="ml-auto rounded border border-line2 px-1.5 py-0.5 text-[9.5px] text-dim hover:bg-soft"
                    >
                      返回检查
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmForce(true)}
                      className="rounded border border-err/40 px-1.5 py-0.5 text-[9.5px] text-err hover:bg-err/10"
                      title="跳过失败的测试并强制提交"
                    >
                      仍然提交…
                    </button>
                  </div>

                  {confirmForce && (
                    <div className="border-t border-err/30 bg-err/[0.1] px-2 py-1.5">
                      <div className="flex items-start gap-1.5 text-[9.5px] leading-relaxed text-err">
                        <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                        强制提交会跳过失败的测试，可能把缺陷推到主干；该操作会写入审计日志，正式版还会通知项目经理。
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmForce(false)}
                          className="rounded border border-line2 px-2 py-0.5 text-[9.5px] text-dim hover:bg-soft"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmForce(false)
                            setForced(true)
                            runFrom(testIndex + 1, true)
                          }}
                          className="rounded bg-err px-2 py-0.5 text-[9.5px] font-medium text-white hover:opacity-90"
                        >
                          确认强制提交
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <span className="flex items-center gap-1 text-[10px] text-faint">
          <Sparkles size={10} />
          {phase === 'failed' ? '已拦截提交，工作区未改动' : '提交信息可编辑，确认后由后端执行 git 命令'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-md border border-line2 px-3 text-[11.5px] text-dim hover:bg-hover"
          >
            {phase === 'done' ? '完成' : '取消'}
          </button>
          {phase !== 'done' && phase !== 'failed' && (
            <button
              type="button"
              disabled={phase === 'running'}
              onClick={run}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-3 text-[11.5px] font-medium',
                phase === 'running' ? 'bg-hover text-faint' : 'bg-accent text-white hover:bg-accent2 hover:text-white',
              )}
            >
              {phase === 'running' ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />}
              {phase === 'running' ? '执行中…' : '提交并推送'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

export function NewAgentDialog({
  open,
  project,
  onClose,
  onCreate,
}: {
  open: boolean
  project: Project
  onClose: () => void
  onCreate: (data: { task: string }) => void
}) {
  const [task, setTask] = useState('')

  useEffect(() => {
    if (open) setTask('')
  }, [open])

  return (
    <Modal open={open} onClose={onClose} width={600}>
      <ModalHeader
        title="新建模块 Agent"
        subtitle="只需说明它负责的模块/任务；会话标题由 Agent 启动后按模块自动设置"
        icon={<Plus size={16} />}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-faint">模块 / 任务</div>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={5}
          autoFocus
          placeholder="例如：订单模块——把订单导出改成流式 CSV，10 万行不 OOM；需要与支付模块对齐退款状态。"
          className="w-full resize-none rounded-md border border-line2 bg-sunken px-2.5 py-2 text-[11.5px] leading-relaxed placeholder:text-faint/70 focus:border-accent/40"
        />
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-soft px-3 py-2 text-[10px] leading-relaxed text-faint">
          <Sparkles size={11} className="mt-0.5 shrink-0 text-accent2" />
          <span>
            不需要选角色或填名称：所有 Agent 都是 <span className="text-dim">模块负责人</span>
            ，创建后由它用标题工具按模块自动命名。同一个模块已有负责人时，直接让经理派发即可，不必重复创建。
          </span>
        </div>
        <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[10px] leading-relaxed text-faint">
          {project.isGit ? (
            <>
              <div>
                <span className="text-dim">worktree</span> 自动创建独立工作区
              </div>
              <div>
                <span className="text-dim">branch</span> aide/&lt;模块&gt;-&lt;id&gt;
              </div>
            </>
          ) : (
            <>
              <div>
                <span className="text-dim">workdir</span> <span className="text-accent2">{project.path}</span>
              </div>
              <div>
                <span className="text-dim">git</span> 未启用（无 worktree / 分支 / 提交）
              </div>
            </>
          )}
          <div>
            <span className="text-dim">port</span> 自动分配 18080+
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <span className="text-[10px] text-faint">创建后立即启动，Agent 会先按模块设置标题</span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-md border border-line2 px-3 text-[11.5px] text-dim hover:bg-hover"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!task.trim()}
            onClick={() => {
              if (!task.trim()) return
              onCreate({ task: task.trim() })
              onClose()
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-3 text-[11.5px] font-medium text-white',
              task.trim() ? 'bg-accent hover:bg-accent2' : 'cursor-not-allowed bg-soft text-faint',
            )}
          >
            <Bot size={12} />
            创建并启动
          </button>
        </div>
      </div>
    </Modal>
  )
}
function toneColor(tone: string) {
  return (
    {
      accent: '#5b8cff',
      violet: '#a78bfa',
      ok: '#3fb950',
      warn: '#e3b341',
      run: '#58a6ff',
      dim: '#5c6874',
    }[tone] ?? '#5c6874'
  )
}

/* ------------------------------------------------------------------ */

export function AddProjectDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string, path: string) => void
}) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const derived = name.trim() || path.split(/[\\/]/).filter(Boolean).pop() || ''

  useEffect(() => {
    if (!open) {
      setPickerOpen(false)
      return
    }
    setPath('')
    setName('')
  }, [open])

  return (
    <Modal open={open} onClose={onClose} width={560}>
      <ModalHeader
        title="注册本地项目"
        subtitle="支持 Java / Python / Node.js / TypeScript 等项目；Git / SVN 可选，自动识别"
        icon={<FolderPlus size={16} />}
        onClose={onClose}
      />
      <div className="p-4">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-faint">项目路径</div>
        <div className="flex gap-2">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="例如 G:\workspace\my-app"
            className="h-8 min-w-0 flex-1 rounded-md border border-line2 bg-sunken px-2.5 font-mono text-[11.5px] placeholder:text-faint/60 focus:border-accent/40"
          />
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-line2 px-2.5 text-[11px] text-dim hover:bg-soft"
          >
            <FolderOpen size={12} /> 浏览
          </button>
        </div>
        <div className="mb-1 mt-3 text-[10px] uppercase tracking-wider text-faint">项目名称</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={derived || '默认使用文件夹名'}
          className="h-8 w-full rounded-md border border-line2 bg-sunken px-2.5 text-[11.5px] placeholder:text-faint/70 focus:border-accent/40"
        />
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-soft px-3 py-2 text-[10px] leading-relaxed text-faint">
          <Sparkles size={11} className="mt-0.5 shrink-0 text-accent2" />
          <span>
            <span className="text-dim">Git 项目</span>：每个 Agent 独立 worktree + 分支，支持提交/合并；<br />
            <span className="text-dim">SVN 项目</span>：共享工作副本，支持状态/日志/提交，不提供分支与合并；<br />
            <span className="text-dim">非版本控制项目</span>：直接在所选目录运行，不提供提交与分支，仍可使用 Agent 与运行预览。
          </span>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
        <button type="button" onClick={onClose} className="h-7 rounded-md border border-line2 px-3 text-[11.5px] text-dim hover:bg-hover">
          取消
        </button>
        <button
          type="button"
          disabled={!path.trim()}
          onClick={() => {
            if (!path.trim()) return
            onCreate(derived, path.trim())
            onClose()
          }}
          className={cn(
            'h-7 rounded-md px-3 text-[11.5px] font-medium text-white',
            path.trim() ? 'bg-accent hover:bg-accent2' : 'cursor-not-allowed bg-soft text-faint',
          )}
        >
          注册项目
        </button>
      </div>

      <FolderPicker
        open={pickerOpen}
        initialPath={path || undefined}
        onClose={() => setPickerOpen(false)}
        onSelect={(p) => {
          setPath(p)
          const base = p.split(/[\\/]/).filter(Boolean).pop() ?? ''
          if (!name.trim()) setName(base)
        }}
      />
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

export function BranchDialog({
  open,
  project,
  onClose,
  onMerged,
  onJumpSession,
}: {
  open: boolean
  project: Project
  onClose: () => void
  onMerged: () => void
  onJumpSession: (id: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [pruning, setPruning] = useState(false)
  const [result, setResult] = useState<{ branch: string; ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!open) {
      setBusy(null)
      setPruning(false)
      setResult(null)
    }
  }, [open])

  const toneColor: Record<string, string> = {
    accent: '#5b8cff',
    run: '#58a6ff',
    violet: '#a78bfa',
    warn: '#e3b341',
    err: '#ff6b6b',
    pink: '#f472b6',
    ok: '#3fb950',
    dim: '#5c6874',
  }

  const doMerge = async (branch: string) => {
    if (busy) return
    setBusy(branch)
    setResult(null)
    try {
      const r = await api.mergeBranch(project.id, branch)
      setResult({
        branch,
        ok: true,
        text: `已合并 ${branch} → ${project.branch}（${r.sha.slice(0, 7)}）。合并提交只在本地，需要时再推送主干。`,
      })
      onMerged()
    } catch (e: any) {
      const conflicts: string[] = e?.data?.conflicts ?? []
      setResult({
        branch,
        ok: false,
        text: `${e?.message ?? '合并失败'}${conflicts.length ? `；冲突文件：${conflicts.join('、')}` : ''}`,
      })
    } finally {
      setBusy(null)
    }
  }

  const prune = async () => {
    if (pruning || busy) return
    setPruning(true)
    setResult(null)
    try {
      const r = await api.pruneProject(project.id)
      setResult({
        branch: '',
        ok: true,
        text: `清理完成：移除 ${r.worktrees.length} 个失效 worktree、${r.branches.length} 个已合并分支。`,
      })
      onMerged()
    } catch (e: any) {
      setResult({ branch: '', ok: false, text: String(e?.message ?? '清理失败') })
    } finally {
      setPruning(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={860}>
      <ModalHeader
        title="分支与合并"
        subtitle={`${project.name} · 主干 ${project.branch} · ${project.branches.length} 个分支`}
        icon={<GitMerge size={16} />}
        onClose={onClose}
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-soft px-4 py-2 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <GitBranch size={10} />
          每个 Agent 一个 worktree
        </span>
        <span>·</span>
        <span>合并由 Agent 执行，冲突自动升级</span>
        <span className="ml-auto font-mono">合并直接写入主工作区</span>
      </div>

      {result && (
        <div
          className={cn(
            'mx-4 mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]',
            result.ok ? 'border-ok/30 bg-ok/[0.07] text-ok' : 'border-warn/30 bg-warn/[0.07] text-warn',
          )}
        >
          {result.ok ? <Check size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
          <div>
            <div className="font-medium">
              {result.ok ? (result.branch ? '合并完成' : '清理完成') : result.branch ? '合并冲突' : '清理失败'}
            </div>
            <div className="mt-0.5 text-dim">{result.text}</div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="grid grid-cols-[1fr_84px_1fr_78px_118px] gap-2 border-b border-line bg-soft px-3 py-1.5 text-[9px] uppercase tracking-wider text-faint">
            <span>分支</span>
            <span>领先 / 落后</span>
            <span>最近提交</span>
            <span>状态</span>
            <span className="text-right">操作</span>
          </div>

          {project.branches.map((b) => (
            <div
              key={b.name}
              className="grid grid-cols-[1fr_84px_1fr_78px_118px] items-center gap-2 border-b border-line/60 px-3 py-2 text-[11px] last:border-0 hover:bg-soft"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: toneColor[b.tone] ?? '#5c6874',
                    boxShadow: b.main ? `0 0 0 3px ${toneColor[b.tone] ?? '#5c6874'}22` : undefined,
                  }}
                />
                <span className="truncate font-mono text-ink">{b.name}</span>
                {b.main && <Chip tone="accent">主干</Chip>}
                {b.sessionId && (
                  <span className="shrink-0 text-[9px] text-faint">
                    {project.sessions.find((s) => s.id === b.sessionId)?.name}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 font-mono text-[10px]">
                <span className={b.ahead ? 'text-ok' : 'text-faint'}>
                  <ArrowUp size={8} className="inline" /> {b.ahead}
                </span>
                <span className={b.behind ? 'text-warn' : 'text-faint'}>
                  <ArrowDown size={8} className="inline" /> {b.behind ?? 0}
                </span>
              </div>

              <div className="min-w-0">
                <div className="truncate text-[10.5px] text-dim">{b.lastCommit ?? '—'}</div>
                <div className="text-[9px] text-faint">{b.time}</div>
              </div>

              <div>
                <Chip tone={b.status === 'changes' ? 'warn' : b.status === 'conflict' ? 'err' : 'dim'}>
                  {b.status === 'changes' ? '有改动' : b.status === 'conflict' ? '冲突' : '干净'}
                </Chip>
              </div>

              <div className="flex items-center justify-end gap-1">
                {b.sessionId && (
                  <button
                    type="button"
                    onClick={() => onJumpSession(b.sessionId!)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-accent2 hover:bg-accent/10"
                  >
                    会话
                  </button>
                )}
                {!b.main && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => doMerge(b.name)}
                    className={cn(
                      'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors',
                      busy === b.name
                        ? 'border-line2 text-faint'
                        : 'border-accent/35 bg-accent/10 text-accent2 hover:bg-accent/20',
                    )}
                  >
                    {busy === b.name ? <Loader2 size={9} className="animate-spin" /> : <GitMerge size={9} />}
                    {busy === b.name ? '合并中' : '合并'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 flex items-start gap-2 px-1 text-[9.5px] leading-relaxed text-faint">
          <AlertTriangle size={10} className="mt-0.5 shrink-0" />
          合并使用 --no-ff 保留分支历史；要求主工作区干净。出现冲突会立即回滚并列出冲突文件，可在后续版本交给 Agent 解决。
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void prune()}
            disabled={pruning || !!busy}
            className="flex items-center gap-1 rounded border border-line2 px-2 py-1 text-[10px] text-dim hover:bg-soft disabled:opacity-50"
            title="移除已删除会话的 worktree，并删除已合并的 aide/* 分支"
          >
            {pruning ? <Loader2 size={9} className="animate-spin" /> : <Trash2 size={9} />}
            清理已合并分支
          </button>
          <span className="font-mono text-[9.5px] text-faint">worktree 目录：.aide/worktrees/</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-md border border-line2 px-3 text-[11.5px] text-dim hover:bg-hover"
        >
          关闭
        </button>
      </div>
    </Modal>
  )
}
