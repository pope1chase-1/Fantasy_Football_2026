create table if not exists public.draft_state (
  player_id text primary key,
  taken boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.draft_state enable row level security;

create policy "Anyone can read draft_state"
  on public.draft_state
  for select
  using (true);

create policy "Anyone can insert draft_state"
  on public.draft_state
  for insert
  with check (true);

create policy "Anyone can update draft_state"
  on public.draft_state
  for update
  using (true)
  with check (true);

create policy "Anyone can delete draft_state"
  on public.draft_state
  for delete
  using (true);

create publication draft_state_realtime for table public.draft_state;
