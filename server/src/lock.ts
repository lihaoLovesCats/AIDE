/**
 * 项目级写锁（内存队列）：同一项目的提交/合并串行执行，
 * 避免两个 Agent 同时操作主工作区或同时推送。
 * 会话文件写入本身由各自 worktree 隔离，不需要全局锁。
 */
const queues = new Map<string, Promise<unknown>>()

export function withProjectLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(projectId) ?? Promise.resolve()
  const run = prev.then(task, task)
  queues.set(
    projectId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}

export function pendingProjects(): string[] {
  return [...queues.keys()]
}
