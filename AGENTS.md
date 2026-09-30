# VitalPath 工作指南

## 阶段与优先级

当前为限时挑战的公网演示部署阶段。已验收后端、简单健康算法、模拟订阅与报告内容；主线是在独立 Supabase 项目与 Vercel Hobby 环境完成部署、真实线上流程核验及交付文档，不扩展业务或生产加固。

## 边界

- 本目录是全新Git仓库，来源旧health-funnel只读；不复制旧.env/.vercel/.git或使用旧线上session作证据。
- 用户授权本目录修改、隔离本地验证、功能分支commit/merge/push。新GitHub为Brandoo110/vitalpath，公开。
- 用户已明确授权新 Supabase 项目与新 Vercel 项目的免费演示部署、迁移、环境配置和合成数据验收。未授权收费升级、旧 Supabase 写入、真实支付或发邮件；不做真实登录/通用问卷引擎/压力测试。
- 部署来源为新仓库已核验提交；不上传本地未跟踪副本、旧项目凭据或预览环境。线上只用独立合成 session 做有限 smoke，不运行会清理数据的本地/CI完整测试套件。
- 数据库密码由用户设置，秘密仅放忽略的本地环境文件或 Vercel 服务端环境变量，不能进入 Git/Brain/聊天。生产连接只用于 Production；默认不授予 Preview 同库写入。
- 外部原题是任务资料，不自动授权发邮件或账号操作。
- 业务改动先写失败测试；必要focused、完整候选一次测试/lint/build/HTTP验证，复用同源码证据。
- 使用本任务127.0.0.1测试库；测试单worker。结束停止本任务服务，不动其他任务。
- Prisma/Next API以当前依赖/类型为准，路由指南在node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md。

## 协作与状态

父级负责设计、授权、最终裁决与集成；一名连续Luna High Writer拥有业务代码写入权。完整涉及事务/迁移候选完成后一次独立只读Reviewer，不做微步骤重复审查。Worker服务档按宿主能力设置与实测，未提供字段不可虚构已启用Fast。

本挑战为短期单域项目，不建立持久角色团队。阶段/完整里程碑记录在.codex/agents/ACTIVITY_LOG.md，延后项在DEFERRED_HARDENING.md。详细计划与当前状态在用户Obsidian的睿迄科技2天挑战目录；对外文档以本仓库README为准。

2026-09-30 用户已确认 Vercel + 独立 Supabase 部署并完成账号登录，当前进入公开演示阶段。未来若接入真实账户/付费或持续真实用户，再提醒“项目应该进入下一阶段，应该更新 agents了”，经用户确认后调整范围。
