# Vercel + Supabase 演示部署

本项目使用独立 Supabase PostgreSQL 和 Vercel 项目。数据流为浏览器 → Next.js API → Prisma → PostgreSQL；浏览器不使用 Supabase Data API。只有合成演示数据可以公开作为测试 session。

## 新建数据库

1. 创建独立 Supabase 项目，区域选东京 `ap-northeast-1`；关闭 Data API 与新表自动暴露，开启 automatic RLS。不要复用旧项目或旧 session。
2. 在 Connect 对话框复制实际连接字符串。Vercel 使用 transaction pooler（6543）；本地迁移使用 session pooler（5432），避免依赖本机 IPv6。不要根据区域自行拼接 pooler 主机名。
3. 从 Database → Settings → SSL configuration 下载根证书。数据库密码用 URL percent encoding，绝不提交到仓库。
4. 把迁移连接保存在本机 `.env.production.local`（已忽略），`DIRECT_URL` 设置 `sslmode=verify-full` 和指向下载证书的绝对 `sslrootcert` 路径。此文件只服务部署，不能拿来运行测试。
5. 确认目标是新项目且 public 下没有现有业务数据后，加载该文件运行迁移：

```sh
DOTENV_CONFIG_PATH=.env.production.local node -r dotenv/config node_modules/prisma/build/index.js migrate deploy
```

迁移是独立步骤；不要加入 Vercel build command，不要对线上库执行 `migrate reset`、`migrate dev`、`db push` 或本地/CI测试套件。验证 `_prisma_migrations` 全部成功、业务表 RLS 开启且问卷 seed 存在。

## Vercel 配置

从 GitHub 导入此仓库的 `main`，Next.js preset、根目录 `./`，沿用 `npm run build`（Prisma generate + Next build）。`vercel.json` 将函数设在东京 `hnd1`，靠近数据库。

只向 **Production** 配置两个服务端环境变量：

| 变量 | 内容 |
| --- | --- |
| `DATABASE_URL` | 新项目 transaction pooler 连接字符串；包含用户名与密码，不带 `ssl`、`sslmode`、`sslrootcert`、`sslcert`、`sslkey`、`sslnegotiation` |
| `DATABASE_SSL_CA` | 控制台下载的根证书完整 PEM，多行原文 |

证书是公开信任材料；应用显式开启证书校验。上述 URI SSL 参数不能与 CA 变量混配，否则应用拒绝启动，防止驱动覆盖传入的验证配置。`DIRECT_URL` 仅用于本地迁移，无需授予 Vercel 迁移凭据。不得使用 `NEXT_PUBLIC_` 前缀暴露连接信息，不要将正式演示库连接自动授权给 Preview。

环境变量修改不会更新已有 deployment；必须重新部署后再做接口读回。

## 线上验收

使用少量合成数据完成：创建 session → 分步保存 → 刷新恢复 → 提交 → 免费结果 → `/api/pay` → 会员完整报告。验证非法输入被拒、旧版本冲突、重复支付不改首次 paidAt、未付费响应没有受保护字段。另用真实浏览器完成填写、恢复、模拟支付和报告展示；首页能打开并不等于验收通过。

已付费 session 和公网 URL 仅在真实验证后填入 README。session 是匿名 bearer 身份，演示 session 必须只包含可公开的合成资料。真实登录、真实支付、临床效果和生产长期运行不在本挑战验收范围。

## 密码轮换与回滚

用户修改 Supabase 数据库密码后，同步更新本机迁移连接和 Vercel Production `DATABASE_URL`，重新部署并验证保存/结果接口。不要只改数据库密码而保留旧运行凭据。根证书无需随密码一起更换；证书到期或平台更换信任链时按官方说明更新。

应用回滚使用 Vercel 已验收的 deployment。数据库迁移要单独评估，回滚应用不会自动回滚数据库。初次迁移失败先核对日志及迁移历史，不自行清空库重试。

参考：[Supabase Prisma](https://supabase.com/docs/guides/database/prisma)、[PostgreSQL 连接与 SSL](https://supabase.com/docs/guides/database/connecting-to-postgres)、[Vercel regions](https://vercel.com/docs/project-configuration/vercel-json#regions)。
