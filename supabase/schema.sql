-- 이유식 식단표: 가입한 사람 모두가 함께 보는 식단 한 벌
create table if not exists public.plan (
  id int primary key,
  data jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.plan (id) values (1) on conflict (id) do nothing;

alter table public.plan enable row level security;
drop policy if exists "signed-in read" on public.plan;
create policy "signed-in read" on public.plan for select to authenticated using (true);
drop policy if exists "signed-in update" on public.plan;
create policy "signed-in update" on public.plan for update to authenticated using (true) with check (id = 1);
revoke all on public.plan from anon;
grant select, update on public.plan to authenticated;

-- 다른 사람이 고치면 바로 반영되도록
alter publication supabase_realtime add table public.plan;
