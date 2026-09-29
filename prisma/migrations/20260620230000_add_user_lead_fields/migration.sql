-- 报告生成后收集姓名和邮箱；不参与前置问卷，降低漏斗早期阻力。
ALTER TABLE "users" ADD COLUMN "name" TEXT;
ALTER TABLE "users" ADD COLUMN "email" TEXT;
