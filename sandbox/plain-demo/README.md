# plain-demo

这是一个**非 Git** 示例目录，用来验证 AIDE 在不使用 Git 时的行为：

- 注册项目不要求 `.git`；
- Agent 直接在该目录运行，不创建 worktree / 分支；
- Git 面板显示“非 Git 项目”，禁用提交、分支与合并；
- 测试门禁与运行预览仍可使用（如配置 `runCommand`）。
