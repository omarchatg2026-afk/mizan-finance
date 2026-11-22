-- Mizan Finance V5 — Supabase schema (new installation or V3/V4 upgrade).
-- Existing V3 projects can rerun this SQL after backup; V1/V2 data uses JSON export/import.
-- Run once in Supabase SQL Editor, before filling config.js.
-- All currency figures EGP, stored as numeric(16,2).

create table if not exists public.mizan_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  ui_prefs jsonb not null default '{}'::jsonb
);
-- Safe addition for V3 installations (CREATE TABLE IF NOT EXISTS does not add columns).
alter table public.mizan_state add column if not exists ui_prefs jsonb not null default '{}'::jsonb;
create table if not exists public.mizan_accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, ord integer not null default 0,
  name text not null, kind text not null, opening numeric(16,2) not null default 0,
  primary key(user_id,id)
);
create table if not exists public.mizan_categories (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, ord integer not null default 0,
  name text not null, color text not null,
  primary key(user_id,id)
);
create table if not exists public.mizan_goals (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, name text not null, target numeric(16,2) not null,
  starting numeric(16,2) not null default 0, account_id text not null,
  primary key(user_id,id)
);
create table if not exists public.mizan_transactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  type text not null check (type in ('income','expense','transfer','loan_out','loan_in','loan_repaid','loan_paid')),
  date date not null, amount numeric(16,2) not null check (amount > 0),
  account_id text not null, to_account_id text not null default '',
  category_id text not null default '', goal_id text not null default '',
  description text not null default '', debt_id text not null default '',
  recurring_id text not null default '', occurrence_date date,
  created_at timestamptz not null default now(),
  primary key(user_id,id)
);
create table if not exists public.mizan_transaction_splits (
  user_id uuid not null, transaction_id text not null,
  ord integer not null, category_id text not null,
  amount numeric(16,2) not null check(amount > 0),
  primary key(user_id,transaction_id,ord),
  foreign key(user_id,transaction_id) references public.mizan_transactions(user_id,id) on delete cascade
);
create table if not exists public.mizan_budgets (
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null, category_id text not null,
  amount numeric(16,2) not null check (amount >= 0),
  primary key(user_id,month_key,category_id)
);
create table if not exists public.mizan_allocations (
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null, category_id text not null,
  amount numeric(16,2) not null check (amount >= 0),
  primary key(user_id,month_key,category_id)
);
create table if not exists public.mizan_recurring (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, name text not null,
  type text not null check(type in ('income','expense')),
  frequency text not null check(frequency in ('weekly','monthly')),
  amount numeric(16,2) not null check(amount > 0),
  next_due date not null, anchor_day integer not null check(anchor_day between 1 and 31),
  account_id text not null, category_id text not null default '', active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(user_id,id)
);
create table if not exists public.mizan_debts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, name text not null,
  direction text not null check(direction in ('lent','borrowed')),
  principal numeric(16,2) not null check(principal > 0),
  account_id text not null, date date not null,
  due_date date, notes text not null default '', tx_id text not null,
  created_at timestamptz not null default now(),
  primary key(user_id,id)
);
create table if not exists public.mizan_debt_payments (
  user_id uuid not null, debt_id text not null, id text not null,
  amount numeric(16,2) not null check(amount > 0),
  account_id text not null, date date not null, tx_id text not null,
  primary key(user_id,debt_id,id),
  foreign key(user_id,debt_id) references public.mizan_debts(user_id,id) on delete cascade
);
create table if not exists public.mizan_projects (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, name text not null, status text not null default 'active',
  notes text not null default '', primary key(user_id,id)
);

-- RLS: even direct Data API requests cannot view another user's records.
do $$
declare t text;
begin
  foreach t in array array['mizan_state','mizan_accounts','mizan_categories','mizan_goals','mizan_transactions','mizan_transaction_splits','mizan_budgets','mizan_allocations','mizan_recurring','mizan_debts','mizan_debt_payments','mizan_projects'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon',t);
    execute format('grant select, insert, update, delete on public.%I to authenticated',t);
    execute format('drop policy if exists mizan_owner on public.%I',t);
    execute format('create policy mizan_owner on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',t);
  end loop;
end $$;

-- Security INVOKER: caller's RLS permissions apply; no elevated execution.
-- No user_id argument: ownership ALWAYS comes from auth.uid().
create or replace function public.mizan_pull()
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare u uuid := auth.uid(); r bigint; payload jsonb;
begin
  if u is null then raise exception 'Login required' using errcode='42501'; end if;
  select revision into r from public.mizan_state where user_id=u;
  if r is null then return jsonb_build_object('revision',0,'data',null); end if;
  select jsonb_build_object(
    'version',1,'schemaVersion',3,
    'uiPrefs', coalesce((select s.ui_prefs from public.mizan_state s where s.user_id=u),'{}'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'opening',a.opening) order by a.ord) from public.mizan_accounts a where a.user_id=u),'[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'color',c.color) order by c.ord) from public.mizan_categories c where c.user_id=u),'[]'::jsonb),
    'goals', coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'target',g.target,'starting',g.starting,'accountId',g.account_id)) from public.mizan_goals g where g.user_id=u),'[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'type',t.type,'date',to_char(t.date,'YYYY-MM-DD'),'amount',t.amount,'accountId',t.account_id,'toAccountId',t.to_account_id,'categoryId',t.category_id,'goalId',t.goal_id,'description',t.description,'createdAt',to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'debtId',t.debt_id,'recurringId',t.recurring_id,'occurrenceDate',coalesce(to_char(t.occurrence_date,'YYYY-MM-DD'),''),'splits',coalesce((select jsonb_agg(jsonb_build_object('categoryId',s.category_id,'amount',s.amount) order by s.ord) from public.mizan_transaction_splits s where s.user_id=u and s.transaction_id=t.id),'[]'::jsonb))) from public.mizan_transactions t where t.user_id=u),'[]'::jsonb),
    'budgets', coalesce((select jsonb_object_agg(b.month_key,b.parts) from (select month_key,jsonb_object_agg(category_id,amount) parts from public.mizan_budgets where user_id=u group by month_key) b),'{}'::jsonb),
    'allocations', coalesce((select jsonb_object_agg(b.month_key,b.parts) from (select month_key,jsonb_object_agg(category_id,amount) parts from public.mizan_allocations where user_id=u group by month_key) b),'{}'::jsonb),
    'recurring', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'type',r.type,'frequency',r.frequency,'amount',r.amount,'nextDue',to_char(r.next_due,'YYYY-MM-DD'),'anchorDay',r.anchor_day,'accountId',r.account_id,'categoryId',r.category_id,'active',r.active,'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))) from public.mizan_recurring r where r.user_id=u),'[]'::jsonb),
    'debts', coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'direction',d.direction,'principal',d.principal,'accountId',d.account_id,'date',to_char(d.date,'YYYY-MM-DD'),'dueDate',coalesce(to_char(d.due_date,'YYYY-MM-DD'),''),'notes',d.notes,'txId',d.tx_id,'createdAt',to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'amount',p.amount,'accountId',p.account_id,'date',to_char(p.date,'YYYY-MM-DD'),'txId',p.tx_id)) from public.mizan_debt_payments p where p.user_id=u and p.debt_id=d.id),'[]'::jsonb))) from public.mizan_debts d where d.user_id=u),'[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'status',p.status,'notes',p.notes)) from public.mizan_projects p where p.user_id=u),'[]'::jsonb)
  ) into payload;
  return jsonb_build_object('revision',r,'data',payload);
end $$;

create or replace function public.mizan_push(snapshot jsonb, expected_revision bigint)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare u uuid := auth.uid(); rev bigint; new_rev bigint;
begin
  if u is null then raise exception 'Login required' using errcode='42501'; end if;
  if jsonb_typeof(snapshot)<>'object' or (snapshot->>'version')<>'1'
    or jsonb_typeof(snapshot->'accounts')<>'array'
    or jsonb_typeof(snapshot->'categories')<>'array'
    or jsonb_typeof(snapshot->'transactions')<>'array'
    or octet_length(snapshot::text)>5000000
  then raise exception 'Invalid Mizan snapshot' using errcode='22023'; end if;

  -- PostgreSQL row lock serializes updates on this account. All writes are atomic.
  insert into public.mizan_state(user_id,revision) values(u,0) on conflict (user_id) do nothing;
  select revision into rev from public.mizan_state where user_id=u for update;
  if rev<>expected_revision then return jsonb_build_object('status','conflict'); end if;

  delete from public.mizan_transaction_splits where user_id=u;
  delete from public.mizan_debt_payments where user_id=u;
  delete from public.mizan_transactions where user_id=u;
  delete from public.mizan_debts where user_id=u;
  delete from public.mizan_recurring where user_id=u;
  delete from public.mizan_budgets where user_id=u;
  delete from public.mizan_allocations where user_id=u;
  delete from public.mizan_projects where user_id=u;
  delete from public.mizan_goals where user_id=u;
  delete from public.mizan_categories where user_id=u;
  delete from public.mizan_accounts where user_id=u;

  insert into public.mizan_accounts(user_id,id,ord,name,kind,opening)
  select u,x.item->>'id',x.ord::integer,x.item->>'name',x.item->>'kind',(x.item->>'opening')::numeric
  from jsonb_array_elements(snapshot->'accounts') with ordinality x(item,ord);

  insert into public.mizan_categories(user_id,id,ord,name,color)
  select u,x.item->>'id',x.ord::integer,x.item->>'name',x.item->>'color'
  from jsonb_array_elements(snapshot->'categories') with ordinality x(item,ord);

  insert into public.mizan_goals(user_id,id,name,target,starting,account_id)
  select u,x->>'id',x->>'name',(x->>'target')::numeric,(x->>'starting')::numeric,x->>'accountId'
  from jsonb_array_elements(coalesce(snapshot->'goals','[]'::jsonb)) x;

  insert into public.mizan_transactions(user_id,id,type,date,amount,account_id,to_account_id,category_id,goal_id,description,debt_id,recurring_id,occurrence_date,created_at)
  select u,x->>'id',x->>'type',(x->>'date')::date,(x->>'amount')::numeric,x->>'accountId',coalesce(x->>'toAccountId',''),coalesce(x->>'categoryId',''),coalesce(x->>'goalId',''),coalesce(x->>'description',''),coalesce(x->>'debtId',''),coalesce(x->>'recurringId',''),nullif(x->>'occurrenceDate','')::date,coalesce(nullif(x->>'createdAt','')::timestamptz,now())
  from jsonb_array_elements(snapshot->'transactions') x;

  insert into public.mizan_transaction_splits(user_id,transaction_id,ord,category_id,amount)
  select u,t.item->>'id',s.ord::integer,s.item->>'categoryId',(s.item->>'amount')::numeric
  from jsonb_array_elements(snapshot->'transactions') t(item)
  cross join lateral jsonb_array_elements(coalesce(t.item->'splits','[]'::jsonb)) with ordinality s(item,ord);

  insert into public.mizan_budgets(user_id,month_key,category_id,amount)
  select u,month.key,item.key,item.value::numeric
  from jsonb_each(coalesce(snapshot->'budgets','{}'::jsonb)) month
  cross join lateral jsonb_each_text(month.value) item;

  insert into public.mizan_allocations(user_id,month_key,category_id,amount)
  select u,month.key,item.key,item.value::numeric
  from jsonb_each(coalesce(snapshot->'allocations','{}'::jsonb)) month
  cross join lateral jsonb_each_text(month.value) item;

  insert into public.mizan_recurring(user_id,id,name,type,frequency,amount,next_due,anchor_day,account_id,category_id,active,created_at)
  select u,x->>'id',x->>'name',x->>'type',x->>'frequency',(x->>'amount')::numeric,(x->>'nextDue')::date,coalesce((x->>'anchorDay')::integer,extract(day from (x->>'nextDue')::date)::integer),x->>'accountId',coalesce(x->>'categoryId',''),coalesce((x->>'active')::boolean,true),coalesce(nullif(x->>'createdAt','')::timestamptz,now())
  from jsonb_array_elements(coalesce(snapshot->'recurring','[]'::jsonb)) x;

  insert into public.mizan_debts(user_id,id,name,direction,principal,account_id,date,due_date,notes,tx_id,created_at)
  select u,x->>'id',x->>'name',x->>'direction',(x->>'principal')::numeric,x->>'accountId',(x->>'date')::date,nullif(x->>'dueDate','')::date,coalesce(x->>'notes',''),x->>'txId',coalesce(nullif(x->>'createdAt','')::timestamptz,now())
  from jsonb_array_elements(coalesce(snapshot->'debts','[]'::jsonb)) x;

  insert into public.mizan_debt_payments(user_id,debt_id,id,amount,account_id,date,tx_id)
  select u,d.item->>'id',p.item->>'id',(p.item->>'amount')::numeric,p.item->>'accountId',(p.item->>'date')::date,p.item->>'txId'
  from jsonb_array_elements(coalesce(snapshot->'debts','[]'::jsonb)) d(item)
  cross join lateral jsonb_array_elements(coalesce(d.item->'payments','[]'::jsonb)) p(item);

  insert into public.mizan_projects(user_id,id,name,status,notes)
  select u,x->>'id',x->>'name',coalesce(x->>'status','active'),coalesce(x->>'notes','')
  from jsonb_array_elements(coalesce(snapshot->'projects','[]'::jsonb)) x;

  new_rev := rev+1;
  update public.mizan_state set revision=new_rev,updated_at=now(),
    ui_prefs=case when jsonb_typeof(snapshot->'uiPrefs')='object' then snapshot->'uiPrefs' else '{}'::jsonb end
    where user_id=u;
  return jsonb_build_object('status','ok','revision',new_rev);
end $$;

revoke all on function public.mizan_pull() from public, anon;
revoke all on function public.mizan_push(jsonb,bigint) from public, anon;
grant execute on function public.mizan_pull() to authenticated;
grant execute on function public.mizan_push(jsonb,bigint) to authenticated;

-- Optional: check table policies under Database > Tables after running.
-- Never put Postgres password, service_role, or sb_secret_ key in config.js.
