-- RLS 정책은 "행 단위" 접근을 통제하고, 이 GRANT는 "테이블 자체"에 대한 기본 권한을 준다.
-- 이게 없으면 RLS 정책이 있어도 permission denied가 남.
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.game_rooms to anon, authenticated;
