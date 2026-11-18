import { AlertTriangle, ArrowUp, Check, FlaskConical, GitCommit, Loader2, ShieldAlert, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type ApiGitFile } from './api'
import type { Session } from './types'
import { Chip, Modal, ModalHeader, cn } from './ui'

interface TestResult {
  status: 'passed' | 'failed' | 'skipped'
  label: string
  output: string
  durationMs: number
  reason?: string
}

interface CommitResult {
  sha: string
  shortSha: string
  message: string
  branch: string
  test: TestResult
  pushed: boolean
  remote: string | null
  pushError?: string
}

type Phase = 'loading' | 'review' | 'running' | 'failed' | 'done' | 'error'

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  M: { label: 'M', cls: 'text-warn' },
  A: { label: 'A', cls: 'text-ok' },
  D: { label: 'D', cls: 'text-err' },
  U: { label: 'U', cls: 'text-accent2' },
  R: { label: 'R', cls: 'text-violet' },
}

export function CommitDialog({
  open,
  session,
  vcs,
  onClose,
  onNotify,
  onDone,
}: {
  open: boolean
  session: Session | null
  vcs?: 'git' | 'svn' | 'none'
  onClose: () => void
  onNotify: (s: string) => void
  onDone: () => void
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [files, setFiles] = useState<ApiGitFile[]>([])
  const [branch, setBranch] = useState('')
  const [message, setMessage] = useState('')
  const [test, setTest] = useState<TestResult | null>(null)
  const [result, setResult] = useState<CommitResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const isSvn = vcs === 'svn'

  useEffect(() => {
    if (!open || !session) return
    setPhase('loading')
    setFiles([])
    setMessage('')
    setTest(null)
    setResult(null)
    setError(null)
    setArmed(false)
    let alive = true
    api
      .sessionGitStatus(session.id)
      .then((st) => {
        if (!alive) return
        setFiles(st.files)
        setBranch(st.branch)
        setPhase('review')
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      })
    return () => {
      alive = false
    }
  }, [open, session?.id])

  const submit = async (forced: boolean) => {
    if (!session) return
    setPhase('running')
    setError(null)
    setArmed(false)
    try {
      const r = await api.commitSession(session.id, { message: message.trim() || undefined, force: forced })
      setResult(r)
      setTest(r.test)
      setPhase('done')
      onDone()
      onNotify(
        r.pushed
          ? isSvn
            ? `已提交 SVN ${r.shortSha}`
            : `已提交并推送 ${r.shortSha}`
          : `已提交 ${r.shortSha}（未推送）`,
      )
    } catch (e: any) {
      const data = e?.data
      if (data?.stage === 'test' && data?.test) {
        setTest(data.test)
        setPhase('failed')
      } else {
        setError(String(data?.error ?? e?.message ?? e))
        setPhase('error')
      }
    }
  }

  if (!open || !session) return null

  const close = () => {
    if (phase === 'running') return
    onClose()
  }

  const added = files.reduce((a, f) => a + (f.add ?? 0), 0)
  const deleted = files.reduce((a, f) => a + (f.del ?? 0), 0)

  return (
    <Modal open={open} onClose={close} width={680}>
      <ModalHeader
        title={isSvn ? '提交到 SVN' : '提交并推送'}
        subtitle={`${session.name} · ${branch || session.branch} · ${session.worktree}`}
        icon={<GitCommit size={15} />}
        onClose={close}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {phase === 'loading' && (
          <div className="flex items-center gap-2 px-5 py-8 text-[12px] text-dim">
            <Loader2 size={14} className="animate-spin" /> 正在读取工作区状态…
          </div>
        )}

        {phase === 'review' && (
          <div className="px-5 py-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-faint">变更文件</span>
              <Chip tone="dim">{files.length}</Chip>
              {files.length > 0 && (
                <span className="font-mono text-[10px] text-faint">
                  <span className="text-ok">+{added}</span> <span className="text-err">-{deleted}</span>
                </span>
              )}
            </div>

            {files.length === 0 ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-3 text-[11.5px] text-dim">
                <Check size={13} className="text-ok" /> 工作区干净，没有可提交的改动。
              </div>
            ) : (
              <div className="mt-1 max-h-[190px] overflow-auto rounded-lg border border-line bg-sunken">
                {files.map((f) => {
                  const s = STATUS_STYLE[f.status] ?? STATUS_STYLE.M
                  return (
                    <div key={f.path} className="flex items-center gap-2 border-b border-line/60 px-2.5 py-1.5 last:border-0">
                      <span className={cn('w-3 shrink-0 font-mono text-[10px] font-bold', s.cls)}>{s.label}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink/85" title={f.path}>
                        {f.path}
                      </span>
                      <span className="shrink-0 font-mono text-[9.5px] text-faint">
                        <span className="text-ok">+{f.add ?? 0}</span> <span className="text-err">-{f.del ?? 0}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mb-1 mt-4 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-faint">
              <Sparkles size={11} /> 提交信息
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="留空由 Agent 根据 diff 生成（Conventional Commits）"
              className="w-full resize-none rounded-lg border border-line2 bg-sunken px-3 py-2 text-[12px] leading-relaxed placeholder:text-faint/70 focus:border-accent/40"
            />

            <div className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-soft/40 px-3 py-2">
              <FlaskConical size={13} className="mt-0.5 shrink-0 text-accent2" />
              <div className="min-w-0 text-[10.5px] leading-relaxed text-dim">
                <span className="text-ink">测试门禁</span> · 提交前自动检测并运行（Maven / Gradle / npm / pnpm / pytest / go / cargo）；
                未检测到命令时会跳过并记录原因。测试失败会阻止提交，可在结果页强制提交。
              </div>
            </div>
          </div>
        )}

        {phase === 'running' && (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-12">
            <Loader2 size={26} className="animate-spin text-accent2" />
            <div className="text-[12.5px] text-ink">正在运行测试并生成提交信息…</div>
            <div className="text-[10.5px] text-faint">首次生成提交信息可能需要 10–30 秒，请勿关闭</div>
          </div>
        )}

        {phase === 'failed' && test && (
          <div className="px-5 py-4">
            <div className="flex items-start gap-2 rounded-lg border border-err/30 bg-err/[0.06] px-3 py-2.5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-err" />
              <div>
                <div className="text-[12px] font-medium text-err">测试未通过，提交已阻止</div>
                <div className="mt-0.5 text-[10.5px] text-dim">
                  {test.label} · 耗时 {Math.max(1, Math.round(test.durationMs / 1000))}s。可以返回修改，或双重确认后强制提交。
                </div>
              </div>
            </div>
            <pre className="mt-2 max-h-[240px] overflow-auto rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-[10px] leading-[1.6] text-ink/75">
              {test.output || '（没有输出）'}
            </pre>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="px-5 py-4">
            <div className="flex items-start gap-2 rounded-lg border border-ok/25 bg-ok/[0.06] px-3 py-2.5">
              <Check size={15} className="mt-0.5 shrink-0 text-ok" />
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-ok">提交成功</div>
                <div className="mt-0.5 truncate font-mono text-[10.5px] text-dim">
                  {result.shortSha} · {result.branch}
                </div>
              </div>
              <Chip tone={result.pushed ? 'ok' : 'warn'}>{isSvn ? '已提交' : result.pushed ? '已推送' : '未推送'}</Chip>
            </div>

            <div className="mt-3 rounded-lg border border-line bg-sunken px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-wider text-faint">commit message</div>
              <div className="mt-1 text-[12px] text-ink">{result.message}</div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 text-[10.5px]">
              <div className="rounded-lg border border-line bg-sunken px-3 py-2">
                <div className="text-faint">测试门禁</div>
                <div className="mt-0.5 text-ink">
                  {result.test.status === 'passed' ? '通过' : result.test.status === 'failed' ? '失败' : '跳过'}
                  <span className="ml-1 text-faint">· {result.test.label}</span>
                </div>
              </div>
              <div className="rounded-lg border border-line bg-sunken px-3 py-2">
                <div className="text-faint">{isSvn ? '版本库' : '推送'}</div>
                <div className="mt-0.5 truncate text-ink">
                  {result.pushed
                    ? `${isSvn ? 'SVN' : result.remote ?? 'origin'} · ${result.branch}`
                    : result.remote
                      ? '推送失败'
                      : '未配置远程仓库'}
                </div>
              </div>
            </div>

            {result.pushError && (
              <pre className="mt-2 max-h-[120px] overflow-auto rounded-lg border border-warn/25 bg-warn/[0.05] px-3 py-2 font-mono text-[10px] text-warn/90">
                {result.pushError}
              </pre>
            )}
          </div>
        )}

        {phase === 'error' && (
          <div className="px-5 py-6">
            <div className="flex items-start gap-2 rounded-lg border border-err/30 bg-err/[0.06] px-3 py-2.5 text-[11.5px] text-err">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
        {phase === 'review' && (
          <>
            <span className="text-[10px] text-faint">
              提交目标：<span className="font-mono text-dim">{branch || session.branch}</span>
            </span>
            <button
              type="button"
              onClick={close}
              className="ml-auto h-7 rounded-md border border-line2 px-3 text-[11.5px] text-dim hover:bg-soft"
            >
              取消
            </button>
            <button
              type="button"
              disabled={files.length === 0}
              onClick={() => void submit(false)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-3 text-[11.5px] font-medium text-white',
                files.length === 0 ? 'cursor-not-allowed bg-soft text-faint' : 'bg-accent hover:bg-accent2',
              )}
            >
              <GitCommit size={12} /> {isSvn ? '提交到 SVN' : '提交并推送'}
            </button>
          </>
        )}

        {phase === 'running' && <span className="text-[10px] text-faint">正在执行，请勿关闭窗口…</span>}

        {phase === 'failed' && (
          <>
            <button
              type="button"
              onClick={() => {
                setPhase('review')
                setArmed(false)
              }}
              className="h-7 rounded-md border border-line2 px-3 text-[11.5px] text-dim hover:bg-soft"
            >
              返回修改
            </button>
            <div className="ml-auto flex items-center gap-2">
              {!armed ? (
                <button
                  type="button"
                  onClick={() => setArmed(true)}
                  className="flex h-7 items-center gap-1.5 rounded-md border border-err/40 bg-err/[0.08] px-3 text-[11.5px] text-err hover:bg-err/[0.14]"
                >
                  <ShieldAlert size={12} /> 仍然提交（强制）
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setArmed(false)}
                    className="h-7 rounded-md border border-line2 px-3 text-[11.5px] text-dim hover:bg-soft"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void submit(true)}
                    className="flex h-7 items-center gap-1.5 rounded-md bg-err px-3 text-[11.5px] font-medium text-white hover:bg-err/85"
                  >
                    <ShieldAlert size={12} /> 确认强制提交
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {(phase === 'done' || phase === 'error') && (
          <>
            {phase === 'error' && (
              <span className="text-[10px] text-faint">提交未完成，工作区保持原样</span>
            )}
            <button
              type="button"
              onClick={close}
              className="ml-auto h-7 rounded-md bg-accent px-3 text-[11.5px] font-medium text-white hover:bg-accent2"
            >
              关闭
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
