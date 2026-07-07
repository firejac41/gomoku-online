-- 오목 증강전 온라인 대전용 테이블
-- 방 하나 = 행 하나. 게임 상태 전체를 JSON으로 통째로 저장/업데이트하는 단순한 구조.

create table if not exists game_rooms (
  id uuid primary key default gen_random_uuid(),
  state jsonb not null,
  black_claimed boolean not null default false,
  white_claimed boolean not null default false,
  created_at timestamptz not null default now()
);

-- RLS 켜고, 로그인 없이도(익명 anon key로) 누구나 읽고/쓸 수 있게 허용
-- (친구끼리 링크 공유해서 노는 캐주얼 게임이라 방 UUID 자체가 사실상 비밀번호 역할)
alter table game_rooms enable row level security;

create policy "누구나 방을 읽을 수 있음" on game_rooms
  for select using (true);

create policy "누구나 방을 만들 수 있음" on game_rooms
  for insert with check (true);

create policy "누구나 방 상태를 업데이트할 수 있음" on game_rooms
  for update using (true);

-- 실시간 구독(Realtime)을 켜서, 상대방이 두는 수가 즉시 반영되게 함
alter publication supabase_realtime add table game_rooms;
