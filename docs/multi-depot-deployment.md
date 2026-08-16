# 승무소별 배포 가이드 (코드 1벌 + Supabase/배포 환경 분리)

## 이 문서의 목적

현재 이 웹서비스는 한 승무소(동대문승무소)만 운영하는 것을 전제로 만들어져 있다.
`coworker_list` 등 모든 테이블에 소속(승무소) 격리 로직이 없어서,
서로 다른 승무소 직원을 같은 데이터베이스에 넣으면 신청 내역·정원·추첨·관리자
권한이 전부 섞인다.

코드에 소속 격리 로직을 넣는 대신, 
**코드는 1벌만 유지하고 승무소마다
Supabase 프로젝트와 배포 환경만 따로 두는** 방식으로 여러 승무소를 운영한다.

단일 코드베이스 - 다중 인스턴스(Single Codebase - Multi-Instance)’ 아키텍처

- 코드 클론/복붙을 하지 않는다. git 레포는 1개만 유지한다.
- 버그 수정·기능 추가는 한 번만 하면 모든 승무소 배포에 동일하게 반영된다.
- 데이터는 승무소별 Supabase 프로젝트로 **물리적으로 분리**되어 서로 절대
  보이지 않는다(소속 누출·RLS 보안 고민이 원천 차단됨).

> 핵심 원리: 이 앱은 빌드 시점이 아니라 **런타임 환경변수**
> (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)로 어느
> Supabase에 접속할지 결정한다([lib/supabase.ts](../lib/supabase.ts) 참고).
> 따라서 같은 코드로 환경변수만 바꿔 여러 배포를 만들면 각각 다른
> 승무소 DB에 연결된다.

---

## 아키텍처

```
                        ┌─────────────────────────────┐
                        │   git 레포 1개 (이 코드)      │
                        │   guijanam-dia_supervisor    │
                        └──────────────┬──────────────┘
                                       │ 동일 코드로 배포 환경만 분리
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
        ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
        │ 배포: 동대문    │     │ 배포: 신답     │     │ 배포: (추가)   │
        │ dia-ddm.vercel │     │ dia-sd.vercel  │     │ dia-xx.vercel  │
        └───────┬───────┘     └───────┬───────┘     └───────┬───────┘
                │ env                 │ env                 │ env
                ▼                     ▼                     ▼
        ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
        │ Supabase 프로젝트│     │ Supabase 프로젝트│     │ Supabase 프로젝트│
        │  동대문승무소    │     │  신답승무소     │     │  (추가 승무소)  │
        └───────────────┘     └───────────────┘     └───────────────┘
```

- **코드**: 1벌. 수정/배포 1회 → 모든 승무소 배포에 자동 반영(같은 git, 같은 빌드).
- **데이터**: 승무소 = Supabase 프로젝트 1개. 완전 격리.
- **접속 분기**: 배포 환경별 환경변수만 다름.

---

## ⚠️ 선행 의존성 (가장 중요)

`supabase/migrations.sql` 은 **빈 DB를 처음부터 만드는 스크립트가 아니다.**
이 파일은 이미 존재하는 다음 것들 **위에** 컬럼/테이블을 덧붙인다.
아래 4가지는 이 레포의 SQL이 만들지 않으므로 **새 프로젝트에 직접 구축해야
한다.**

1. **`coworker_list` 테이블** — 직원 마스터.
   `staff_id`, `staff_name`, `staff_position`, `employee_number`,
   `phone_number`, `pattern_id`, `reference_date`, `reference_shift`,
   `office_name`(소속 승무소명) 등을 가진다.
2. **`get_schedule_by_range(p_start_date, p_end_date)` RPC** 와 그 RPC가
   읽는 **원천 정규 근무순서 데이터**, 그리고 **`work_patterns` 테이블**.
   (기존 시스템에서 이미 제공되던 것)
3. **`holidays` 테이블** — 공휴일 목록. `locdate`(YYYY-MM-DD 문자열),
   `is_holiday`('Y'/'N') 컬럼을 쓴다. 앱의 7개 화면이 조회한다
   (사용자/관리자 달력, 분기밸런스, 근무표 뷰어, 직원별 달력, 탈락자
   날짜변경, 신청목록).
   ⚠️ **없으면 에러가 나지 않고 조용히 공휴일이 0건으로 처리된다** —
   달력에 공휴일 색이 안 들어가고, 공휴일 지근 정원 집계와 연휴 근무번호
   치환이 전부 틀리게 동작한다. 가장 발견하기 어려운 실수다.
4. **`maintenance` 테이블** — 근무표 뷰어(`schedule-viewer.tsx`)에서 조회한다.

새 승무소용 Supabase 프로젝트를 만들 때는 **이것들을 먼저 그 프로젝트에
구축한 뒤** `migrations.sql` 을 실행해야 한다. 이 선행 데이터(직원 명단,
근무순서, RPC 정의, 공휴일)를 어디서 가져오는지는 기존 시스템 담당자에게
확인해야 하며, 이 문서 범위 밖이다. 아래 절차의 **2단계**에서 이 부분을
반드시 처리한다.

> 동대문 프로젝트에서 선행 객체들의 정의를 그대로 뜨려면 SQL Editor 에서:
> ```sql
> -- 테이블 목록 확인
> select table_name from information_schema.tables
>  where table_schema = 'public' order by 1;
> -- RPC 정의 추출
> select pg_get_functiondef(oid) from pg_proc
>  where proname = 'get_schedule_by_range';
> ```

---

## 신규 승무소 추가 절차

예시로 "신답승무소"를 추가한다고 가정한다. 다른 승무소도 동일하다.

### 1단계 — 새 Supabase 프로젝트 생성

1. Supabase 대시보드 → **New project**.
2. 이름: 알아보기 쉽게 `dia-sindap` 등 승무소를 식별할 수 있게 짓는다.
3. **Project URL** 과 **anon public key** 를 기록해 둔다
   (Settings → API). 이게 그대로 배포 환경변수가 된다.
4. 동대문 프로젝트와 **완전히 별개**의 프로젝트여야 한다(같은 프로젝트
   안에서 분리하는 게 아니다).

### 2단계 — 선행 의존성 구축 (코어 데이터/RPC)

새 프로젝트에 아직 `coworker_list` 도, `get_schedule_by_range` RPC 도,
근무순서 원천 데이터도, `holidays`/`maintenance` 도 없다. 기존 동대문
시스템에서 이 코어를 어떻게 공급했는지 확인하여 동일하게 새 프로젝트에
구축한다(위 "선행 의존성" 4가지 전부).

- 새 프로젝트의 `coworker_list` 에는 **그 승무소(신답) 직원만** 넣는다.
- 직원 행의 `office_name` 은 "신답승무소"로 일관되게 채운다
  (현재 코드는 office_name 을 화면에 쓰지 않지만, 향후 식별·점검·데이터
  검증에 쓰이므로 정확히 채워 둔다).
- `get_schedule_by_range` RPC 와 그것이 읽는 근무순서 데이터도 신답
  직원 기준으로 구축한다. RPC 가 반환하는 `staff_id` 는 같은 프로젝트의
  `coworker_list.staff_id` 와 동일 체계여야 한다(앱이 staff_id 로
  근무·신청을 연결하므로).

> 검증 1: SQL Editor 에서
> `select count(*), min(office_name), max(office_name) from coworker_list;`
> 실행 → 신답 직원 수가 맞고 office_name 이 전부 "신답승무소" 인지 확인.
>
> 검증 2: 공휴일이 실제로 들어갔는지 확인(빠뜨리기 쉬움).
> ```sql
> select count(*) from public.holidays
>  where is_holiday = 'Y' and locdate >= '2026-01-01';
> ```
> 0 이면 달력 공휴일 표시·공휴일 정원 집계가 조용히 틀린다.

### 3단계 — 이 레포의 마이그레이션 실행

`supabase/migrations.sql` 의 섹션을 **새 프로젝트의 SQL Editor 에서
위에서부터 순서대로** 실행한다. 현재 섹션 구성:

| 섹션 | 내용 | 비고 |
|---|---|---|
| 1 | `coworker_list` 에 `role` 컬럼 추가 | 선행 테이블 필요 |
| 2 | `employee_number` 채우기(예시) | 신답 직원 사번으로 실제 값 입력 |
| 3 | 관리자 지정(예시) | **신답 관리자**를 `role='admin'` 으로 |
| 4 | `special_schedules`(지근/지휴) 테이블 | |
| 5 | RLS 정책 | `using (true)` — 9·10단계 보안 주의 참고 |
| 4'(82행) | `employee_number` int4 → text | |
| 6 | `announcements`(공지) 테이블 | |
| 7 | 개인 PIN 인증(`pin_hash`) | |
| 8 | 추첨(`lottery_status`/`lottery_at`) 컬럼 | |
| 9 | 앱 설정(`app_settings`, 요일별 지근 정원) | 단일 행 id=1 |
| 10 | 신청 마감일(`request_freeze_date`) | 비우면 마감 없음 |
| 11 | 운휴 번호(`weekend_holiday_turns`) | 승무소마다 다름 |
| 12 | 문서 열람 확인 시스템 | |
| 13 | 문서 투표 기능 | |
| 14 | 기기 식별(`device_id`) | |
| 15 | 지근 번호(`jigeun_number_turns`) | **더 이상 읽지 않음** — 섹션 18 로 대체 |
| 16 | 연휴 근무번호 짝 치환(`holiday_turn_rules`) | 표시 전용 |
| 17 | `work_patterns`(교번) 관리자 CRUD | RLS 주의 — 블록 전체를 한 번에 실행 |
| 18 | 주간/야간 지정근무(`jigeun_day_turns`/`jigeun_night_turns`) | 섹션 15 를 대체 |
| 19 | `special_schedules` → `coworker_list` 외래키 | 실행 전 고아 레코드 확인 |
| 20 | 승무소명(`office_name`) | 교번 목록 접두사 필터. 보통 비워둔다 |

주의:
- **EXPLAIN/Analyze 모드를 끄고** 일반 Run 으로 실행한다. 여러 SQL
  문을 한 번에 EXPLAIN 하면 "EXPLAIN only works on a single SQL
  statement" 에러가 난다. 안 되면 문장 단위로 하나씩 실행한다.
- 섹션 2·3 은 동대문용 **예시 값**이 들어 있다. 신답 직원의 실제
  사번/관리자명으로 바꿔 실행해야 한다.
- 섹션 9 까지 끝나면
  `select * from public.app_settings;` 로 `id=1`, 정원 `4/2/4/4`
  한 행이 있는지 확인한다(추첨/정원 기능 동작 전제).
- 섹션 20 의 `office_name` 은 **한 DB 에 여러 승무소 교번이 섞여 있을
  때만** 채운다. 이 배포 방식(승무소 = 프로젝트 1개)에서는 섞일 일이
  없으므로 **기본값인 빈 문자열 그대로 두면 된다.** 섞여 있는지는:
  ```sql
  select split_part(pattern_name, '(', 1) as prefix, count(*)
    from public.work_patterns group by 1 order by 2 desc;
  ```
  접두사가 여러 개 나오면 그 승무소명으로 `office_name` 을 채운다.

### 4단계 — 정원/관리자 초기 설정

1. 섹션 3 에서 신답 관리자 계정을 `role='admin'` 으로 지정했는지 확인.
2. 관리자로 로그인하면 헤더에 **설정** 버튼이 보인다. 신답승무소에 맞는
   평일/토/일/공휴일 지근 정원을 설정한다(동대문과 독립).
3. 설정 맨 위 **승무소** 칸은 교번 관리에서 이 승무소 교번만 보이도록
   거르는 **이름 접두사**다. 승무소별로 DB 가 분리된 이 구조에서는
   **비워두는 것이 정상**이며, 비우면 그 프로젝트의 전체 교번이 보인다.
   한 DB 에 여러 승무소 교번이 섞여 있을 때만 채운다.
   ⚠️ 값을 채웠는데 실제 교번 이름이 그 접두사로 시작하지 않으면
   **교번 관리 화면이 빈 목록이 되고 새 교번 저장도 거부된다.**
4. 같은 **설정** 다이얼로그에서 승무소별 근무번호를 입력한다:
   - **운휴 번호** — 주말/공휴일에 운휴로 집계할 번호.
   - **주간 지정근무** / **야간 지정근무** — 요일과 무관하게 지근으로
     표시할 번호. 각각 달력·엑셀에 `지(주)` / `지(야)` 로 표시된다.
     같은 번호를 양쪽에 넣으면 저장이 거부된다. 두 칸 모두 기본값이
     비어 있고, **입력 전까지는 지근 표시가 나오지 않는다.**
   - **운휴대기** — 연휴 이틀 치환 규칙(표시 전용).
5. 직원들이 최초 로그인 시 개인 PIN 을 등록한다(섹션 7 기능).

### 5단계 — 새 배포 환경 만들기 (Vercel 기준)

코드를 복사하지 않는다. **같은 git 레포·같은 프로젝트**에 배포 환경만
추가한다. 두 가지 방법 중 택1:

**방법 A — Vercel 프로젝트를 승무소마다 분리 (권장, 단순/명확)**

1. Vercel 에서 **새 Project** 를 만들고 **같은 git 레포**
   (`guijanam-dia_supervisor`)를 연결한다.
   - Framework Preset(Next.js)·Root Directory·빌드 명령은 **전부 기본값**
     그대로 둔다. 이 레포는 `vercel.json` 이 없고 표준 Next.js 구조다.
2. 같은 production 브랜치(`main`)를 사용한다 → 코드는 1벌 그대로.
3. 그 Vercel 프로젝트의 **Environment Variables** 에 신답 Supabase 값을
   넣는다:
   ```
   NEXT_PUBLIC_SUPABASE_URL      = https://<신답-project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY = <신답 anon public key>
   ```
   ⚠️ **Production / Preview / Development 세 환경 모두에 체크**해서
   넣는다. Preview 에 빠뜨리면 프리뷰 배포가 다른 승무소 DB 를 보거나
   (값이 비어) 흰 화면이 된다. `NEXT_PUBLIC_` 접두사가 붙은 값은
   **빌드 시점에 번들에 박히므로**, 나중에 값을 바꾸면 **재배포**해야
   반영된다(Vercel → Deployments → Redeploy).
4. 도메인을 승무소가 구분되게 둔다(예: `dia-sindap.vercel.app` 또는
   커스텀 도메인 `sindap.example.com`).
5. 동대문 Vercel 프로젝트는 그대로 동대문 Supabase 값을 유지한다.
   → 이 단계에서 동대문 프로젝트는 **전혀 건드리지 않는다.**

결과: 두 Vercel 프로젝트가 **같은 코드**를 빌드하지만 서로 다른 Supabase
에 연결된다. `main` 에 코드 푸시 → 두 프로젝트 모두 자동 재배포(동일 코드).

**방법 B — 한 Vercel 프로젝트에서 환경별 분기**

Preview/Production 환경별 또는 별도 도메인에 다른 env 를 거는 방식.
멀티 도메인·환경변수 라우팅 설정이 복잡해 운영 실수 위험이 크다.
승무소 수가 적으면 **방법 A 를 쓴다.** (이 문서는 A 기준으로 기술)

### 6단계 — 배포 검증 (승무소별로 각각)

신답 배포 URL 에 접속해 다음을 확인한다:

- [ ] 신답 직원 이름+사번+PIN 으로 로그인된다.
- [ ] 캘린더에 **신답 직원 신청만** 보인다(동대문 직원이 안 보임).
- [ ] 신답 관리자로 로그인 시 통합 관리/캘린더가 신답 데이터만 다룬다.
- [ ] **정원** 설정이 신답 값으로 동작(동대문과 다르게 설정해 교차 확인).
- [ ] 정원 초과 셀 강조·추첨·탈락자 날짜 변경이 정상 동작.
- [ ] **교번 관리** 화면에 신답 교번이 보인다(빈 목록이 아니다).
      비어 있으면 설정의 **승무소** 접두사와 실제 교번 이름이 어긋난 것이다.
- [ ] 교번 **새로 만들기·이름 변경**이 저장된다.
- [ ] **공휴일**이 달력에 색으로 표시되고, 공휴일 지근 정원이 공휴일
      값으로 집계된다(→ `holidays` 테이블이 제대로 들어갔다는 신호).
- [ ] 근무순서(근무표) 화면에 각 직원의 근무번호가 나온다
      (→ `get_schedule_by_range` RPC 와 근무순서 데이터 연결 확인).
- [ ] 동대문 배포 URL 에서는 신답 데이터가 전혀 안 보인다(역방향 확인).

---

## 운영 시 주의사항

### 코드 변경 시
- 변경은 **레포 1곳에서만** 한다. `main` 에 머지/푸시하면 연결된 모든
  Vercel 프로젝트(동대문·신답·…)가 같은 커밋으로 자동 재배포된다.
- DB 스키마를 바꾸는 변경(새 마이그레이션 섹션 추가 등)이면, **모든
  승무소 Supabase 프로젝트에 그 마이그레이션을 각각 실행**해야 한다.
  코드만 배포되고 어떤 프로젝트의 DB 마이그레이션을 빠뜨리면 그 승무소
  배포에서 기능이 깨진다. → 아래 체크리스트 사용.

### 새 마이그레이션 배포 체크리스트
새로운 SQL 섹션을 `migrations.sql` 에 추가했다면:

- [ ] 동대문 Supabase 프로젝트 SQL Editor 에서 실행
- [ ] 신답 Supabase 프로젝트 SQL Editor 에서 실행
- [ ] (추가 승무소 있으면) 각 프로젝트에서 실행
- [ ] 각 배포 URL 에서 기능 동작 확인

### ⚠️ 직책명이 "기관사/차장" 과 다른 승무소를 추가할 때
직책 목록 `["기관사", "차장"]` 이 **8개 파일에 하드코딩**되어 있고, 그중
일부는 DB 조회 필터(`.in("staff_position", …)`)로 쓰인다. 따라서 직책명이
다른 승무소를 붙이면 **에러 없이 결과가 빈 값으로 나온다.**

해당 파일: [lib/types.ts](../lib/types.ts) (`PositionTab`),
[quarter-balance.tsx](../components/quarter-balance.tsx),
[admin-calendar.tsx](../components/admin-calendar.tsx),
[requests-panel.tsx](../components/admin-panels/requests-panel.tsx),
[pin-reset-panel.tsx](../components/admin-panels/pin-reset-panel.tsx),
[reference-edit-panel.tsx](../components/admin-panels/reference-edit-panel.tsx),
[bottom-tabs.tsx](../components/bottom-tabs.tsx),
[schedule-viewer.tsx](../components/schedule-viewer.tsx)

직책명이 모든 승무소에서 동일하면 손댈 필요가 없다. 다른 승무소가
생기면 이 값들을 `app_settings` 로 빼는 작업이 선행되어야 한다
(승무소명 `office_name` 을 뺀 것과 같은 방식).

### 직원의 승무소 이동(전근)
물리 분리 구조라 자동 이관이 안 된다. 동대문→신답 전근 시:
- 동대문 프로젝트에서 해당 직원·관련 신청 데이터를 정리(삭제/보존 정책에
  따름).
- 신답 프로젝트 `coworker_list` 에 해당 직원을 신답 소속으로 추가하고
  근무순서 데이터·RPC 연계를 맞춘다.
- 운영 빈도가 잦다면 별도 이관 절차/스크립트를 문서화할 것.

### 통합(전 승무소 합산) 화면
이 구조에서는 만들 수 없다(데이터가 프로젝트 단위로 물리 분리).
관리자 권한은 "자기 소속만" 정책이므로 현재 요구와는 부합한다. 추후
전체 통합 뷰가 필요해지면 멀티 테넌트(단일 DB + office_name 격리 +
RLS) 로의 구조 전환을 별도 설계해야 한다.

### 보안 참고
- 현재 RLS 정책은 전부 `using (true)` 라 같은 프로젝트 내에서는 누구나
  전체 조회/수정이 가능하다. 이 배포 방식에서는 **승무소가 프로젝트
  단위로 물리 분리**되므로 승무소 간 누출은 발생하지 않는다(이 방식의
  핵심 이점).
- 단, 한 승무소 프로젝트 **내부**에서는 RLS 가 사실상 무방비다(익명키
  기반). 같은 승무소 내 권한 격리가 필요해지면 별도 검토 대상.

---

## 빠른 요약 (TL;DR)

새 승무소 추가 = **코드는 그대로 두고**:

1. 새 Supabase 프로젝트 생성
2. 그 프로젝트에 **선행 4종** 구축 — `coworker_list`(office_name 채움),
   `get_schedule_by_range` RPC + 근무순서 데이터 + `work_patterns`,
   **`holidays`**, `maintenance`
3. `supabase/migrations.sql` 섹션 **1~20 전부** 위에서부터 순서대로 실행
   (섹션 2·3 은 그 승무소 실제 값으로, 섹션 20 의 `office_name` 은 보통
   비워둠)
4. 정원·관리자·승무소별 근무번호 설정
5. 같은 git 레포로 **Vercel 새 프로젝트** 만들고 그 승무소 Supabase
   env 2개만 다르게 지정(3개 환경 전부) + 도메인 분리
6. 배포 URL 에서 격리·기능 검증(특히 교번 목록·공휴일 표시)

코드 수정은 영원히 1곳에서만. 마이그레이션은 승무소 프로젝트마다 각각.

**가장 흔한 실수 3가지**
1. `holidays` 를 안 넣음 → 공휴일 색·정원 집계가 조용히 틀림
2. Vercel env 를 Production 에만 넣음 → 프리뷰 배포가 깨짐
3. 설정의 **승무소** 접두사를 실제 교번 이름과 다르게 채움 →
   교번 관리가 빈 화면 (비워두면 안전)
