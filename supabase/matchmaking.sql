-- 빠른 대전(자동 매칭) 대기열
-- 방을 직접 안 만들고 "빠른 대전" 버튼을 누르면 여기 한 행이 생기고,
-- try_match() 함수가 원자적으로 대기 중인 다른 행과 짝지어줌

create table if not exists matchmaking_queue (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  matched boolean not null default false,
  room_id uuid references game_rooms(id)
);

alter table matchmaking_queue enable row level security;

create policy "누구나 대기열을 읽을 수 있음" on matchmaking_queue
  for select using (true);

create policy "누구나 대기열에 등록할 수 있음" on matchmaking_queue
  for insert with check (true);

create policy "누구나 대기열을 업데이트할 수 있음" on matchmaking_queue
  for update using (true);

create policy "누구나 대기열에서 나갈 수 있음(취소)" on matchmaking_queue
  for delete using (true);

alter publication supabase_realtime add table matchmaking_queue;

grant select, insert, update, delete on public.matchmaking_queue to anon, authenticated;

-- 대기 중인 다른 행(my_id 자신 제외) 하나를 원자적으로 찾아서 서로 matched=true로 표시.
-- 방 생성은 클라이언트가 하고(기존 "방 만들기" 로직 재사용), 이 함수는 "누구랑 짝지어졌는지"만 안전하게 결정함.
-- for update / for update skip locked로 동시에 여러 명이 매칭을 시도해도 한 쌍만 맺어지게 함.
create or replace function try_match(my_id uuid)
returns uuid
language plpgsql
as $$
declare
  my_row matchmaking_queue;
  opponent_id uuid;
begin
  select * into my_row from matchmaking_queue where id = my_id for update;
  if my_row is null or my_row.matched then
    return null;
  end if;

  select id into opponent_id
  from matchmaking_queue
  where matched = false and id <> my_id
  order by created_at asc
  limit 1
  for update skip locked;

  if opponent_id is null then
    return null;
  end if;

  update matchmaking_queue set matched = true where id = opponent_id;
  update matchmaking_queue set matched = true where id = my_id;

  return opponent_id;
end;
$$;

grant execute on function try_match(uuid) to anon, authenticated;
