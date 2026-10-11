import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

test("출처 마이그레이션은 기존 미상을 보존하며 편집·upsert·추첨이 최초 출처를 바꾸지 않는다", async () => {
  const migrationFile = new URL("../supabase/migrations/20261011000000_request_source.sql", import.meta.url);
  assert.ok(existsSync(migrationFile), "신청 출처 마이그레이션이 필요합니다");
  const db = await PGlite.create();
  try {
    await db.exec(`create table special_schedules (id integer primary key, record_type text, lottery_status text);
      insert into special_schedules values (1, '지근', null);`);
    const sql = readFileSync(migrationFile, "utf8");
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`insert into special_schedules values (2, '지근', null, 'user'), (3, '지근', null, 'admin');
      update special_schedules set record_type='지휴', request_source='admin' where id=2;
      insert into special_schedules values (1, '지근', null, 'admin') on conflict(id) do update set request_source=excluded.request_source;
      update special_schedules set lottery_status='won';`);
    assert.deepEqual((await db.query("select request_source from special_schedules order by id")).rows.map((r) => r.request_source), [null, "user", "admin"]);
    await assert.rejects(db.exec("insert into special_schedules values (4, '지근', null, 'invalid')"));
  } finally { await db.close(); }
});

const file = new URL("../lib/request-source.ts", import.meta.url);
const source = existsSync(file) ? readFileSync(file, "utf8") : "";
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const helpers = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("실제 관리자 등록 두 경로와 사용자·대리등록 모달이 올바른 출처를 제출한다", async () => {
  const cases = [
    ["components/admin-calendar.tsx", "submitAdd", "admin"],
    ["components/admin-panels/requests-panel.tsx", "submitAdd", "admin"],
    ["components/day-modal.tsx", "register", "user"],
    ["components/day-modal.tsx", "register", "admin"],
  ];
  for (const [file, name, source] of cases) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let fn;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) fn = node.initializer;
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(fn);
    let written;
    const noop = () => {};
    const deps = {
      writeWithRequestSource: helpers.writeWithRequestSource,
      supabase: { from: () => ({ upsert: async (payload) => { written = payload; return { error: null }; } }) },
      selectedDate: "2026-10-01", addDate: "2026-10-01", monthValue: "2026-10", addStaffId: "1", addType: "지근",
      employee: { staff_id: 1 }, date: "2026-10-01", requestSource: source, canRegister: true, canRegisterJigeun: true,
      setAddBusy: noop, setAddError: noop, setAddStaffId: noop, setAddOpen: noop, fetchData: noop,
      setIsSaving: noop, setError: noop, onChanged: noop, onClose: noop,
    };
    const { outputText } = ts.transpileModule(`const run = ${fn.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } });
    const run = new Function(...Object.keys(deps), `${outputText}\nreturn run;`)(...Object.values(deps));
    await run("지근");
    assert.equal(written.request_source, source, file);
  }
});

test("관리자 등록 지근만 주황색이고 사용자·미상·지휴는 기존색이다", () => {
  assert.equal(typeof helpers.getRequestBadgeClass, "function", "신청 출처별 색상 함수가 필요합니다");
  const color = helpers.getRequestBadgeClass;
  assert.match(color({ record_type: "지근", staff_position: "기관사", request_source: "admin" }), /bg-orange/);
  assert.match(color({ record_type: "지근", staff_position: "차장", request_source: "admin" }), /bg-orange/);
  assert.match(color({ record_type: "지근", staff_position: "기관사", request_source: "user" }), /bg-green/);
  assert.match(color({ record_type: "지근", staff_position: "차장", request_source: null }), /bg-blue/);
  assert.match(color({ record_type: "지휴", staff_position: "차장", request_source: "admin" }), /bg-red/);
});

test("출처 저장은 컬럼 누락 오류만 제한적으로 재시도한다", async () => {
  assert.equal(typeof helpers.writeWithRequestSource, "function", "출처 저장 호환 함수가 필요합니다");
  const payload = { staff_id: 1, record_type: "지근" };
  for (const source of ["user", "admin"]) {
    const calls = [];
    await helpers.writeWithRequestSource(async (value) => { calls.push(value); return { error: null }; }, payload, source);
    assert.deepEqual(calls, [{ ...payload, request_source: source }]);
  }
  const calls = [];
  const result = await helpers.writeWithRequestSource(async (value) => {
    calls.push(value);
    return calls.length === 1
      ? { error: { code: "PGRST204", message: "Could not find the 'request_source' column of 'special_schedules' in the schema cache" } }
      : { error: null };
  }, payload, "admin");
  assert.deepEqual(calls, [{ ...payload, request_source: "admin" }, payload]);
  assert.equal(result.sourceTracked, false);
  for (const error of [{ code: "23505", message: "duplicate" }, { code: "PGRST204", message: "missing another column" }, { code: "42501", message: "permission denied" }]) {
    let count = 0;
    const result = await helpers.writeWithRequestSource(async () => { count++; return { error }; }, payload, "admin");
    assert.equal(count, 1);
    assert.equal(result.error, error);
  }
});
