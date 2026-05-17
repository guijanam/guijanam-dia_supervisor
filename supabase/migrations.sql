-- ============================================================
-- 근무 순서 관리 시스템 고도화 - DB 마이그레이션
-- Supabase SQL Editor 에서 순서대로 실행하세요.
-- 기존 정규 근무순서 데이터(RPC get_schedule_by_range)에는 영향 없음.
--
-- 설계 결정:
--  - 별도 employees 테이블을 만들지 않고 기존 coworker_list(직원 261명,
--    staff_id/staff_name/staff_position/employee_number/phone_number/role)를
--    직원 마스터로 재활용.
--  - 로그인 키: staff_name + employee_number.
--  - special_schedules 는 coworker_list.staff_id 로 연결.
--  - RPC 결과의 staff_id 와 coworker_list.staff_id 가 동일 체계이므로
--    RPC 변경 불필요. 본인 근무는 staff_id 로 필터링.
-- ============================================================

-- 1) coworker_list 에 role 컬럼 추가 -------------------------
alter table public.coworker_list
  add column if not exists role text not null default 'user'
  check (role in ('user', 'admin'));

-- 2) employee_number 채우기 (현재 전부 NULL) -----------------
--   실제 사번 데이터를 아래처럼 입력하세요. (예시)
-- update public.coworker_list set employee_number = '10001' where staff_id = 1;
-- update public.coworker_list set employee_number = '10002' where staff_id = 2;
--
--   임시로 테스트하려면 staff_id 를 사번처럼 사용할 수도 있습니다:
-- update public.coworker_list
--   set employee_number = staff_id::text
--   where employee_number is null;

-- 3) 관리자 지정 (예시) --------------------------------------
-- update public.coworker_list set role = 'admin' where staff_name = '홍길동';

-- 빠른 조회를 위한 인덱스
create index if not exists coworker_list_login_idx
  on public.coworker_list (staff_name, employee_number);

-- 4) 지근/지휴 기록 테이블 -----------------------------------
create table if not exists public.special_schedules (
  id           uuid primary key default gen_random_uuid(),
  staff_id     integer not null,
  target_date  date not null,
  record_type  text not null check (record_type in ('지근', '지휴')),
  created_at   timestamptz not null default now(),
  -- 동일 직원이 같은 날짜에 중복 신청 불가
  constraint special_schedules_staff_date_unique unique (staff_id, target_date)
);

create index if not exists special_schedules_target_date_idx
  on public.special_schedules (target_date);
create index if not exists special_schedules_staff_idx
  on public.special_schedules (staff_id);

-- 5) RLS 정책 -------------------------------------------------
-- 커스텀(이름+사번) 로그인이라 Supabase Auth 세션이 없으므로 anon 키로 동작.
-- service_role 미사용 결정에 따라 관리자 수정/삭제도 anon + RLS 로 처리.
alter table public.special_schedules enable row level security;

drop policy if exists special_schedules_read   on public.special_schedules;
drop policy if exists special_schedules_insert on public.special_schedules;
drop policy if exists special_schedules_update on public.special_schedules;
drop policy if exists special_schedules_delete on public.special_schedules;
create policy special_schedules_read   on public.special_schedules for select using (true);
create policy special_schedules_insert on public.special_schedules for insert with check (true);
create policy special_schedules_update on public.special_schedules for update using (true) with check (true);
create policy special_schedules_delete on public.special_schedules for delete using (true);

-- coworker_list 는 로그인 조회를 위해 anon select 가 가능해야 합니다.
-- (이미 RPC/조회가 동작 중이므로 RLS 가 없거나 select 허용 상태로 가정.
--  RLS 가 켜져 있다면 아래 정책을 추가하세요.)
-- alter table public.coworker_list enable row level security;
-- drop policy if exists coworker_list_read on public.coworker_list;
-- create policy coworker_list_read on public.coworker_list for select using (true);

-- ============================================================
-- 참고: get_schedule_by_range RPC 는 staff_id, name, staff_position,
-- pattern_name, date, turn, phone_number 를 반환합니다.
-- staff_id 로 본인 근무를 필터링하므로 RPC 변경은 필요 없습니다.
-- ============================================================

-- ============================================================
-- 4) employee_number(사번) 데이터 형식 변경: int4 -> text -----
--  - 사번은 식별자이므로 앞자리 0 보존·형식 유연성을 위해 text 권장.
--  - staff_id(내부 PK/FK)는 그대로 integer 유지해야 함 (조인/인덱스/RPC).
--  - 현재 employee_number 가 전부 NULL 이면 데이터 손실 없이 변환됩니다.
--  - 일부 값이 있어도 ::text 캐스팅으로 안전하게 문자열 변환됩니다.
-- ============================================================
alter table public.coworker_list
  alter column employee_number type text
  using employee_number::text;
