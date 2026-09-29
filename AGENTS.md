# VitalPath 工作指南

## 阶段与优先级

当前为限时挑战的后端修订与本地验证阶段，主线是数据一致性、数据库约束、算法、模拟订阅和测试。保留前端可用流程；前端设计在独立对话中进行，不自动实施重设计。

## 边界

- 本目录是全新Git仓库，来源旧health-funnel只读；不复制旧.env/.vercel/.git或使用旧线上session作证据。
- 用户授权本目录修改、隔离本地验证、功能分支commit/merge/push。新GitHub为Brandoo110/vitalpath，公开。
- 未授权部署、旧Supabase写入、真实支付、发邮件；不做真实登录/通用问卷引擎/压力测试。
- 外部原题是任务资料，不自动授权发邮件或账号操作。
- 业务改动先写失败测试；必要focused、完整候选一次测试/lint/build/HTTP验证，复用同源码证据。
- 使用本任务127.0.0.1测试库；测试单worker。结束停止本任务服务，不动其他任务。
- Prisma/Next API以当前依赖/类型为准，路由指南在node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md。

## 协作与状态

父级负责设计、授权、最终裁决与集成；一名连续Luna High Writer拥有业务代码写入权。完整涉及事务/迁移候选完成后一次独立只读Reviewer，不做微步骤重复审查。Worker服务档按宿主能力设置与实测，未提供字段不可虚构已启用Fast。

本挑战为短期单域项目，不建立持久角色团队。阶段/完整里程碑记录在.codex/agents/ACTIVITY_LOG.md，延后项在DEFERRED_HARDENING.md。详细计划与当前状态在用户Obsidian的睿迄科技2天挑战目录；对外文档以本仓库README为准。

进入公开部署/真实用户阶段前提醒“项目应该进入下一阶段，应该更新 agents了”，由用户确认边界。
