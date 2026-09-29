# VitalPath

健康测评后端挑战：分步保存、状态恢复、服务端计算、模拟订阅、字段权限与自动化测试。

本仓库从本人先前健康测评项目的源码快照开始，采用独立 Git 历史；本次后端改进和验证按功能分支交付。

- 仓库：https://github.com/Brandoo110/vitalpath
- 当前阶段：导入基线，后端修订进行中。
- 新线上地址与已支付演示 session：待独立部署和验证，旧项目线上证据不适用于本仓库。
- 技术栈：Next.js 16.2.9、TypeScript、Prisma 7.8、PostgreSQL、Zod 4、Vitest 4。

## 本地环境

安装依赖 `npm ci`，为独立的本地/测试 PostgreSQL 配置 `DATABASE_URL` 和 `DIRECT_URL`，随后运行：

```sh
npx prisma generate
npx prisma migrate deploy
npm test -- --maxWorkers=1
npm run build
```

不要将测试指向线上数据库。API 文档、Schema 图、测试与 AI 复盘在后端修订完成时更新。
