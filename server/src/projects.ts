import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as store from './db.js'
import { currentBranch, isGitRepo } from './git.js'
import { prepareKnowledge } from './knowledge.js'
import { isSvnRepo, svnInfo } from './svn.js'
import type { ProjectRecord } from './types.js'

export { detectStack } from './stacks.js'

export async function registerProject(input: { name?: string; path?: string }): Promise<ProjectRecord> {
  if (!input.path) throw new Error('缺少 path')
  const path = resolve(input.path)
  const st = await stat(path).catch(() => null)
  if (!st || !st.isDirectory()) throw new Error(`目录不存在：${path}`)

  const isGit = await isGitRepo(path)
  const isSvn = !isGit && isSvnRepo(path)
  const vcs: ProjectRecord['vcs'] = isGit ? 'git' : isSvn ? 'svn' : 'none'
  prepareKnowledge(path)
  const existing = store.findProjectByPath(path)
  if (existing) {
    store.touchProject(existing.id)
    return existing
  }

  const svn = isSvn ? await svnInfo(path) : null
  const rec: ProjectRecord = {
    id: randomUUID().slice(0, 8),
    name: input.name?.trim() || basename(path),
    path,
    mainBranch: isGit ? await currentBranch(path) : svn?.relativeUrl || (isSvn ? 'svn' : ''),
    testCommand: null,
    runCommand: null,
    isGit: isGit ? 1 : 0,
    vcs,
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  }
  return store.insertProject(rec)
}
