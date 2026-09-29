> 本文随既有源码导入，记述此前项目的协作过程。VitalPath 本轮修改与验证尚在进行，历史上线/测试结论不代表新仓库当前验证。交付时更新本轮复盘。

# AI 使用复盘

本项目主要使用两个 AI 工具协助完成：

- **Codex**：负责代码实现、测试补全、文档整理、命令验证和交付物收口。
- **Claude Code**：负责对技术设计书、数据库 schema、API 设计、测试清单和前端方案进行审核。

协作分工为：Codex 负责执行，Claude 负责审核，我负责确定技术边界、保留或否决方案，并检查实现是否和交付目标一致。

## 1. 竞品数据流分析

项目启动阶段先分析了 BetterMe Pilates funnel。分析方式包括浏览器开发者工具、网络请求记录、localStorage 数据和页面流转状态，而不是只看页面截图。

观察到的关键数据流如下：

- 首屏选择年龄后，BetterMe 调用 `POST /api/v3/questionnaires` 创建后端 questionnaire。
- 会话身份由服务端生成 UUID，前端 URL 中携带 `order=<uuid>`。
- 服务端自动补充 `country`、`ipCountry`、`ipRegion`、`platform`、`createdAt`、UTM 等元数据。
- 前端进度主要保存在 `localStorage.quiz_progress`，其中包含 `step`、`answers`、`rawAnswers`、`healthDataConsent` 和 `meta.version`。
- `answers` 按 `required`、`extra`、`optional/rawAnswers` 分层，说明竞品同时维护标准健康字段和可扩展问卷字段。
- 未支付状态下，接口中 `paidOrder:null`，完整计划和付费内容不会直接开放。

这些信息用于校准本项目的后端设计：服务端生成 session、后端保存进度、保留健康数据同意状态、区分核心字段和扩展问题、订阅前后返回不同数据结构。

## 2. 基于竞品的设计取舍

BetterMe 的完整链路包含大量营销页、生活方式问题、折扣策略和支付链路。本项目只吸收与后端骨架相关的部分，避免照搬不必要的复杂度。

### 2.1 会话设计

BetterMe 使用 `questionnaire/order` 表达一次测评。本项目采用：

- `POST /api/sessions` 创建匿名 session。
- 后端生成 UUID，作为前端后续使用的 `sessionId`。
- 所有测评、结果、支付接口都围绕同一个 `sessionId` 工作。

这样保留了“后端生成身份”的关键做法，同时使用更通用的资源命名。

### 2.2 分步保存和恢复

BetterMe 的前端进度大量依赖 localStorage。本项目改为后端持久化：

- 每一步提交后调用 `PATCH /api/assessment`。
- 服务端保存增量字段、当前 `step` 和 `version`。
- 刷新或中断后通过 `GET /api/assessment?sessionId=...` 恢复进度。

这个设计能覆盖真实用户中断、刷新、重复点击和旧页面继续提交的情况。

完整的持久化链路是：创建 session 时写入 `users`；分步填写时写入 `assessments` 和 `assessment_answers`；提交测评时读取已保存数据并写入 `results`；报告生成后补写 `users.name` 和 `users.email`；支付回调后更新 `users.subscriptionStatus` 并写入 `subscriptions`。结果页每次都通过 `sessionId` 读取数据库状态，而不是依赖前端内存状态。

### 2.3 字段建模

BetterMe 使用 question id 存储大量 `answers.extra` 和 `rawAnswers`。本项目没有采用“一张 JSON 大表”，而是使用“核心字段显式列 + 扩展问题/答案表”的关系模型。

核心健康字段落在 `assessments`：

- `gender`
- `goal`
- `age`
- `heightCm`
- `weightKg`
- `targetWeightKg`
- `activityLevel`

这些字段直接参与 BMI、BMR/TDEE、目标日期和热量计算，因此需要明确的 Zod 校验、Prisma 类型和数据库字段。

扩展问题通过 `questionnaire_questions` 和 `assessment_answers` 保存：

- `pacePreference`
- `workoutDaysPerWeek`
- `sessionMinutes`
- `workoutLocation`
- `dietPreference`
- `sleepHours`
- `stressLevel`
- `mainBarrier`

这样保留了核心字段的强约束，也给后续新增非核心问卷问题留下扩展空间。相比全量 JSON，这种结构更容易审查、测试和画 schema 图；相比继续向 `assessments` 加列，也更适合扩展。

### 2.4 订阅前后差异

BetterMe 未支付时不会开放完整 paid plan。本项目将这点转化为模拟订阅闭环：

- 免费用户只能看到 BMI、BMI 分类、宽泛热量区间和计划预览。
- 免费用户拿不到精确 `recommendedCalories`、`targetDate` 和完整 `plan`。
- `POST /api/pay` 更新数据库中的订阅状态。
- 同一个 `sessionId` 再次请求 `GET /api/results` 时，才返回完整结果。

权限边界由后端接口控制，而不是只靠前端模糊处理。

## 3. 数据库建模中的 AI 协作

数据库设计先由 AI 根据竞品数据流生成候选结构，再结合项目边界收敛成 6 张关系表：

- `users`
- `assessments`
- `questionnaire_questions`
- `assessment_answers`
- `results`
- `subscriptions`

### 3.1 `users`

`users` 表不是传统登录用户表，而是匿名会话主体。它保存：

- `id`：后端生成的 UUID，也就是 `sessionId`
- `name` / `email`：报告生成后收集的 lead 信息
- `subscriptionStatus`：当前订阅状态
- `healthDataConsent`：健康数据同意状态

### 3.2 `assessments`

`assessments` 保存核心健康字段和测评状态：

- 核心健康字段用于服务端健康算法。
- `step` 支撑进度恢复。
- `completed` 区分填写中和已提交。
- `version` 用于乐观并发控制，避免旧页面覆盖新数据。

### 3.3 `questionnaire_questions` 和 `assessment_answers`

这两张表负责扩展问卷：

- `questionnaire_questions` 保存问题 key、文案、分组、值类型、排序和启用状态。
- `assessment_answers` 保存某次测评对某个问题的答案，按 `valueText`、`valueNumber`、`valueBoolean`、`valueJson` 分列落值。

后续如果增加生活方式、饮食禁忌、训练限制等问题，只需要增加问题定义和对应校验，不需要继续改 `assessments` 主表结构。

### 3.4 `results`

`results` 保存服务端计算产物。输入和输出分表的原因是：

- `assessments` 表示用户填写的数据。
- `results` 表示服务端计算后的结果。
- 重复 submit 时可以更新同一份结果，不会生成多份互相冲突的报告。

### 3.5 `subscriptions`

`subscriptions` 保存模拟订阅快照，`users.subscriptionStatus` 作为结果接口的快速鉴权字段。真实系统可以继续拆出订单表、支付事件表和退款记录；当前实现保留了替换成 webhook 的接口形态，但没有引入真实支付系统。

## 4. Mock 数据和测试数据

AI 主要用于生成覆盖面更完整的测试 payload，再由我筛选和调整。

有效数据覆盖：

- 完整健康测评用户
- 不同 `goal`
- 不同 `activityLevel`
- 不同训练频率、饮食偏好、睡眠、压力和主要阻碍
- 免费用户和已支付用户

异常数据覆盖：

- 缺失核心健康字段
- 非法 `sessionId`
- 格式合法但数据库不存在的 UUID
- 非法 enum
- 身高、体重、年龄、目标体重越界
- 数字字段传字符串
- 数字字段传 `null`
- 字符串注入式输入
- 乱序 step
- 重复 step
- stale version 并发冲突

这些数据最后固化到 Vitest 中，避免只靠手动点击验证。

## 5. 健康算法设计

健康算法放在 `lib/health.ts`，以纯函数实现，不依赖数据库。API route 只负责校验、读写数据库和鉴权。

### 5.1 输入校验

算法入口先校验输入：

- `gender` 只能是 `male` 或 `female`。
- `goal` 只能是 `lose_weight`、`gain_muscle`、`keep_fit`、`get_toned`。
- `activityLevel` 只能是 `sedentary`、`light`、`moderate`、`high`。
- `pacePreference` 可选，只能是 `gentle`、`standard`、`aggressive`。
- `age` 必须是 13 到 120 的整数。
- `heightCm` 必须在 50 到 300 之间。
- `weightKg` 必须在 20 到 500 之间。
- `targetWeightKg` 必须在 20 到 500 之间。
- 目标 BMI 必须在 10 到 60 之间，避免生成明显不合理的目标。

### 5.2 BMI 和 BMI 分类

BMI 计算公式：

```txt
BMI = weightKg / (heightCm / 100)^2
```

结果保留一位小数。分类规则：

| BMI 范围        | 分类            |
| ------------- | ------------- |
| `< 18.5`      | `underweight` |
| `18.5 - 24.9` | `normal`      |
| `25.0 - 29.9` | `overweight`  |
| `>= 30`       | `obese`       |

### 5.3 BMR 和 TDEE

BMR 使用 Mifflin-St Jeor 公式：

```txt
base = 10 * weightKg + 6.25 * heightCm - 5 * age
male   BMR = base + 5
female BMR = base - 161
```

TDEE 根据活动水平乘以活动系数：

| activityLevel | 系数    |
| ------------- | -----:|
| `sedentary`   | 1.2   |
| `light`       | 1.375 |
| `moderate`    | 1.55  |
| `high`        | 1.725 |

```txt
TDEE = BMR * activityMultiplier
```

### 5.4 建议热量

建议热量由目标和节奏共同决定：

| goal          | 规则                                   |
| ------------- | ------------------------------------ |
| `lose_weight` | `TDEE - deficit`，最低不低于 1200 kcal     |
| `gain_muscle` | `TDEE + surplus`                     |
| `get_toned`   | `TDEE - toneDeficit`，最低不低于 1200 kcal |
| `keep_fit`    | `TDEE`                               |

减重缺口：

- `gentle`: 250 kcal
- `standard`: 500 kcal
- `aggressive`: 500 kcal

增肌盈余：

- `gentle`: 150 kcal
- `standard`: 300 kcal
- `aggressive`: 400 kcal

塑形缺口：

- `gentle`: 150 kcal
- `standard`: 250 kcal
- `aggressive`: 300 kcal

`aggressive` 减重不会超过 500 kcal 缺口，避免为了迎合用户偏好生成过低热量。

### 5.5 目标日期

目标日期使用固定变化速度估算：

```txt
days = ceil(abs(weightKg - targetWeightKg) / 0.75 * 7)
targetDate = today + days
```

`0.75 kg/week` 取 BetterMe 页面中 `0.45-0.90 kg/week` 的中间值。这个值足够保守，也便于测试稳定。

### 5.6 计划生成

计划生成在 `lib/plan.ts` 中完成，使用健康目标和扩展问卷答案：

- `workoutDaysPerWeek` 决定每周训练频率。
- `sessionMinutes` 决定单次训练长度。
- `workoutLocation` 决定 home / gym / mixed 的训练表达。
- `dietPreference` 决定饮食建议口径。
- `sleepHours` 和 `stressLevel` 决定恢复建议。
- `mainBarrier` 决定每日行动建议。

因此问卷不是装饰字段，而是会影响最终计划内容。

## 6. 测试用例和边界场景

测试设计从核心风险出发，而不是只覆盖正常流程。

### 6.1 健康算法单元测试

位置：`lib/health.test.ts`

覆盖内容：

- BMI 分类边界
- 极端但合法的年龄、身高、体重
- 非法年龄、身高、体重、目标体重
- 缺失运行时字段
- 不合理目标 BMI
- 热量下限
- 不同目标节奏

### 6.2 测评保存和恢复测试

位置：`tests/api/assessment.test.ts`

覆盖内容：

- 空进度恢复
- 分步保存
- 中断后恢复
- 同一步重复保存
- 乱序提交不会让 step 倒退
- stale version 返回冲突
- 非法 UUID 提前返回 400
- 不存在 UUID 返回 404
- 非法 enum 和越界数字
- 数字注入和 `null` 数值
- 扩展问卷答案写入 `assessment_answers`

### 6.3 提交、结果和支付闭环测试

位置：`tests/api/submit-results-pay.test.ts`

覆盖内容：

- 缺必填字段不能生成结果
- 完整测评可以生成结果
- 重复 submit 更新同一份结果
- 未 submit 时查结果返回业务错误
- 免费用户拿不到受保护字段
- `/api/pay` 后同一个 session 返回完整结果
- `/api/pay` 幂等
- 不存在的合法 UUID 返回 404
- 非法 UUID 返回 400

这里重点验证订阅状态来自数据库，而不是前端页面状态。

### 6.4 CI 和暂未覆盖项

本地一键测试命令是：

```bash
npm test
```

GitHub Actions 在 push / pull request 时自动执行 Prisma generate、migration、lint、test 和 build。

暂未纳入 `npm test` 的内容：

- 完整浏览器 E2E：当前用 Playwright CLI 做本地 smoke，仓库测试重点放在后端闭环和接口边界。
- 真实 Stripe：当前实现是模拟订阅回调，不引入真实支付依赖。
- serverless 压测：当前交付重点是数据建模、状态流转和权限边界。

## 7. 项目管理文档维护

AI 同时用于整理项目过程文档，使设计、实现、测试和交付材料保持一致。

维护过的主要文件：

- `任务描述.md`：保存原始需求。
- `竞品数据流分析.md`：记录 BetterMe funnel 中观察到的接口、localStorage 和订阅差异。
- `技术设计书.md`：记录 API、数据库 schema、持久化、订阅闭环、计划生成规则和测试设计。
- `实施计划书.md`：拆分实现阶段。
- `AI协作日志.md`：记录关键设计取舍和审核意见。
- `devlog.md`：记录实现内容、验证命令和变更原因。
- `README.md`：整理最终交付入口，包括线上链接、启动方式、API 文档、`/api/pay` cURL、已支付 sessionId、测试和 CI 说明。

## 8. 否决或纠正过的 AI 方案

### 8.1 否决前端假解锁

早期方案曾建议点击订阅按钮后直接切换到完整报告，或者前端一次性拿到完整数据后用 CSS 模糊部分内容。这个方案实现快，但权限边界不成立。

最终采用后端状态作为订阅真相源：

- `/api/results` 根据数据库中的 `subscriptionStatus` 返回不同结构。
- 未支付用户响应中不包含精确 `recommendedCalories`、`targetDate` 和完整 `plan`。
- `/api/pay` 作为模拟支付回调，更新订阅状态。
- 自动化测试断言免费响应不存在受保护字段。

### 8.2 否决一张 JSON 大表

竞品问卷数据中存在大量 `answers.extra`、`rawAnswers` 和 question id。早期候选方案倾向于把所有答案都放进一个 JSON 字段，后端按 key 读取。

该方案没有采用，原因是：

- Schema 图看不出核心业务字段。
- 字段选择无法体现健康测评系统的业务判断。
- Zod 校验和 Prisma 类型约束会变弱。
- 边界测试难以对应到具体字段。

最终采用混合关系模型：

- `assessments` 保存核心健康字段和测评状态。
- `questionnaire_questions` 保存扩展问题定义。
- `assessment_answers` 保存某次测评的扩展答案。
- `results` 保存服务端计算结果。
- `subscriptions` 保存模拟订阅状态。

这个方案保留了核心字段的强约束，也支持后续继续增加非核心问卷问题。

### 8.3 纠正展示层脱敏

早期页面方案偏向在前端用模糊效果隐藏完整计划。这个做法可以形成视觉上的 paywall，但不能保证接口数据安全。

最终把脱敏边界放在 API 层：

- 免费用户只返回 `recommendedCaloriesRange`，不返回 `recommendedCalories`。
- 免费用户只返回 `planPreview`，不返回完整 `plan.sections`。
- 付费后才返回精确目标日期、精确热量和完整计划。
- 测试直接检查免费响应不存在受保护字段。

## 9. 总结

本项目中，AI 的主要价值在于加快竞品分析、候选 schema、测试数据、边界场景和实现草稿的产出。关键技术判断仍由人工完成，包括数据库模型、订阅权限边界、脱敏位置、算法安全边界和测试覆盖范围。

最终设计原则：

- 参考竞品的数据流，不复制完整营销系统。
- API 路径保持语义清楚。
- 核心健康字段强约束，扩展问卷用关系表承接。
- 后端状态作为权限真相源。
- 非会员和会员的数据差异由 API 保证。
- 测试覆盖核心路径、边界输入和异常状态。
