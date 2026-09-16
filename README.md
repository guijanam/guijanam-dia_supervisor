근무 순서 관리 시스템 — 개별 로그인, 지근/지휴 신청, 관리자 통합 관리 기능 포함.

## 셋업

1. 의존성 설치: `npm install`
2. 환경변수: `cp .env.example .env.local` 후 Supabase 값 입력
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. DB: `supabase/migrations.sql` 을 Supabase SQL Editor 에서 실행
   - 기존 `coworker_list`(직원 마스터) 에 `role` 컬럼 추가
   - `special_schedules` 테이블 + RLS 생성 (`staff_id` 로 연결)
   - `coworker_list.employee_number` 가 비어 있으면 사번 데이터 입력
   - 이어서 `supabase/migrations/20260916000000_auto_lottery_cron.sql` 실행
     (관리자 접속 없이 마감 후 자동 추첨·문서 게시를 위한 서버 예약 작업)
4. 관리자 지정: `update coworker_list set role='admin' where staff_name='홍길동';`

> **새 승무소에 이 서비스를 추가하려면** — 코드는 그대로 두고 Supabase
> 프로젝트와 Vercel 배포만 따로 만든다.
> 절차: [docs/multi-depot-deployment.md](docs/multi-depot-deployment.md)

## 기능

- **로그인**: 이름 + 사번(`employee_number`) → `coworker_list` 조회 (localStorage 세션)
- **일반 직원**: 월간 캘린더에서 본인 정규 근무(`staff_id` 매칭) + 지근/지휴 확인, 날짜 클릭 시 신청/삭제
- **관리자**: 전체 지근/지휴 통합 조회·편집·삭제, 월·이름 필터, Excel(xlsx) 다운로드
- 관리자 접근은 `role='admin'` 게이트로 제어 (RLS + anon)
- **서버 자동 추첨**: 한국 시간 기준 마감 다음날 0시 이후, Supabase Cron이
  매분 확인해 분기 지근 추첨·결과 문서 게시를 1회 처리. 관리자 접속 불필요.
  설정·적용·운영 확인: [docs/auto-lottery-cron.md](docs/auto-lottery-cron.md)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
