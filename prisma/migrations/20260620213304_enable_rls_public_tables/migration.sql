-- Supabase Security Advisor: public schema tables should have RLS enabled.
-- 本项目所有数据访问都经过 Next.js API + Prisma，不开放 Supabase anon 直连表策略。
alter table if exists public._prisma_migrations enable row level security;
alter table public.users enable row level security;
alter table public.assessments enable row level security;
alter table public.results enable row level security;
alter table public.subscriptions enable row level security;
