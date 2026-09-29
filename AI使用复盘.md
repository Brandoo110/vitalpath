# AI 使用复盘

本轮由 Codex 在用户冻结的后端计划、原题和现有代码范围内实施，Claude 作为只读审核角色保留在项目分工中。最终判断以 schema、事务代码、测试和本地 HTTP 证据为准。

## 竞品数据流分析

AI 协助把 BetterMe funnel 的观察整理为后端约束：匿名 session、分步恢复、核心健康字段与扩展问卷分离、支付前后字段白名单。竞品的页面和接口只用于设计启发，不作为 VitalPath 的线上证据，也没有照搬真实支付或登录。

## DB 建模

初始六表结构保留，但本轮把一致性边界落实到 Schema 与迁移：`Result` 绑定 `Assessment` 并记录 `sourceAssessmentVersion`、`calculatedAt`、`algorithmVersion`；`Subscription.status` 成为唯一订阅来源，套餐收敛为枚举；答案值列由 PostgreSQL CHECK 约束为恰好一个非空。迁移先检查旧用户/订阅状态冲突、孤立结果、非法套餐、非法已完成测评和多值答案，发现冲突直接失败，不静默删除或伪造历史。

## Mock 数据与测试数据

AI 先生成正常、异常和边界 payload，再人工收敛为 Vitest 用例：完整女性减重、男性增肌、扩展问卷、乱序 step、旧 version、非法 UUID/enum、数字字符串注入、`null` 数值、重复支付、不同套餐重放和真实并发 PATCH。数据库测试直接写本地 PostgreSQL，事务回滚测试通过停用题目定义触发真实持久化失败，不 mock 被测事务。

## 健康算法与复杂逻辑

健康算法保持题目已有 Mifflin-St Jeor、BMI、TDEE、目标日期和计划生成规则，只增加结果有限性/正值门禁。PATCH 与 submit 都锁定同一 assessment 行；submit 在事务快照内计算并 CAS 式检查 version；结果只允许在 `completed` 且来源版本相等时读取。支付以用户锁串行化首次激活，active 同套餐/省略套餐幂等，不同套餐返回 `plan_conflict`。

## AI 生成的测试边界

测试重点围绕用户可观察的完整链路，而不是只追求覆盖率：保存→恢复→提交→结果→支付、修改后失效、同版本重复 submit 稳定、同 version 并发 PATCH 一胜一冲突、免费字段不泄露、DB CHECK 和真实 HTTP smoke。当前验证为本地迁移、Vitest、lint、build 和本地 production HTTP；没有把本地结果扩写成线上部署、真实支付或临床结论。

## 一次否决 AI 方案

曾有一个简单方案建议继续保留 `users.subscriptionStatus`，并在支付时同时更新 User 与 Subscription。这个方案会产生双状态漂移：并发支付或部分失败时，结果接口可能读到与订阅明细不同的状态。因此本轮迁移前显式检查旧双状态冲突，然后删除 User 的重复字段，结果和支付只读取/写入 `Subscription.status`，API 仍兼容返回名为 `subscriptionStatus` 的字段。

另一个被否决的测试思路是只用顺序调用或随机 `Promise.all` 证明并发；最终保留同一 version 的实际并行请求，并用数据库行锁实现确定性串行门禁，同时保留 stale version 和事务失败回滚测试。
