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

-- ============================================================
-- 6) 공지사항(announcements) 테이블 -------------------------
--  - special_schedules 와 동일한 RLS 패턴(anon-permissive) 적용.
--  - created_by 는 coworker_list.staff_id(작성 관리자) 참조.
--  - updated_at 은 클라이언트에서 명시 갱신(무-트리거 스타일).
-- ============================================================
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null,
  created_by  integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists announcements_created_at_idx
  on public.announcements (created_at desc);

alter table public.announcements enable row level security;

drop policy if exists announcements_read   on public.announcements;
drop policy if exists announcements_insert on public.announcements;
drop policy if exists announcements_update on public.announcements;
drop policy if exists announcements_delete on public.announcements;
create policy announcements_read   on public.announcements for select using (true);
create policy announcements_insert on public.announcements for insert with check (true);
create policy announcements_update on public.announcements for update using (true) with check (true);
create policy announcements_delete on public.announcements for delete using (true);

-- ============================================================
-- 7) 개인 PIN 인증 -------------------------------------------
--  - 사번은 동료끼리 공유되는 준-공개 정보라 본인 외 접속이 가능했음.
--    본인만 아는 4~6자리 PIN 을 추가해 타인 접속을 차단.
--  - pin_hash 는 평문 PIN 을 SHA-256(staff_id + PIN) 으로 해시한 값.
--    NULL = 아직 PIN 미등록 → 최초 로그인 시 등록 화면 노출.
--  - 관리자가 pin_hash 를 NULL 로 UPDATE 하면 PIN 초기화(직원 재등록).
-- ============================================================
alter table public.coworker_list
  add column if not exists pin_hash text;

-- ============================================================
-- 8) 추첨(lottery) 결과 컬럼 ---------------------------------
--  - 정원 초과(지근) 시 직책별 무작위 추첨 결과를 영속화.
--  - lottery_status: NULL = 미추첨, 'won' = 당첨, 'lost' = 탈락.
--  - lottery_at: 마지막 추첨 시각 (재추첨 시 갱신).
--  - 탈락자는 자동 삭제하지 않으며, 관리자가 target_date 를
--    변경하면 lottery_status/lottery_at 을 NULL 로 초기화.
-- ============================================================
alter table public.special_schedules
  add column if not exists lottery_status text
    check (lottery_status in ('won', 'lost'));
alter table public.special_schedules
  add column if not exists lottery_at timestamptz;

-- ============================================================
-- 9) 앱 설정(요일별 지근 정원) -------------------------------
--  - 관리자가 요일/공휴일 구분별 지근 정원을 직접 조정.
--  - 단일 행(id=1)만 사용. 직책(기관사/차장) 공통 적용.
--  - 우선순위: 공휴일 > 토 > 일 > 평일.
-- ============================================================
create table if not exists public.app_settings (
  id                   integer primary key default 1,
  jigeun_cap_weekday   integer not null default 4,
  jigeun_cap_saturday  integer not null default 2,
  jigeun_cap_sunday    integer not null default 4,
  jigeun_cap_holiday   integer not null default 4,
  updated_at           timestamptz not null default now(),
  constraint app_settings_single_row check (id = 1)
);

insert into public.app_settings (id) values (1)
  on conflict (id) do nothing;

alter table public.app_settings enable row level security;
drop policy if exists app_settings_read   on public.app_settings;
drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_read   on public.app_settings for select using (true);
create policy app_settings_update on public.app_settings for update using (true) with check (true);

-- ============================================================
-- 10) 신청 마감일 ----------------------------------------------
--  - NULL = 마감 없음(언제든 신청 가능).
--  - 값이 있으면 today > request_freeze_date 인 경우 사용자 신청/삭제 차단.
--  - 관리자(role='admin')는 차단되지 않음 — admin-calendar/admin-dashboard 그대로 동작.
-- ============================================================
alter table public.app_settings
  add column if not exists request_freeze_date date;

-- ============================================================
-- 11) 운휴 번호(주말/공휴일 비번 turn) -------------------------
--  - 승무소마다 운휴로 간주되는 근무번호가 다르므로 관리자가 직접 지정.
--  - 쉼표로 구분된 텍스트(예: '31,32,33,34,35,36,37').
--  - 빈 문자열/NULL 이면 운휴 집계 없음.
-- ============================================================
alter table public.app_settings
  add column if not exists weekend_holiday_turns text not null default '31,32,33,34,35,36,37';

-- ============================================================
-- 12) 문서 열람 확인 시스템 -----------------------------------
--  - 관리자가 공문/지침 문서를 업로드 → 직원이 열람 후 본인 확인(서명).
--  - 관리자는 확인자/미확인자 명단을 조회만 가능(확인 기록 생성·수정 UI 없음).
--  - document_reads insert 는 클라이언트(document-board.tsx)에서 로그인한
--    직원 본인의 staff_id 로만 수행. update 정책 미생성 → 확인 기록은 불변.
--  - 파일은 Supabase Storage 'documents' 버킷에 저장(대시보드에서 수동 생성,
--    Public bucket = true). file_url 은 공개 URL, file_name 은 표시용 원본명.
--  - file_url NULL 허용: 파일 없이 제목+설명만으로도 문서 게시 가능.
--
--  [보안 한계 — 의도된 결정] -----------------------------------
--  이 앱은 Supabase Auth 미사용(이름+사번+PIN 으로 coworker_list 직접 조회,
--  세션은 localStorage). 모든 DB 접근이 anon 키 단일이라 auth.uid()/auth.jwt()
--  기반 RLS 를 쓸 수 없다(항상 NULL → 적용 시 앱 전체 정지).
--  따라서 아래 정책은 special_schedules/announcements 와 동일하게
--  using(true)/with check(true) 의 anon-permissive 방식이다.
--  ⚠ 결과적으로 anon 키를 직접 사용하면 임의 staff_id 로 대리 서명하거나
--    documents 를 임의 수정·삭제하는 것이 이론상 가능하다. 클라이언트 UI 는
--    이를 막지만 DB 레벨 강제는 아니다. 내부망·소규모 운영 전제로 수용한다.
--  진짜로 잠그려면: ① 서버 사이드 Route Handler + service_role 키로 staff_id
--    를 서버가 결정, 또는 ② Supabase Auth 전면 도입. 둘 다 별도 작업.
-- ============================================================
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  file_url     text,
  file_name    text,
  is_required  boolean not null default false,
  expires_at   timestamptz,
  created_by   integer not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists documents_created_at_idx
  on public.documents (created_at desc);

alter table public.documents enable row level security;
drop policy if exists documents_read   on public.documents;
drop policy if exists documents_insert on public.documents;
drop policy if exists documents_update on public.documents;
drop policy if exists documents_delete on public.documents;
create policy documents_read   on public.documents for select using (true);
create policy documents_insert on public.documents for insert with check (true);
create policy documents_update on public.documents for update using (true) with check (true);
create policy documents_delete on public.documents for delete using (true);

-- 직원 열람 확인 기록 -----------------------------------------
--  - (document_id, staff_id) 유니크 → 동일 직원 중복 확인 불가.
--  - 문서 삭제 시 확인 기록도 cascade 삭제.
--  - update 정책 없음: 한 번 확인하면 수정 불가(서명의 무결성).
create table if not exists public.document_reads (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  staff_id     integer not null,
  confirmed_at timestamptz not null default now(),
  constraint document_reads_unique unique (document_id, staff_id)
);

create index if not exists document_reads_document_idx
  on public.document_reads (document_id);
create index if not exists document_reads_staff_idx
  on public.document_reads (staff_id);

alter table public.document_reads enable row level security;
drop policy if exists document_reads_read   on public.document_reads;
drop policy if exists document_reads_insert on public.document_reads;
drop policy if exists document_reads_delete on public.document_reads;
create policy document_reads_read   on public.document_reads for select using (true);
create policy document_reads_insert on public.document_reads for insert with check (true);
create policy document_reads_delete on public.document_reads for delete using (true);
-- update 정책 미생성: 확인 기록은 불변(immutable).

-- ------------------------------------------------------------
-- 12-1) Storage 'documents' 버킷 RLS 정책 --------------------
--  - 버킷을 Public 으로 만들어도 그것은 '읽기(다운로드)' 공개일 뿐,
--    업로드(INSERT)/수정/삭제는 storage.objects RLS 로 별도 통제된다.
--  - 기본 상태에서는 anon 의 업로드 정책이 없어
--    "new row violates row-level security policy" 오류가 난다.
--  - 이 앱은 anon 키 단일이므로 anon 에 업로드/삭제를 허용한다
--    (테이블 정책들과 동일한 anon-permissive 수준).
--  - bucket_id = 'documents' 로 범위를 한정해 다른 버킷에는 영향 없음.
--  ※ 사전 조건: Storage 대시보드에서 'documents' 버킷을 먼저 생성할 것.
-- ------------------------------------------------------------
drop policy if exists documents_bucket_read   on storage.objects;
drop policy if exists documents_bucket_insert on storage.objects;
drop policy if exists documents_bucket_update on storage.objects;
drop policy if exists documents_bucket_delete on storage.objects;

create policy documents_bucket_read on storage.objects
  for select using (bucket_id = 'documents');
create policy documents_bucket_insert on storage.objects
  for insert with check (bucket_id = 'documents');
create policy documents_bucket_update on storage.objects
  for update using (bucket_id = 'documents')
  with check (bucket_id = 'documents');
create policy documents_bucket_delete on storage.objects
  for delete using (bucket_id = 'documents');

-- ============================================================
-- 13) 문서 투표 기능 -----------------------------------------
--  - 문서에 선택지를 붙이면 '투표 문서', 안 붙이면 일반 확인 문서(선택적).
--  - 단일 선택(직원당 1표), 마감일 전까지 변경 가능.
--  - document_options: 문서별 투표 선택지. sort_order 로 표시 순서 고정.
--  - document_votes: 직원의 투표. (document_id, staff_id) 유니크 → 1인 1표,
--    재투표는 update 로 option_id 갱신(변경 가능 요구사항).
--  - 보안 수준은 섹션 12 와 동일(anon-permissive). 한계도 동일하게 적용.
-- ============================================================
create table if not exists public.document_options (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  label        text not null,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists document_options_document_idx
  on public.document_options (document_id);

alter table public.document_options enable row level security;
drop policy if exists document_options_read   on public.document_options;
drop policy if exists document_options_insert on public.document_options;
drop policy if exists document_options_update on public.document_options;
drop policy if exists document_options_delete on public.document_options;
create policy document_options_read   on public.document_options for select using (true);
create policy document_options_insert on public.document_options for insert with check (true);
create policy document_options_update on public.document_options for update using (true) with check (true);
create policy document_options_delete on public.document_options for delete using (true);

-- 직원 투표 기록 ----------------------------------------------
--  - (document_id, staff_id) 유니크 → 1인 1표.
--  - option_id 변경 가능 → update 정책 허용(섹션 12 의 document_reads 와 다른 점).
--  - 문서/선택지 삭제 시 cascade.
create table if not exists public.document_votes (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  option_id    uuid not null references public.document_options(id) on delete cascade,
  staff_id     integer not null,
  voted_at     timestamptz not null default now(),
  constraint document_votes_unique unique (document_id, staff_id)
);

create index if not exists document_votes_document_idx
  on public.document_votes (document_id);
create index if not exists document_votes_option_idx
  on public.document_votes (option_id);

alter table public.document_votes enable row level security;
drop policy if exists document_votes_read   on public.document_votes;
drop policy if exists document_votes_insert on public.document_votes;
drop policy if exists document_votes_update on public.document_votes;
drop policy if exists document_votes_delete on public.document_votes;
create policy document_votes_read   on public.document_votes for select using (true);
create policy document_votes_insert on public.document_votes for insert with check (true);
create policy document_votes_update on public.document_votes for update using (true) with check (true);
create policy document_votes_delete on public.document_votes for delete using (true);

-- ============================================================
-- 14) 기기 식별(device_id) -----------------------------------
--  - 본인 기기 식별을 위한 컬럼. NULL 허용, 값이 있을 때만 unique.
--  - check_device_vip(p_device_id) RPC: 해당 device_id 가 coworker_list 에
--    등록되어 있으면 true(=VIP/등록 기기) 반환. anon/authenticated 실행 가능.
--  - 사용자는 '나의정보 수정' 모달(reference-editor.tsx) 에서 직접 편집.
-- ============================================================
ALTER TABLE coworker_list ADD COLUMN IF NOT EXISTS device_id TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS coworker_list_device_id_unique
ON coworker_list (device_id) WHERE device_id IS NOT NULL;

CREATE OR REPLACE FUNCTION check_device_vip(p_device_id TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM coworker_list WHERE device_id = p_device_id);
$$;

-- ============================================================
-- 15) 지근 번호(요일과 무관하게 지근으로 표시할 turn) -----------
--  - 정규 근무표의 근무번호(turn) 중 지근으로 지정된 번호는
--    요일/공휴일과 무관하게 달력에서 지근 색상으로 표시.
--  - 쉼표로 구분된 텍스트(예: '41,42,43'). 빈 문자열/NULL 이면 표시 없음.
-- ============================================================
alter table public.app_settings
  add column if not exists jigeun_number_turns text not null default '';
GRANT EXECUTE ON FUNCTION check_device_vip(TEXT) TO anon, authenticated;

-- ============================================================
-- 16) 연휴 근무번호 짝 치환 (표시 전용) ------------------------
--  - 근무순서상 연속된 이틀(N일, N+1일)이 모두 토/일/공휴일일 때에만
--    그 이틀의 근무번호를 다른 코드로 '표시'만 바꾼다.
--    예) 58,58~ → 휴73,휴74
--  - 둘 중 하루만 휴일이면 치환하지 않는다(짝 규칙).
--  - 표시 전용: 휴무/운휴/총휴/분기밸런스 집계는 항상 원래 turn 을 사용.
--  - 형식: '원래A,원래B:표시A,표시B' 를 ';' 로 구분해 나열.
--    예) '58,58~:휴73,휴74;62,62~:휴75,휴76'
--  - 빈 문자열이면 치환 없음(기본값) — 설정 전에는 기존 동작과 동일.
--  - 형식이 깨진 항목은 클라이언트에서 조용히 무시된다.
-- ============================================================
alter table public.app_settings
  add column if not exists holiday_turn_rules text not null default '';

-- ============================================================
-- 17) work_patterns (교번) 관리자 CRUD 허용 --------------------
--  - work_patterns 는 이 레포의 SQL 이 만든 테이블이 아니다(기존 시스템 제공).
--    구조: id uuid PK, pattern_name text, shift_types text[], created_at.
--    coworker_list.pattern_id 가 work_patterns.id 를 참조한다.
--  - shift_types 는 '순서가 의미를 갖는' 배열이다.
--    get_schedule_by_range RPC 는 직원의 (reference_date, reference_shift)
--    로 배열 인덱스를 찾아 하루에 한 칸씩 전진·순환시킨다.
--      → 원소 삽입/삭제/이동은 그 교번을 쓰는 전 직원의 근무표를 밀어버린다.
--      → 원소 이름만 바꾸면 순환 중 그 한 칸만 바뀐다.
--      → 어떤 직원의 reference_shift 가 배열에서 사라지면 그 직원 근무표는
--        계산 불가가 된다(앵커 소실). 관리자 UI 에서 경고한다.
--  - 지금까지 이 테이블은 RPC 내부에서만 읽혔고 클라이언트가 직접
--    조회·수정한 적이 없다. 관리자 UI(교번관리) 추가로 anon 에
--    select/insert/update/delete 가 필요해졌다.
--  - 보안 수준은 섹션 12 와 동일한 anon-permissive. 한계도 동일하다
--    (Supabase Auth 미사용 → auth.uid() 기반 RLS 불가). 권한은
--    클라이언트의 employee.role === 'admin' 으로만 통제된다.
--  - 주의: RLS 가 현재 꺼져 있다면 enable 과 create policy 사이에 읽기가
--    끊기는 순간이 생긴다. SQL Editor 에서 이 블록 전체를 한 번에 실행할 것.
--    사전 확인: select relrowsecurity from pg_class where relname='work_patterns';
-- ============================================================
alter table public.work_patterns enable row level security;
drop policy if exists work_patterns_read   on public.work_patterns;
drop policy if exists work_patterns_insert on public.work_patterns;
drop policy if exists work_patterns_update on public.work_patterns;
drop policy if exists work_patterns_delete on public.work_patterns;
create policy work_patterns_read   on public.work_patterns for select using (true);
create policy work_patterns_insert on public.work_patterns for insert with check (true);
create policy work_patterns_update on public.work_patterns for update using (true) with check (true);
create policy work_patterns_delete on public.work_patterns for delete using (true);

-- 교번별 사용 직원 수 / 앵커 목록 조회용
create index if not exists coworker_list_pattern_idx
  on public.coworker_list (pattern_id);

-- ============================================================
-- 18) 지근 번호를 주간/야간 지정근무로 분리 ---------------------
--  - 섹션 15) 의 단일 목록(jigeun_number_turns)을 두 목록으로 나눈다.
--    주간 목록의 근무는 달력·엑셀에 '지(주)', 야간 목록은 '지(야)' 배지로 표시.
--    배경색은 주/야 모두 기존과 동일한 하늘색이며 구분은 배지 텍스트로만 한다.
--  - 형식은 섹션 11/15 와 같은 쉼표 구분 텍스트(예: '41,42,43').
--  - 같은 번호를 주간·야간에 동시에 넣으면 판정이 모호해지므로
--    클라이언트(설정 저장 시)에서 차단한다. DB 제약은 걸지 않는다.
--  - 기존 jigeun_number_turns 값은 이관하지 않는다. 두 컬럼 모두 빈 값으로
--    시작하며 관리자가 설정 화면에서 주간/야간을 새로 입력해야 한다.
--    → 재입력 전까지는 지근 표시가 나오지 않는다(의도된 동작).
--  - jigeun_number_turns 컬럼은 롤백 여지를 위해 남겨두되 더 이상 읽지 않는다.
-- ============================================================
alter table public.app_settings
  add column if not exists jigeun_day_turns   text not null default '',
  add column if not exists jigeun_night_turns text not null default '';
