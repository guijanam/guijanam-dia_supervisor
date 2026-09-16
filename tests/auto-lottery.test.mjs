import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../supabase/migrations/20260916000000_auto_lottery_cron.sql", import.meta.url),
  "utf8",
);
const baseline = await readFile(new URL("../supabase/migrations.sql", import.meta.url), "utf8");

test("server auto lottery integration", async (t) => {
  const db = await PGlite.create();
  try {
    // 실제 기본 마이그레이션에 필요한 기존 시스템/Supabase 테이블만 준비한다.
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.coworker_list (
        staff_id integer primary key, staff_name text not null,
        staff_position text not null, employee_number integer, pattern_id uuid
      );
      create table public.work_patterns (id uuid primary key, pattern_name text, shift_types text[]);
      create table public.holidays (locdate date primary key, is_holiday text);
      create schema storage;
      create table storage.objects (id uuid primary key, bucket_id text);

      -- PGlite에는 pg_cron 데몬이 없다. 예약 등록만 모사하며 함수 본문은 그대로 실행한다.
      create schema cron;
      create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
      create function cron.schedule(text, text, text) returns bigint language sql as $$
        insert into cron.job(jobname, schedule, command) values ($1, $2, $3)
        on conflict(jobname) do update set schedule = $2, command = $3 returning jobid;
      $$;
    `);
    await db.exec(baseline);
    await db.exec(`
      insert into public.coworker_list(staff_id, staff_name, staff_position, role)
      select id, '직원' || id,
             case when id <= 7 then '기관사' when id <= 13 then '차장' else '기타' end,
             case when id = 1 then 'admin' else 'user' end
      from generate_series(1, 14) id;
    `);

    // 예약 시각의 경계 검증을 위해 시계만 고정한다. 운영 함수는 서버의 시각을 사용한다.
    const localMigration = migration
      .replace("create extension if not exists pg_cron with schema pg_catalog;", "")
      .replaceAll("statement_timestamp()", "current_setting('test.lottery_now')::timestamptz");
    await db.exec(localMigration);

    const scalar = async (sql) => (await db.query(sql)).rows[0].value;
    const run = async () => scalar("select public.run_due_auto_lottery() as value");
    const clock = async (iso) => db.query("select set_config('test.lottery_now', $1, false)", [iso]);
    const reset = async () => {
      await db.exec(`
        truncate public.special_schedules, public.documents cascade;
        truncate public.holidays;
        update public.app_settings set auto_lottery_enabled = true,
          request_freeze_date = '2026-09-15', auto_lottery_done_for = null,
          extra_request_year = 2026, extra_request_quarter = 4,
          auto_lottery_admin_staff_id = 1, extra_request_deadline = null,
          jigeun_cap_weekday = 2, jigeun_cap_saturday = 1,
          jigeun_cap_sunday = 3, jigeun_cap_holiday = 4;
      `);
      await clock("2026-09-16T00:00:00Z");
    };
    const pool = async (date, position = "기관사", size = 5, recordType = "지근") => {
      await db.query(`
        insert into public.special_schedules(staff_id, target_date, record_type)
        select staff_id, $1::date, $3 from public.coworker_list
        where staff_position = $2 and role <> 'admin' order by staff_id limit $4
      `, [date, position, recordType, size]);
    };

    await t.test("migration registers one job and prevents browser RPC execution", async () => {
      await db.exec(localMigration);
      const { rows } = await db.query("select jobname, schedule, command from cron.job");
      assert.deepEqual(rows, [{
        jobname: "auto-lottery-after-deadline", schedule: "* * * * *",
        command: "select public.run_due_auto_lottery();",
      }]);
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(await scalar(`select has_function_privilege('${role}', 'public.run_due_auto_lottery()', 'execute') as value`), false);
      }
    });

    await t.test("disabled, missing deadline and deadline day never draw", async () => {
      await reset();
      await pool("2026-10-05");
      await db.exec("update public.app_settings set auto_lottery_enabled = false");
      assert.equal((await run()).status, "not-due");
      await db.exec("update public.app_settings set auto_lottery_enabled = true, request_freeze_date = null");
      assert.equal((await run()).status, "not-due");
      await db.exec("update public.app_settings set request_freeze_date = '2026-09-16'");
      assert.equal((await run()).status, "not-due");
      assert.equal(await scalar("select count(*)::int as value from public.documents"), 0);
      assert.equal(await scalar("select count(*)::int as value from public.special_schedules where lottery_status is not null"), 0);
    });

    await t.test("Korean midnight triggers regardless of database timezone", async () => {
      await reset();
      await pool("2026-10-05");
      await db.exec("set timezone = 'Pacific/Honolulu'");
      await clock("2026-09-15T14:59:59Z"); // 한국 9/15 23:59:59
      assert.equal((await run()).status, "not-due");
      await clock("2026-09-15T15:00:00Z"); // 한국 9/16 00:00:00, UTC는 아직 9/15
      assert.equal((await run()).status, "done");
      const body = await scalar("select description as value from public.documents");
      assert.match(body, /2026-09-16 00:00:00 한국 시간 실행/);
      await db.exec("set timezone = 'UTC'");
    });

    await t.test("quarter range, position caps, holiday precedence and existing outcomes", async () => {
      await reset();
      for (const day of ["2026-10-05", "2026-10-10", "2026-10-11", "2026-10-09", "2026-10-17", "2026-12-31"]) {
        await pool(day);
      }
      await pool("2026-10-05", "차장");
      await pool("2026-10-20");
      await db.exec(`update public.special_schedules set lottery_status = 'won'
        where target_date = '2026-10-20' and staff_id = 2`);
      await pool("2026-10-21", "기관사", 2); // 정원과 같으면 추첨하지 않음
      await pool("2026-10-22", "기관사", 5, "지휴");
      await pool("2026-09-30");
      await pool("2027-01-01");
      await db.exec(`insert into public.holidays values ('2026-10-09', 'Y'), ('2026-10-17', 'Y');
        update public.app_settings set extra_request_deadline = '2026-09-23'`);
      const result = await run();
      assert.equal(result.target_count, 7);
      assert.equal(result.won_count, 18);
      assert.equal(result.lost_count, 17);
      const doc = (await db.query("select * from public.documents")).rows[0];
      assert.equal(doc.title, "2026년 4분기 지근 추첨 결과");
      assert.equal(doc.created_by, 1);
      assert.equal(doc.file_url, null);
      assert.match(doc.description, /2026-10-01 ~ 2026-12-31/);
      assert.match(doc.description, /2026-09-23까지/);
      const expected = [
        ["2026-10-05", "기관사", 2], ["2026-10-05", "차장", 2],
        ["2026-10-10", "기관사", 1], ["2026-10-11", "기관사", 3],
        ["2026-10-09", "기관사", 4], ["2026-10-17", "기관사", 4],
        ["2026-12-31", "기관사", 2],
      ];
      for (const [date, position, cap] of expected) {
        const { rows } = await db.query(`
          select c.staff_name, s.lottery_status from public.special_schedules s
          join public.coworker_list c using(staff_id)
          where s.target_date = $1::date and c.staff_position = $2
        `, [date, position]);
        assert.equal(rows.filter((r) => r.lottery_status === "won").length, cap);
        assert.equal(rows.filter((r) => r.lottery_status === "lost").length, 5 - cap);
        const section = doc.description.split(`■ ${date} ${position} (정원 ${cap})\n`)[1].split("\n\n")[0];
        for (const row of rows) {
          const line = section.split("\n").find((line) => line.includes(row.lottery_status === "won" ? "당첨:" : "탈락:"));
          assert.ok(line.includes(row.staff_name), "게시 명단은 DB 추첨 결과와 같아야 한다");
        }
      }
      assert.equal(await scalar(`select count(*)::int as value from public.special_schedules
        where target_date = '2026-10-20' and lottery_status is null`), 4);
      assert.equal(await scalar(`select count(*)::int as value from public.special_schedules
        where target_date in ('2026-10-21', '2026-10-22', '2026-09-30', '2027-01-01')
        and lottery_status is not null`), 0);
    });

    await t.test("same deadline does not redraw or repost; a new deadline runs again", async () => {
      await reset();
      await pool("2026-10-05");
      await run();
      const outcomes = (await db.query("select id, lottery_status, lottery_at from public.special_schedules order by id")).rows;
      assert.equal((await run()).status, "already-done");
      assert.equal(await scalar("select count(*)::int as value from public.documents"), 1);
      await db.exec("update public.app_settings set request_freeze_date = '2026-09-14'");
      assert.equal((await run()).target_count, 0);
      assert.equal(await scalar("select count(*)::int as value from public.documents"), 2);
      assert.deepEqual((await db.query("select id, lottery_status, lottery_at from public.special_schedules order by id")).rows, outcomes);
    });

    await t.test("no applicants still publishes an explanatory result once", async () => {
      await reset();
      assert.equal((await run()).target_count, 0);
      const body = await scalar("select description as value from public.documents");
      assert.match(body, /추첨할 미추첨 정원 초과 지근 신청이 없습니다/);
      assert.ok(!body.includes("추가 신청 기간"));
      assert.equal((await run()).status, "already-done");
    });

    await t.test("invalid quarter or author fails without changing outcomes", async () => {
      await reset();
      await pool("2026-10-05");
      await db.exec("update public.app_settings set extra_request_quarter = null");
      await assert.rejects(run(), /대상 분기/);
      await db.exec("update public.app_settings set extra_request_quarter = 4, auto_lottery_admin_staff_id = 2");
      await assert.rejects(run(), /작성 관리자/);
      assert.equal(await scalar("select count(*)::int as value from public.special_schedules where lottery_status is not null"), 0);
      assert.equal(await scalar("select count(*)::int as value from public.documents"), 0);
    });

    await t.test("document failure rolls back the draw; retry publishes the full outcome", async () => {
      await reset();
      await pool("2026-10-05");
      await db.exec(`
        create function public.reject_lottery_document() returns trigger language plpgsql as $$
          begin raise exception 'test document failure'; end;
        $$;
        create trigger reject_lottery_document before insert on public.documents
          for each row execute function public.reject_lottery_document();
      `);
      await assert.rejects(run(), /test document failure/);
      assert.equal(await scalar("select count(*)::int as value from public.special_schedules where lottery_status is not null"), 0);
      assert.equal(await scalar("select auto_lottery_done_for as value from public.app_settings"), null);
      await db.exec("drop trigger reject_lottery_document on public.documents");
      assert.equal((await run()).target_count, 1);
      assert.equal(await scalar("select count(*)::int as value from public.documents"), 1);
      assert.match(await scalar("select description as value from public.documents"), /당첨: 직원/);
    });

    await t.test("completion update failure also rolls back both outcomes and document", async () => {
      await reset();
      await pool("2026-10-05");
      await db.exec(`
        create function public.reject_lottery_completion() returns trigger language plpgsql as $$
          begin
            if new.auto_lottery_done_for is not null then raise exception 'test completion failure'; end if;
            return new;
          end;
        $$;
        create trigger reject_lottery_completion before update on public.app_settings
          for each row execute function public.reject_lottery_completion();
      `);
      await assert.rejects(run(), /test completion failure/);
      assert.equal(await scalar("select count(*)::int as value from public.special_schedules where lottery_status is not null"), 0);
      assert.equal(await scalar("select count(*)::int as value from public.documents"), 0);
      assert.equal(await scalar("select auto_lottery_done_for as value from public.app_settings"), null);
      await db.exec("drop trigger reject_lottery_completion on public.app_settings");
      assert.equal((await run()).status, "done");
    });

    await t.test("zero capacity and more than 1000 applicants are handled in the database", async () => {
      await reset();
      await db.exec(`
        insert into public.coworker_list(staff_id, staff_name, staff_position)
          select id, '대량직원' || id, '기관사' from generate_series(100, 1204) id;
        insert into public.special_schedules(staff_id, target_date, record_type)
          select staff_id, '2026-10-05', '지근' from public.coworker_list where staff_id >= 100;
        update public.app_settings set jigeun_cap_weekday = 0;
      `);
      const result = await run();
      assert.equal(result.won_count, 0);
      assert.equal(result.lost_count, 1105);
      assert.match(await scalar("select description as value from public.documents"), /당첨: -/);
      assert.equal(await scalar("select count(*)::int as value from public.special_schedules where lottery_status = 'lost'"), 1105);
    });
  } finally {
    await db.close();
  }
});
