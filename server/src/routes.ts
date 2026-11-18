import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { DB_PATH } from './config.js'
import { CLAUDE_INSTALL_HINT, claudeAvailable, claudeVersion, resolveClaudeBinary } from './claude.js'
import * as store from './db.js'
import { addClient, broadcast, clientCount, removeClient } from './events.js'
import { browseDirs } from './fsbrowse.js'
import { cancelToolchainInstall, getInstallerState, startToolchainInstall } from './installer.js'
import { listTree, readText } from './files.js'
import * as git from './git.js'
import { GitOpError, commitSession, mergeBranch, pruneProject, sessionGitStatus } from './gitops.js'
import { withProjectLock } from './lock.js'
import { appendNote, cancelKnowledgeJob, getKnowledge, getKnowledgeJob, startKnowledgeJob } from './knowledge.js'
import { detectStack, registerProject } from './projects.js'
import { RunError, getRunLogs, listRuns, startRun, stopRun, stopSessionRun, systemInfo } from './runtime.js'
import { svnDiff, svnInfo, svnLog, svnStatus } from './svn.js'
import { commitSvnSession } from './svncommit.js'
import {
  detectToolchain,
  getLocalUser,
  getToolchain,
  readSettings,
  saveSettings,
  validateJavaHome,
  validateMavenHome,
  validateNodePath,
  validatePythonPath,
  type UsageDisplay,
} from './settings.js'
import { createSession, deleteSession, ensureManagerSession, runtimeInfo, sendMessage, stopSession } from './sessions.js'

const ensureClaude = (reply: FastifyReply): boolean => {
  if (claudeAvailable()) return true
  reply.code(503).send({ error: CLAUDE_INSTALL_HINT, code: 'claude_missing' })
  return false
}

const vcsChanges = async (project: { path: string; vcs: string }) => {
  if (project.vcs === 'git') return git.statusFiles(project.path).catch(() => [])
  if (project.vcs === 'svn') return svnStatus(project.path).catch(() => [])
  return []
}

const fail = (reply: FastifyReply, err: unknown) => {  if (err instanceof GitOpError) {
    return reply.code(err.statusCode).send({ error: err.message, ...err.data })
  }
  if (err instanceof RunError) {
    return reply.code(err.statusCode).send({ error: err.message, ...err.data })
  }
  const message = err instanceof Error ? err.message : String(err)
  return reply.code(400).send({ error: message })
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    const version = claudeVersion()
    return {
      ok: true,
      service: 'aide-server',
      version: '0.3.0',
      claude: { bin: resolveClaudeBinary(), version, available: Boolean(version) },
      db: DB_PATH,
      sseClients: clientCount(),
      uptime: Math.round(process.uptime()),
    }
  })

  /* ----------------------------- settings ----------------------------- */

  app.get('/api/settings', async () => {
    const [toolchain, user] = await Promise.all([getToolchain(), getLocalUser()])
    return { settings: readSettings(), toolchain, user }
  })

  app.patch('/api/settings', async (req, reply) => {
    const body = (req.body ?? {}) as {
      javaHome?: string | null
      mavenHome?: string | null
      pythonPath?: string | null
      nodePath?: string | null
      usageDisplay?: UsageDisplay
    }
    const norm = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const patch: {
      javaHome?: string | null
      mavenHome?: string | null
      pythonPath?: string | null
      nodePath?: string | null
      usageDisplay?: UsageDisplay
    } = {}

    if ('javaHome' in body) {
      const home = norm(body.javaHome)
      if (home) {
        const check = await validateJavaHome(home)
        if (!check.ok) return reply.code(400).send({ error: check.error, field: 'javaHome' })
      }
      patch.javaHome = home
    }

    if ('mavenHome' in body) {
      const home = norm(body.mavenHome)
      const javaHome = patch.javaHome !== undefined ? patch.javaHome : readSettings().javaHome
      if (home) {
        const check = await validateMavenHome(home, javaHome)
        if (!check.ok) return reply.code(400).send({ error: check.error, field: 'mavenHome' })
      }
      patch.mavenHome = home
    }

    if ('pythonPath' in body) {
      const exe = norm(body.pythonPath)
      if (exe) {
        const check = await validatePythonPath(exe)
        if (!check.ok) return reply.code(400).send({ error: check.error, field: 'pythonPath' })
      }
      patch.pythonPath = exe
    }

    if ('nodePath' in body) {
      const exe = norm(body.nodePath)
      if (exe) {
        const check = await validateNodePath(exe)
        if (!check.ok) return reply.code(400).send({ error: check.error, field: 'nodePath' })
      }
      patch.nodePath = exe
    }

    if ('usageDisplay' in body) {
      if (body.usageDisplay !== 'both' && body.usageDisplay !== 'cost' && body.usageDisplay !== 'tokens') {
        return reply.code(400).send({ error: 'usageDisplay 需为 both / cost / tokens' })
      }
      patch.usageDisplay = body.usageDisplay
    }

    saveSettings(patch)
    const [toolchain, user] = await Promise.all([getToolchain(), getLocalUser()])
    return { settings: readSettings(), toolchain, user }
  })

  app.post('/api/settings/detect', async () => detectToolchain())

  app.get('/api/settings/install/status', async () => getInstallerState())

  app.post('/api/settings/install', async (req, reply) => {
    try {
      return startToolchainInstall()
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post('/api/settings/install/cancel', async () => cancelToolchainInstall())

  app.get('/api/fs/list', async (req, reply) => {
    const { path } = req.query as { path?: string }
    try {
      return browseDirs(path)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  /* ----------------------------- projects ----------------------------- */

  app.get('/api/projects', async () => {
    const projects = store.listProjects()
    return Promise.all(
      projects.map(async (p) => ({
        ...p,
        stack: await detectStack(p.path),
        sessionCount: store.listSessions(p.id).length,
      })),
    )
  })

  app.post('/api/projects', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { name?: string; path?: string }
      const project = await registerProject(body)
      return { ...project, stack: await detectStack(project.path) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    store.touchProject(id)
    return { ...project, stack: await detectStack(project.path) }
  })

  app.patch('/api/projects/:id/settings', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    const body = (req.body ?? {}) as { testCommand?: string | null; runCommand?: string | null }
    const norm = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    if ('testCommand' in body) store.setProjectTestCommand(id, norm(body.testCommand))
    if ('runCommand' in body) store.setProjectRunCommand(id, norm(body.runCommand))
    const updated = store.getProject(id)
    return { ...updated, stack: updated ? await detectStack(updated.path) : '未知' }
  })

  app.get('/api/projects/:id/knowledge', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    return getKnowledge(project)
  })

  app.get('/api/projects/:id/knowledge/status', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!store.getProject(id)) return reply.code(404).send({ error: '项目不存在' })
    return { job: getKnowledgeJob(id) }
  })

  app.post('/api/projects/:id/knowledge/generate', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    if (!ensureClaude(reply)) return reply
    try {
      return startKnowledgeJob(project)
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post('/api/projects/:id/knowledge/cancel', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!store.getProject(id)) return reply.code(404).send({ error: '项目不存在' })
    return { job: cancelKnowledgeJob(id) }
  })

  app.post('/api/projects/:id/notes', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    const body = (req.body ?? {}) as { title?: string; content?: string; sessionId?: string }
    const content = String(body.content ?? '').trim()
    if (!content) return reply.code(400).send({ error: '缺少 content' })
    const session = body.sessionId ? store.getSession(body.sessionId) : null
    const result = appendNote(project, {
      title: String(body.title ?? '记录'),
      content,
      sessionTitle: session?.title,
    })
    return { ok: true, ...result }
  })

  app.delete('/api/projects/:id', async (req, reply) => {    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    cancelKnowledgeJob(id)
    for (const session of store.listSessions(id)) {
      await stopSessionRun(session.id).catch(() => {})
      await deleteSession(session.id).catch(() => {})
    }
    store.deleteProjectRow(id)
    broadcast({ type: 'project.deleted', projectId: id, payload: { projectId: id } })
    return { ok: true }
  })

  /* ------------------------------- files ------------------------------- */

  app.get('/api/projects/:id/tree', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { path = '' } = req.query as { path?: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    try {
      const statuses = await vcsChanges(project)
      const map = new Map(statuses.map((s) => [s.path, s.status]))
      return { path, entries: await listTree(project.path, path, map) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/api/projects/:id/file', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { path } = req.query as { path?: string }
    if (!path) return reply.code(400).send({ error: '缺少 path' })
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    try {
      return { path, ...(await readText(project.path, path)) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  /* -------------------------------- git -------------------------------- */

  app.get('/api/projects/:id/git/status', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    if (project.vcs === 'none') return { isGit: false, vcs: 'none', branch: null, files: [], clean: true }
    if (project.vcs === 'svn') {
      try {
        const [info, files] = await Promise.all([svnInfo(project.path), svnStatus(project.path)])
        return {
          isGit: false,
          vcs: 'svn',
          branch: info.relativeUrl ?? 'svn',
          files,
          clean: files.length === 0,
        }
      } catch (err) {
        return fail(reply, err)
      }
    }
    try {
      const [branch, files, stats] = await Promise.all([
        git.currentBranch(project.path),
        git.statusFiles(project.path),
        git.numstatWithUntracked(project.path),
      ])
      return {
        isGit: true,
        vcs: 'git',
        branch,
        files: files.map((f) => ({ ...f, ...(stats.get(f.path) ?? { add: 0, del: 0 }) })),
        clean: files.length === 0,
      }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/api/projects/:id/git/log', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { limit = '30' } = req.query as { limit?: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    if (project.vcs === 'none') return { commits: [] }
    if (project.vcs === 'svn') {
      try {
        return { commits: await svnLog(project.path, Number(limit) || 30) }
      } catch (err) {
        return fail(reply, err)
      }
    }
    try {
      return { commits: await git.log(project.path, Number(limit) || 30) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/api/projects/:id/git/branches', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    if (project.vcs !== 'git') return { branches: [] }
    try {
      return { branches: await git.branches(project.path) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/api/projects/:id/git/diff', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { path } = req.query as { path?: string }
    if (!path) return reply.code(400).send({ error: '缺少 path' })
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    if (project.vcs === 'none') return reply.code(400).send({ error: '项目未使用版本控制，无法查看差异' })
    try {
      if (project.vcs === 'svn') return { path, diff: await svnDiff(project.path, path) }
      return { path, diff: await git.diff(project.path, path) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/api/projects/:id/git/merge', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    if (project.vcs !== 'git') return reply.code(400).send({ error: '非 Git 项目，无法合并' })
    const body = (req.body ?? {}) as { branch?: string }
    if (!body.branch) return reply.code(400).send({ error: '缺少 branch' })
    try {
      return await withProjectLock(project.id, () => mergeBranch(project, body.branch!))
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/api/projects/:id/git/prune', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    if (project.vcs !== 'git') return reply.code(400).send({ error: '非 Git 项目，无需清理' })
    try {
      return await withProjectLock(project.id, () => pruneProject(project))
    } catch (err) {
      return fail(reply, err)
    }
  })

  /* ------------------------------ sessions ------------------------------ */

  app.get('/api/projects/:id/sessions', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    await ensureManagerSession(project)
    return {
      sessions: store.listSessions(id).map((s) => ({
        ...s,
        isManager: s.title === '项目经理',
        runtime: runtimeInfo(s.id),
      })),
    }
  })

  app.post('/api/projects/:id/sessions', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    if (!ensureClaude(reply)) return reply
    try {
      const body = (req.body ?? {}) as { title?: string; role?: string; model?: string }
      const session = await createSession(project, body)
      return { ...session, runtime: runtimeInfo(session.id) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/api/sessions/:sid', async (req, reply) => {
    const { sid } = req.params as { sid: string }
    const session = store.getSession(sid)
    if (!session) return reply.code(404).send({ error: '会话不存在' })
    return { ...session, runtime: runtimeInfo(sid) }
  })

  app.patch('/api/sessions/:sid', async (req, reply) => {
    const { sid } = req.params as { sid: string }
    const session = store.getSession(sid)
    if (!session) return reply.code(404).send({ error: '会话不存在' })
    const body = (req.body ?? {}) as { title?: string }
    if (typeof body.title === 'string' && body.title.trim()) {
      store.updateSession(sid, { title: body.title.trim().slice(0, 40) })
      const updated = store.getSession(sid)!
      broadcast({
        type: 'session.updated',
        sessionId: sid,
        projectId: updated.projectId,
        payload: { session: { ...updated, runtime: runtimeInfo(sid) } },
      })
      return { ...updated, runtime: runtimeInfo(sid) }
    }
    return { ...session, runtime: runtimeInfo(sid) }
  })

  app.get('/api/sessions/:sid/messages', async (req, reply) => {
    const { sid } = req.params as { sid: string }
    const { limit = '500' } = req.query as { limit?: string }
    if (!store.getSession(sid)) return reply.code(404).send({ error: '会话不存在' })
    return { messages: store.listMessages(sid, Number(limit) || 500) }
  })

  app.post('/api/sessions/:sid/messages', async (req, reply) => {
    const { sid } = req.params as { sid: string }
    if (!ensureClaude(reply)) return reply
    try {
      const body = (req.body ?? {}) as { text?: string }
      if (!body.text) throw new Error('缺少 text')
      return sendMessage(sid, body.text)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/api/sessions/:sid/stop', async (req, reply) => {
    const { sid } = req.params as { sid: string }
    if (!store.getSession(sid)) return reply.code(404).send({ error: '会话不存在' })
    await stopSession(sid)
    return { ok: true }
  })

  app.delete('/api/sessions/:sid', async (req, reply) => {
    const { sid } = req.params as { sid: string }
    if (!store.getSession(sid)) return reply.code(404).send({ error: '会话不存在' })
    await deleteSession(sid)
    return { ok: true }
  })

  /* --------------------------- session git --------------------------- */

  app.get('/api/sessions/:sid/git/status', async (req, reply) => {
    const { sid } = req.params as { sid: string }
    const session = store.getSession(sid)
    if (!session) return reply.code(404).send({ error: '会话不存在' })
    const project = store.getProject(session.projectId)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    if (project.vcs === 'none') return { isGit: false, vcs: 'none', branch: '', files: [], clean: true }
    if (project.vcs === 'svn') {
      try {
        const [info, files] = await Promise.all([svnInfo(project.path), svnStatus(project.path)])
        return {
          isGit: false,
          vcs: 'svn',
          branch: info.relativeUrl ?? 'svn',
          files,
          clean: files.length === 0,
        }
      } catch (err) {
        return fail(reply, err)
      }
    }
    try {
      return { isGit: true, vcs: 'git', ...(await sessionGitStatus(session)) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/api/sessions/:sid/git/commit', async (req, reply) => {
    const { sid } = req.params as { sid: string }
    const session = store.getSession(sid)
    if (!session) return reply.code(404).send({ error: '会话不存在' })
    const project = store.getProject(session.projectId)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    if (project.vcs === 'none') return reply.code(400).send({ error: '项目未使用版本控制，无法提交' })
    if (runtimeInfo(sid).turnActive) {
      return reply.code(409).send({ error: 'Agent 正在执行，请等本轮结束后再提交', stage: 'busy' })
    }
    const body = (req.body ?? {}) as { message?: string; force?: boolean; skipTests?: boolean }
    try {
      return await withProjectLock(project.id, () =>
        project.vcs === 'svn' ? commitSvnSession(project, session, body) : commitSession(project, session, body),
      )
    } catch (err) {
      return fail(reply, err)
    }
  })

  /* ------------------------------ runtime ------------------------------ */

  app.get('/api/system', async () => {
    const stats = systemInfo()
    const all = listRuns()
    const active = all.filter((r) => r.status === 'starting' || r.status === 'ready' || r.status === 'running')
    return { ...stats, runs: all.length, active: active.length, portsUsed: active.map((r) => r.port) }
  })

  app.get('/api/projects/:id/runs', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!store.getProject(id)) return reply.code(404).send({ error: '项目不存在' })
    return { runs: listRuns({ projectId: id }) }
  })

  app.post('/api/sessions/:sid/run', async (req, reply) => {
    const { sid } = req.params as { sid: string }
    const session = store.getSession(sid)
    if (!session) return reply.code(404).send({ error: '会话不存在' })
    const project = store.getProject(session.projectId)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    const body = (req.body ?? {}) as { port?: number; command?: string }
    try {
      return await startRun(project, session, {
        port: body.port != null ? Number(body.port) : undefined,
        command: body.command,
      })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/api/sessions/:sid/run/stop', async (req, reply) => {
    const { sid } = req.params as { sid: string }
    if (!store.getSession(sid)) return reply.code(404).send({ error: '会话不存在' })
    const run = await stopSessionRun(sid)
    if (!run) return reply.code(404).send({ error: '该会话没有运行中的实例' })
    return run
  })

  app.get('/api/runs/:rid/log', async (req, reply) => {
    const { rid } = req.params as { rid: string }
    const { tail = '300' } = req.query as { tail?: string }
    try {
      return getRunLogs(rid, Number(tail) || 300)
    } catch (err) {
      return fail(reply, err)
    }
  })

  /* --------------------------- dispatch --------------------------- */

  app.post('/api/projects/:id/dispatch', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    const body = (req.body ?? {}) as {
      sessionId?: string
      task?: string
      reason?: string
      confidence?: number
      fromSessionId?: string
    }
    if (!body.sessionId) return reply.code(400).send({ error: '缺少 sessionId' })
    if (!body.task?.trim()) return reply.code(400).send({ error: '缺少 task' })

    const target = store.listSessions(id).find((s) => s.id === body.sessionId)
    if (!target) return reply.code(404).send({ error: '目标会话不存在' })
    if (!ensureClaude(reply)) return reply

    const result = sendMessage(target.id, body.task)

    if (body.fromSessionId) {
      const dispatchId = randomUUID()
      const rec = store.appendMessage(body.fromSessionId, 'assistant', 'dispatch', {
        dispatchId,
        sessionId: target.id,
        title: target.title,
        task: body.task,
        reason: body.reason ?? '',
        confidence: typeof body.confidence === 'number' ? body.confidence : 0.9,
        status: 'working',
      })
      const now = Date.now()
      store.insertDispatch({
        id: dispatchId,
        projectId: id,
        messageId: rec.id,
        fromSessionId: body.fromSessionId,
        toSessionId: target.id,
        task: body.task,
        status: 'working',
        createdAt: now,
        updatedAt: now,
      })
      broadcast({
        type: 'session.message',
        sessionId: body.fromSessionId,
        projectId: id,
        payload: { message: rec },
      })
    }

    return {
      ok: true,
      sessionId: target.id,
      title: target.title,
      branch: target.branch,
      queued: result.queued,
    }
  })

  app.post('/api/projects/:id/peer', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = store.getProject(id)
    if (!project) return reply.code(404).send({ error: '项目不存在' })
    const body = (req.body ?? {}) as { fromSessionId?: string; toSessionId?: string; text?: string }
    if (!body.fromSessionId || !body.toSessionId) {
      return reply.code(400).send({ error: '缺少 fromSessionId / toSessionId' })
    }
    const sessions = store.listSessions(id)
    const from = sessions.find((s) => s.id === body.fromSessionId)
    const to = sessions.find((s) => s.id === body.toSessionId)
    if (!from || !to) return reply.code(404).send({ error: '会话不存在' })
    if (from.id === to.id) return reply.code(400).send({ error: '不能给自己发协作消息' })
    if (!ensureClaude(reply)) return reply
    const text = String(body.text ?? '').trim()
    if (!text) return reply.code(400).send({ error: '缺少 text' })
    if (text.length > 4000) return reply.code(400).send({ error: '消息过长（上限 4000 字）' })

    const banner = `【跨模块协作 · 来自「${from.title}」】${text}\n\n（需要回复时，用 aide_message_agent 发给「${from.title}」；会话 id：${from.id}）`
    const result = sendMessage(to.id, banner)
    const rec = store.appendMessage(from.id, 'assistant', 'peer', {
      peerId: randomUUID(),
      toSessionId: to.id,
      toTitle: to.title,
      text,
      status: 'sent',
    })
    broadcast({
      type: 'session.message',
      sessionId: from.id,
      projectId: id,
      payload: { message: rec },
    })
    return { ok: true, sessionId: to.id, title: to.title, status: to.status, queued: result.queued }
  })

  app.post('/api/dispatches/:did/revoke', async (req, reply) => {
    const { did } = req.params as { did: string }
    const existing = store.getDispatch(did)
    if (!existing) return reply.code(404).send({ error: '派发记录不存在' })
    const d = store.revokeDispatchRecord(did)
    if (!d) return reply.code(404).send({ error: '派发记录不存在' })
    broadcast({
      type: 'dispatch.status',
      sessionId: d.fromSessionId,
      projectId: d.projectId,
      payload: { dispatchId: d.id, messageId: d.messageId, status: d.status, toSessionId: d.toSessionId },
    })
    return { ok: true, status: d.status }
  })

  /* -------------------------------- SSE -------------------------------- */

  app.get('/api/events', (req, reply) => {
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    })
    res.write('retry: 3000\n\n')
    const id = randomUUID()
    addClient(id, res)
    res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`)
    req.raw.on('close', () => removeClient(id))
  })
}
