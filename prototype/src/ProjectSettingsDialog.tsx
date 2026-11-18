import { BookOpen, FlaskConical, FolderCog, Loader2, Sparkles, Square, Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type ApiKnowledge, type ApiProject } from './api'
import type { Project } from './types'
import { Chip, Modal, ModalHeader, cn } from './ui'

export function ProjectSettingsDialog({
  open,
  project,
  onClose,
  onSaved,
  onNotify,
}: {
  open: boolean
  project: Project
  onClose: () => void
  onSaved: (p: ApiProject) => void
  onNotify: (s: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testCommand, setTestCommand] = useState('')
  const [runCommand, setRunCommand] = useState('')
  const [stack, setStack] = useState(project.stack)
  const [path, setPath] = useState(project.path)
  const [knowledge, setKnowledge] = useState<ApiKnowledge | null>(null)
  const [knowledgeLog, setKnowledgeLog] = useState<string[]>([])
  const [startingKnowledge, setStartingKnowledge] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    let alive = true
    api
      .project(project.id)
      .then((p) => {
        if (!alive) return
        setTestCommand(p.testCommand ?? '')
        setRunCommand(p.runCommand ?? '')
        setStack(p.stack ?? project.stack)
        setPath(p.path)
      })
      .catch((e) => onNotify('读取项目设置失败：' + (e instanceof Error ? e.message : String(e))))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, project.id])

  useEffect(() => {
    if (!open) return
    let alive = true
    api
      .knowledge(project.id)
      .then((k) => {
        if (!alive) return
        setKnowledge(k)
        setKnowledgeLog(k.job?.log ?? [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open, project.id])

  const knowledgeRunning = Boolean(knowledge?.job?.running)

  useEffect(() => {
    if (!open || !knowledgeRunning) return
    let alive = true
    const timer = setInterval(async () => {
      try {
        const r = await api.knowledgeStatus(project.id)
        if (!alive || !r.job) return
        setKnowledgeLog(r.job.log ?? [])
        setKnowledge((k) => (k ? { ...k, job: r.job } : k))
        if (!r.job.running) {
          const full = await api.knowledge(project.id)
          if (!alive) return
          setKnowledge(full)
          setKnowledgeLog(full.job?.log ?? [])
          onNotify(r.job.stage === 'done' ? '项目知识已生成' : '项目知识生成结束：' + (r.job.error ?? '请查看日志'))
        }
      } catch {
        /* ignore polling errors */
      }
    }, 1500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [open, project.id, knowledgeRunning])

  const generateKnowledge = async () => {
    setStartingKnowledge(true)
    try {
      const job = await api.generateKnowledge(project.id)
      const fresh = await api.knowledge(project.id).catch(() => null)
      setKnowledge((k) => (fresh ?? (k ? { ...k, job } : k)))
      setKnowledgeLog(job.log ?? fresh?.job?.log ?? [])
      onNotify('已启动项目知识整理')
    } catch (e) {
      onNotify('启动失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setStartingKnowledge(false)
    }
  }

  const cancelKnowledge = async () => {
    try {
      await api.cancelKnowledge(project.id)
      onNotify('已请求取消知识整理')
    } catch (e) {
      onNotify('取消失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.updateSettings(project.id, {
        testCommand: testCommand.trim() || null,
        runCommand: runCommand.trim() || null,
      })
      onSaved(updated)
      onNotify('项目设置已保存')
      onClose()
    } catch (e) {
      onNotify('保存失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={600}>
      <ModalHeader
        title="项目设置"
        subtitle={path}
        icon={<FolderCog size={15} />}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <div className="mb-4 flex items-center gap-2 text-[10px] text-faint">
          <Chip tone="dim">{stack || '未知'}</Chip>
          <span className="font-mono">{project.branch}</span>
          <span>· 命令留空时自动检测</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-[11.5px] text-dim">
            <Loader2 size={13} className="animate-spin" /> 正在读取设置…
          </div>
        ) : (
          <>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-ink">
              <FlaskConical size={12} className="text-accent2" /> 测试命令
              <span className="text-[9.5px] text-faint">提交前运行，失败会阻止提交</span>
            </div>
            <input
              value={testCommand}
              onChange={(e) => setTestCommand(e.target.value)}
              placeholder="例如 mvn -B -q test 或 npm test（留空自动检测）"
              className="h-8 w-full rounded-md border border-line2 bg-sunken px-2.5 font-mono text-[11px] text-ink placeholder:text-faint/70 focus:border-accent/40"
            />
            <div className="mt-1 text-[9.5px] leading-relaxed text-faint">
              未配置时依次尝试：<span className="font-mono">mvnw test</span> · <span className="font-mono">mvn test</span> ·{' '}
              <span className="font-mono">npm test</span>；没有可用命令时门禁显示“跳过”。
            </div>

            <div className="mb-1.5 mt-5 flex items-center gap-1.5 text-[11px] text-ink">
              <Terminal size={12} className="text-accent2" /> 运行命令
              <span className="text-[9.5px] text-faint">启动预览实例</span>
            </div>
            <input
              value={runCommand}
              onChange={(e) => setRunCommand(e.target.value)}
              placeholder="例如 mvn spring-boot:run、uvicorn main:app、npm run dev（留空自动检测）"
              className="h-8 w-full rounded-md border border-line2 bg-sunken px-2.5 font-mono text-[11px] text-ink placeholder:text-faint/70 focus:border-accent/40"
            />
            <div className="mt-1 text-[9.5px] leading-relaxed text-faint">
              AIDE 会注入 <span className="font-mono">PORT</span> / <span className="font-mono">SERVER_PORT</span>（端口池
              18080–18120）；Git 会话使用独立 worktree，SVN 使用共享工作副本；内存紧张时会拒绝新实例。
            </div>

            <div className="mt-5 border-t border-line pt-4">
              <div className="flex items-center gap-1.5 text-[11px] text-ink">
                <BookOpen size={12} className="text-accent2" /> 项目知识
                <span className="font-mono text-[9.5px] text-faint">.aide/</span>
                <button
                  type="button"
                  onClick={() => void generateKnowledge()}
                  disabled={knowledgeRunning || startingKnowledge}
                  className={cn(
                    'ml-auto flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-white',
                    knowledgeRunning || startingKnowledge
                      ? 'cursor-not-allowed bg-soft text-faint'
                      : 'bg-accent hover:bg-accent2',
                  )}
                >
                  {knowledgeRunning || startingKnowledge ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Sparkles size={10} />
                  )}
                  {knowledgeRunning ? '生成中…' : knowledge?.docs.length ? '更新知识' : '生成知识'}
                </button>
                {knowledgeRunning && (
                  <button
                    type="button"
                    onClick={() => void cancelKnowledge()}
                    className="flex h-6 items-center gap-1 rounded-md border border-line2 px-2 text-[10px] text-dim hover:bg-soft"
                  >
                    <Square size={9} /> 停止
                  </button>
                )}
              </div>

              <div className="mt-1.5 text-[9.5px] leading-relaxed text-faint">
                {knowledge?.sources.length
                  ? `检测到 ${knowledge.sources.length} 个现成来源：${knowledge.sources.map((s) => s.path).join('、')}`
                  : '未检测到 CLAUDE.md / .claude / AGENTS.md；将从代码与版本库日志整理'}
                {knowledge?.generatedAt ? `；最近更新 ${new Date(knowledge.generatedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}
              </div>

              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {['PROJECT.md', 'KNOWLEDGE.md', 'HISTORY.md'].map((name) => {
                  const doc = knowledge?.docs.find((d) => d.name === name)
                  return (
                    <div
                      key={name}
                      className={cn(
                        'rounded-md border px-2 py-1.5 text-[9.5px]',
                        doc ? 'border-line2 bg-panel2/60 text-dim' : 'border-dashed border-line text-faint',
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <span className={cn('h-1.5 w-1.5 rounded-full', doc ? 'bg-ok' : 'bg-faint')} />
                        <span className="truncate font-mono">{name}</span>
                      </div>
                      <div className="mt-0.5 text-[9px] text-faint">
                        {doc ? `${Math.max(1, Math.round(doc.size / 1024))} KB` : '未生成'}
                      </div>
                    </div>
                  )
                })}
              </div>

              {(knowledgeLog.length > 0 || knowledge?.job?.error) && (
                <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-sunken/70 px-2 py-1.5 font-mono text-[9px] leading-relaxed text-faint">
                  {knowledgeLog.slice(-10).join('\n')}
                  {knowledge?.job?.error ? `\n错误：${knowledge.job.error}` : ''}
                </pre>
              )}

              <div className="mt-1.5 text-[9px] leading-relaxed text-faint">
                写入项目根目录 .aide/，默认不纳入 Git；Agent 会把知识注入系统提示，并可用 aide_note 追加踩坑点。
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-line bg-soft/40 px-3 py-2 text-[9.5px] leading-relaxed text-faint">
              支持 Java（Maven/Gradle）、Python（FastAPI/Flask/Django）、Node（npm/pnpm/yarn/bun）、Go、Rust 与静态页面；
              未安装对应工具链时可在「设置 → 工具链」中配置或自动检测。
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-md border border-line2 px-3 text-[11.5px] text-dim hover:bg-soft"
        >
          取消
        </button>
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void save()}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-3 text-[11.5px] font-medium text-white',
            saving || loading ? 'cursor-not-allowed bg-soft text-faint' : 'bg-accent hover:bg-accent2',
          )}
        >
          {saving && <Loader2 size={11} className="animate-spin" />}
          保存
        </button>
      </div>
    </Modal>
  )
}
