-- 기존 DB: 이 파일만 Supabase SQL Editor에서 postgres 역할로 실행한다.
-- 새 DB: 먼저 supabase/migrations.sql을 실행한 뒤 이 파일을 실행한다.
-- pg_cron이 매분 확인하며, 관리자 접속이나 외부 API 키가 필요하지 않다.
begin;

alter table public.app_settings
  add column if not exists auto_lottery_admin_staff_id integer
    references public.coworker_list(staff_id) on delete set null;

-- 기존 설정의 작성자는 저장되어 있지 않으므로 기존 관리자 중 한 명을 사용한다.
-- 이후 설정을 저장하면 실제 설정 관리자의 staff_id로 갱신한다.
update public.app_settings
set auto_lottery_admin_staff_id = (
  select staff_id from public.coworker_list where role = 'admin'
  order by staff_id limit 1
)
where auto_lottery_admin_staff_id is null;

create or replace function public.run_due_auto_lottery()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  settings public.app_settings%rowtype;
  today_kst date := (statement_timestamp() at time zone 'Asia/Seoul')::date;
  run_at timestamptz := statement_timestamp();
  range_start date;
  range_end date;
  target record;
  won_ids uuid[];
  lost_ids uuid[];
  won_names text;
  lost_names text;
  result_body text;
  result_document_id uuid;
  target_count integer := 0;
  won_count integer := 0;
  lost_count integer := 0;
begin
  -- 동시 실행과 설정 변경을 이 행 잠금으로 직렬화한다.
  select * into settings from public.app_settings where id = 1 for update;
  if not found then
    return jsonb_build_object('status', 'no-settings');
  end if;
  if not settings.auto_lottery_enabled or settings.request_freeze_date is null
     or today_kst <= settings.request_freeze_date then
    return jsonb_build_object('status', 'not-due');
  end if;
  if settings.auto_lottery_done_for = settings.request_freeze_date then
    return jsonb_build_object('status', 'already-done');
  end if;
  if settings.extra_request_year is null or settings.extra_request_quarter is null
     or settings.extra_request_year not between 1 and 9999
     or settings.extra_request_quarter not between 1 and 4 then
    raise exception '자동 추첨 대상 분기(년·분기)를 지정하세요.';
  end if;
  if not exists (
    select 1 from public.coworker_list
    where staff_id = settings.auto_lottery_admin_staff_id and role = 'admin'
  ) then
    raise exception '자동 추첨의 작성 관리자 설정이 유효하지 않습니다. 관리자로 설정을 다시 저장하세요.';
  end if;
  if least(settings.jigeun_cap_weekday, settings.jigeun_cap_saturday,
           settings.jigeun_cap_sunday, settings.jigeun_cap_holiday) < 0 then
    raise exception '지근 정원은 0 이상이어야 합니다.';
  end if;

  range_start := make_date(settings.extra_request_year,
                          (settings.extra_request_quarter - 1) * 3 + 1, 1);
  range_end := (range_start + interval '3 months' - interval '1 day')::date;
  result_body := format(E'%s ~ %s 지근 신청 추첨 결과입니다.\n(자동 추첨 · %s 한국 시간 실행)\n\n',
                        range_start, range_end,
                        to_char(run_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'));

  -- 추첨 도중 신청·삭제·수동 추첨이 섞여 결과와 문서가 달라지지 않게 한다.
  -- 마감 여부를 통과한 실행에서만 잠그며 함수 종료 시 해제된다.
  lock table public.special_schedules in share row exclusive mode;

  -- 기존 collectBulkTargets와 동일하게 날짜 × 직책별로 정원을 적용한다.
  -- 지휴를 포함해 추첨 이력이 하나라도 있는 조합은 그대로 보존한다.
  for target in
    with groups as (
      select s.target_date, c.staff_position,
             count(*) filter (where s.record_type = '지근'
                              and s.lottery_status is distinct from 'lost') as slots,
             bool_or(s.lottery_status is not null) as already_drawn
      from public.special_schedules s
      join public.coworker_list c on c.staff_id = s.staff_id
      where s.target_date between range_start and range_end
        and c.staff_position in ('기관사', '차장')
      group by s.target_date, c.staff_position
    ), capacities as (
      select g.*,
             case
               when exists (select 1 from public.holidays h
                            where h.locdate = g.target_date and h.is_holiday = 'Y')
                 then settings.jigeun_cap_holiday
               when extract(dow from g.target_date) = 6 then settings.jigeun_cap_saturday
               when extract(dow from g.target_date) = 0 then settings.jigeun_cap_sunday
               else settings.jigeun_cap_weekday
             end as cap
      from groups g
    )
    select * from capacities where not already_drawn and slots > cap
    order by target_date, case staff_position when '기관사' then 0 else 1 end
  loop
    -- 무작위 순서로 정원까지 당첨시킨다(Fisher-Yates와 같은 균등 추첨).
    with ranked as materialized (
      select s.id, c.staff_name,
             row_number() over (order by random(), s.id) as rank
      from public.special_schedules s
      join public.coworker_list c on c.staff_id = s.staff_id
      where s.target_date = target.target_date
        and c.staff_position = target.staff_position and s.record_type = '지근'
    )
    select coalesce(array_agg(id order by rank) filter (where rank <= target.cap), '{}'::uuid[]),
           coalesce(array_agg(id order by rank) filter (where rank > target.cap), '{}'::uuid[]),
           coalesce(string_agg(staff_name, ', ' order by rank) filter (where rank <= target.cap), '-'),
           coalesce(string_agg(staff_name, ', ' order by rank) filter (where rank > target.cap), '-')
    into won_ids, lost_ids, won_names, lost_names from ranked;

    update public.special_schedules
    set lottery_status = case when id = any(won_ids) then 'won' else 'lost' end,
        lottery_at = run_at
    where id = any(won_ids || lost_ids);

    target_count := target_count + 1;
    won_count := won_count + cardinality(won_ids);
    lost_count := lost_count + cardinality(lost_ids);
    result_body := result_body || format(E'■ %s %s (정원 %s)\n  당첨: %s\n  탈락: %s\n\n',
                                        target.target_date, target.staff_position,
                                        target.cap, won_names, lost_names);
  end loop;

  -- 추첨 대상이 없어도 처리 결과를 게시해 정상 완료 여부를 확인할 수 있다.
  if target_count = 0 then
    result_body := result_body || E'추첨할 미추첨 정원 초과 지근 신청이 없습니다.\n이미 추첨된 날짜·직책의 결과는 그대로 유지됩니다.\n';
  end if;
  if settings.extra_request_deadline is not null then
    result_body := result_body || format(E'\n※ 탈락하신 분은 추가 신청 기간(%s까지)에 다른 날짜로 재신청하실 수 있습니다.\n  탈락한 날짜와 정원이 찬 날짜에는 다시 신청할 수 없으니 자리가 남은 날짜를 선택해 주세요.\n',
                                        settings.extra_request_deadline);
  end if;

  insert into public.documents (title, description, file_url, file_name, is_required, created_by)
  values (format('%s년 %s분기 지근 추첨 결과', settings.extra_request_year, settings.extra_request_quarter),
          result_body, null, null, false, settings.auto_lottery_admin_staff_id)
  returning id into result_document_id;

  update public.app_settings
  set auto_lottery_done_for = settings.request_freeze_date, updated_at = run_at
  where id = 1;

  -- 예외를 삼키지 않는다. 문서 INSERT·완료 UPDATE가 실패하면 추첨도 롤백되고
  -- cron.job_run_details에 실패가 남으며 다음 분에 전체 작업을 다시 시도한다.
  return jsonb_build_object('status', 'done', 'target_count', target_count,
                           'won_count', won_count, 'lost_count', lost_count,
                           'document_id', result_document_id);
end;
$$;

alter function public.run_due_auto_lottery() owner to postgres;
revoke all on function public.run_due_auto_lottery() from public, anon, authenticated, service_role;
grant execute on function public.run_due_auto_lottery() to postgres;

-- 아래는 Supabase 전용 예약 작업이다. 동일 이름으로 다시 적용하면 갱신된다.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule('auto-lottery-after-deadline', '* * * * *',
                     'select public.run_due_auto_lottery();');

commit;
