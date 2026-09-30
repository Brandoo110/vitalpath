# AI 使用复盘

本轮由 Codex 按用户冻结的后端计划、原题和现有代码范围实施。最终判断以 schema、事务代码、自动化测试，以及独立 Supabase + Vercel 环境的实际迁移、公网 API、真实浏览器和数据库读回证据为准。各层验证分别记录，不用本地测试替代线上验收。

## 竞品数据流分析

本轮竞品分析继承既有挑战资料和设计笔记中对 BetterMe funnel 的观察；本次没有重新体验竞品页面或接口。AI 将这些既有观察整理为后端约束：匿名 session、分步恢复、核心健康字段与扩展问卷分离、支付前后字段白名单。竞品资料只用于设计启发，不作为 VitalPath 的线上证据，也没有照搬真实支付或登录。

## DB 建模

初始六表结构保留，但本轮把一致性边界落实到 Schema 与迁移：`Result` 绑定 `Assessment` 并记录 `sourceAssessmentVersion`、`calculatedAt`、`algorithmVersion`；`Subscription.status` 成为唯一订阅来源，套餐收敛为枚举；答案值列由 PostgreSQL CHECK 约束为恰好一个非空。迁移先检查旧用户/订阅状态冲突、孤立结果、非法套餐、非法已完成测评和多值答案，发现冲突直接失败，不静默删除或伪造历史。

## Mock 数据与测试数据

AI 先生成正常、异常和边界 payload；Codex 在实现和测试审查过程中按当前 schema、验证器和 API 合同筛选并执行 Vitest 用例：完整女性减重、男性增肌、扩展问卷、乱序 step、旧 version、非法 UUID/enum、数字字符串注入、`null` 数值、重复支付、不同套餐重放和真实并发 PATCH。数据库测试直接写本地 PostgreSQL，事务回滚测试通过停用题目定义触发真实持久化失败，不 mock 被测事务。

## 健康算法与复杂逻辑

AI 辅助把研究资料翻译为可审计的 `wellness-v2` 合同：保留 Mifflin-St Jeor 和产品活动系数，收窄成人/BMI 支持域，加入显式 `wellnessEligible`、目标方向和热量门槛，并用每天重算 REE/TDEE 的 `simplified_energy_balance_v1` 做最多 365 天情景投影。AI 方案曾倾向把固定减重速度包装成目标日期，我否决了它；不达目标时必须返回 `targetDate=null`，不能夹紧到一年。这个简化模型不是 Hall 动态模型，也没有把无明确许可证的公开重写当作验证。PATCH 与 submit 都锁定同一 assessment 行；submit 在事务快照内计算并 CAS 式检查 version；结果只允许在 `completed`、来源版本和算法版本相等时读取。支付以用户锁串行化首次激活，active 同套餐/省略套餐幂等，不同套餐返回 `plan_conflict`。

## AI 生成的测试边界

测试重点围绕用户可观察的完整链路，而不是只追求覆盖率：算法黄金值/边界、保存→恢复→提交→结果→支付、修改后失效、同版本重复 submit 稳定、同 version 并发 PATCH 一胜一冲突、免费字段不泄露、DB CHECK、真实 HTTP smoke 和单 worker 真浏览器回归。浏览器脚本对冻结范围内的顶部、预览条和支付卡三类入口分别使用独立 session 验证选中套餐，并覆盖支付成功后报告读取失败可重试、刷新恢复、算法过期和 stale 后保留匿名 session。本地与 CI 已覆盖隔离数据库迁移、Vitest、lint、类型检查、build、HTTP 和真实浏览器回归；线上验收另行使用独立环境和合成数据执行，结果如下。

## 线上验收与交付

2026-09-30，项目已部署到 [VitalPath 公网演示](https://vitalpath-pi.vercel.app)，数据保存在新建的 Supabase PostgreSQL 项目中。验收业务源码来自 `28fc8d1`；交付文档合并后的 `91b1871` 未改变业务源码，其[主分支 CI](https://github.com/Brandoo110/vitalpath/actions/runs/36690046123)也已通过。

- **自动化验证**：106 项测试 / 12 个文件，以及 lint、类型检查、构建、隔离迁移、HTTP、浏览器和失败清理检查通过。
- **真实数据库部署**：全部 10 个迁移成功，读回 7 张表（含迁移记录表）RLS 开启、8 条问卷定义；Data API 关闭，由服务端 Prisma 访问数据库。
- **公网 API**：使用合成 session 验证分步保存与恢复、非法数值拒绝、旧版本冲突、重复提交、非会员字段保护、模拟支付解锁及支付重放保留首次 paidAt；数据库读回确认结果来源版本和订阅状态一致。
- **真实浏览器**：完成填写、中途刷新恢复、可选题跳过、免费报告、模拟支付、完整建议与七天计划展开，并验证刷新后的会员报告恢复。

线上 URL、免费/已支付演示 session 和可重放的支付 cURL 统一维护在 [README](README.md#线上演示与验收)。公开演示 session 可被访问者修改，必要时从首页创建新的合成 session。

这些证据支持本次挑战流程可用，不代表真实支付、临床有效性、压力容量、长期稳定性或生产 SLA 已经过验证。

## 一次否决 AI 方案

曾有一个简单方案建议继续保留 `users.subscriptionStatus`，并在支付时同时更新 User 与 Subscription。这个方案会产生双状态漂移：并发支付或部分失败时，结果接口可能读到与订阅明细不同的状态。因此本轮迁移前显式检查旧双状态冲突，然后删除 User 的重复字段，结果和支付只读取/写入 `Subscription.status`，API 仍兼容返回名为 `subscriptionStatus` 的字段。

本次修正否决了 C1 中暴露的锁交接缺陷：旧实现对已有测评先锁 assessment，只有首次保存才锁 user，submit 也没有统一先锁 user，首次创建与提交因此没有一个共同的聚合根门禁。修正为 PATCH/submit 都先锁 user，再读取/锁 assessment；测试通过 `vi.spyOn` 包装 `lockUser`，先调用真实实现取得 PostgreSQL user 行锁，再在持锁事务内用可释放 gate 控制交错，验证首次创建三请求、既有 PATCH/submit 顺序和同版本 submit，而不依赖随机调度或 production 测试 hook。
