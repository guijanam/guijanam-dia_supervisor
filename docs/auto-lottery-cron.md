# 마감 후 서버 자동 추첨

자동 추첨을 켜고 신청 마감일과 대상 분기를 저장하면, Supabase Cron이 매분
`public.run_due_auto_lottery()`를 실행한다. 관리자 로그인이나 앱 접속은 필요 없다.
외부 요청·Edge Function·Vercel Cron·service_role 키도 사용하지 않는다.

## 실행 시점과 범위

- **한국 시간(Asia/Seoul)** 기준 오늘이 신청 마감일보다 뒤일 때 실행한다.
  예를 들어 마감일이 9월 15일이면 9월 16일 0시 이후 첫 예약 실행에서 처리한다.
  매분 확인하므로 보통 1분 이내에 시작한다. DB 중단·실패 시에는 복구 후 재시도한다.
- `auto_lottery_enabled = true`, 마감일과 대상 연도·분기가 있어야 한다.
- `auto_lottery_done_for`가 현재 마감일과 같으면 아무 것도 변경하지 않는다.
  기존 완료 기록도 그대로 유지하므로 업그레이드로 과거 추첨을 다시 돌리지 않는다.
- 마감일이 속한 분기를 추측하지 않고 `extra_request_year/quarter`를 사용한다.
- 분기 전체의 **날짜 × 직책(기관사/차장)** 단위로 지근 신청을 추첨한다.
  정원 우선순위는 공휴일 → 토요일 → 일요일 → 평일이다.
- 지휴는 정원에 포함하지 않는다. 동일 날짜·직책에서 추첨 이력이 하나라도
  있으면 그 조합 전체를 제외해 기존 당첨자·탈락자를 보존한다.

추첨 결과는 기존 `documents` 게시판에 제목·본문으로 게시한다. 첨부파일은 없다.
당첨자와 탈락자의 실명을 포함하며, 추가 신청일이 있으면 재신청 안내도 넣는다.
추첨 대상이 없더라도 대상이 없다는 결과 문서를 게시하고 완료 처리한다.
대상 분기만 바꾸거나 옵션을 껐다 켜도 같은 마감일의 완료 기록은 초기화하지 않는다.

## 중복 방지와 실패 처리

함수는 `app_settings(id=1)`을 행 잠금으로 직렬화한다. 동시에 두 번 호출되어도
첫 실행의 완료 기록을 확인한 다음 실행은 작업하지 않는다. 실제 추첨 중에는
`special_schedules`의 쓰기를 잠시 잠가 신청·삭제·수동 추첨이 섞이지 않게 한다.

추첨 결과 UPDATE, 결과 문서 INSERT, 완료 기록 UPDATE는 **한 트랜잭션**이다.
어느 단계든 실패하면 모두 롤백한다. 따라서 문서 게시 실패 뒤 추첨 결과만 남아
문서 재게시 대상이 사라지는 이전 구현의 문제가 없다. 실패는 Cron 실행 기록에
남으며 다음 분에 다시 처리한다.

`auto_lottery_admin_staff_id`는 자동 추첨 설정을 저장한 관리자의 사번이다.
문서의 `created_by`에 사용한다. 업그레이드 시 작성자 정보가 없는 기존 설정은
기존 관리자 중 staff_id가 가장 작은 계정으로 채운다. 이후 관리자가 설정을
저장하면 그 관리자로 갱신된다. 해당 계정이 삭제되거나 관리자 권한이 해제되면
설정을 다시 저장하기 전까지 작업을 실패 처리한다.

함수 실행 권한은 postgres에만 부여한다. anon/authenticated는 실행할 수 없고,
대시보드는 저장된 상태만 표시한다.

## 적용

승무소마다 DB 프로젝트가 분리돼 있으므로 **각 Supabase 프로젝트에 한 번씩** 적용한다.

1. 기존 DB는 [서버 자동 추첨 마이그레이션](../supabase/migrations/20260916000000_auto_lottery_cron.sql)
   전체를 SQL Editor의 **postgres 역할**로 실행한다. 새 DB는 먼저
   `supabase/migrations.sql`의 기본 스키마를 구성한 뒤 실행한다.
2. 브라우저 자동 실행을 제거한 새 앱을 배포한다. 새 앱의 설정 저장은 추가된
   작성 관리자 컬럼을 사용하므로 DB 마이그레이션을 먼저 적용한다.
3. 아래 읽기 전용 SQL로 예약 작업이 활성화됐는지 확인한다.
4. 설정에서 자동 추첨, 신청 마감일, 대상 분기를 저장한다. 이미 저장된 설정은
   그대로 사용한다. 미처리 마감일이 이미 지났다면 다음 분부터 실제 추첨과
   문서 게시가 실행된다.

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'auto-lottery-after-deadline';
-- schedule = '* * * * *', active = true, command = select public.run_due_auto_lottery();

select request_freeze_date, auto_lottery_enabled, auto_lottery_done_for,
       extra_request_year, extra_request_quarter, auto_lottery_admin_staff_id
from public.app_settings where id = 1;
```

함수와 예약 작업은 같은 이름으로 재적용할 수 있다. 기존 다른 Cron 작업은 수정하지 않는다.
마이그레이션 자체는 추첨 함수를 직접 호출하지 않는다. 예약 작업이 커밋된 뒤부터 실행된다.
브라우저에서 함수를 호출하는 경로도 다시 추가하지 않는다.

## 운영 확인

Supabase Dashboard의 **Integrations → Cron → History**에서 실행 결과를 확인한다.
앱에서는 신청현황의 새로고침 버튼으로 완료 기록을 읽고 문서 메뉴에서 결과를 확인한다.

```sql
select r.status, r.start_time, r.end_time, r.return_message
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where j.jobname = 'auto-lottery-after-deadline'
order by r.start_time desc
limit 20;
```

중단하려면 앱 설정에서 자동 추첨을 끄면 된다. 예약 작업 자체를 중단하려면:

```sql
select cron.unschedule('auto-lottery-after-deadline');
```

이 작업 때문에 `pg_cron` 확장을 삭제하지 않는다. 다른 예약 작업도 함께 삭제되기 때문이다.

## 검증

`npm run test:lottery`는 별도의 메모리 Postgres(PGlite)에서 기본 마이그레이션과
추첨 함수를 실행한다. 시계와 Cron 예약 등록만 테스트용으로 대체한다.
한국 시간 자정, 정원·분기 범위, 기존 결과 보존, 중복 문서 방지, 문서·완료 기록
실패 시 전체 롤백, 정원 0과 1,000건 초과 신청을 검증한다.
실제 Cron 데몬의 실행 여부는 운영 적용 후 위 실행 기록으로 확인한다.

참고: [Supabase Cron](https://supabase.com/docs/guides/cron),
[Cron 설치](https://supabase.com/docs/guides/cron/install),
[예약 작업 등록](https://supabase.com/docs/guides/cron/quickstart).
