-- 운영 DB에는 승인 후 별도 적용한다. 기존 출처는 추정하거나 소급하지 않는다.
-- request_source는 최초 등록 화면 출처이며 권한 검증/감사 증거가 아니다.
begin;
alter table public.special_schedules
  add column if not exists request_source text default null;
alter table public.special_schedules
  drop constraint if exists special_schedules_request_source_check;
alter table public.special_schedules
  add constraint special_schedules_request_source_check
  check (request_source in ('user', 'admin'));

-- upsert 충돌, 날짜/종류 변경, 추첨 처리에서도 최초 출처를 보존한다.
create or replace function public.preserve_special_schedule_request_source()
returns trigger language plpgsql set search_path = public as $$
begin
  new.request_source := old.request_source;
  return new;
end;
$$;
drop trigger if exists preserve_special_schedule_request_source on public.special_schedules;
create trigger preserve_special_schedule_request_source
before update on public.special_schedules
for each row execute function public.preserve_special_schedule_request_source();
comment on column public.special_schedules.request_source is
  '최초 등록 화면 출처: user/admin, NULL은 기존 미상. UI 색상용이며 권한 근거가 아님.';
notify pgrst, 'reload schema';
commit;
