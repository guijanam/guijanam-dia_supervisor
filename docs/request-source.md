# 지근 신청 출처 색상

## 운영 적용 순서

1. 운영 DB 변경 승인을 받은 후 해당 승무소 Supabase SQL Editor에서
   `supabase/migrations/20261011000000_request_source.sql`을 실행한다.
2. `information_schema.columns`에서 `public.special_schedules.request_source`가
   존재하고 `pg_trigger`에서 `preserve_special_schedule_request_source`가 활성 상태인지 확인한다.
3. 프런트엔드를 배포한 뒤 관리자 신규 지근 등록 → 재조회 → 주황색 표시,
   사용자 신규 지근 등록 → 재조회 → 기존 직책별 색상 유지를 확인한다.

운영 DB에는 이 작업에서 마이그레이션을 실행하지 않았다.

## 의미와 호환

- `request_source`: 최초 등록 화면 출처. `admin`/`user`, 기존 미상은 `NULL`.
- 관리자 등록 **지근**만 주황색. 지휴는 빨간색을 유지한다.
- 기존 사용자 신청의 관리자 수정·날짜 이동·추첨은 최초 출처를 보존한다.
  동일 직원/날짜 upsert 충돌도 원출처를 유지한다.
- 기존 기록은 소급 분류하지 않는다. 삭제 후 새로 등록하면 새 기록이다.
- 컬럼 미적용 DB에서는 `select('*')`로 기존 조회를 유지한다.
  출처 필드 누락이 명확한 `PGRST204`/`42703` 오류만 필드를 빼고 한 번 재시도한다.
  이 경우 신청 자체는 유지되나 **출처 저장·주황 표시를 보장하지 못한다**.
  다른 오류는 재시도하지 않고 기존 오류 처리로 전달한다.
- 출처는 클라이언트가 제출하는 **색상 메타데이터**다. 기존 RLS의 권한 모델을
  강화하지 않으며, 관리자 권한이나 신뢰 가능한 감사 기록으로 사용하면 안 된다.

## 로컬 검증

`node --test tests/request-source.test.mjs`

PGlite로 마이그레이션 재실행, user/admin/NULL 저장, upsert/수정/추첨 출처 보존,
허용 값 제약을 검증한다. 운영 Supabase 및 로그인 브라우저 검증과는 별개다.
