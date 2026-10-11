import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { startOfMonth, endOfMonth, format } from "date-fns";

// 실제 다운로드 함수 본문을 실행한다. DB 조회만 고정 입력으로 대체하고,
// ExcelJS로 직렬화한 xlsx를 다시 읽어 열 위치·병합·서식을 검증한다.
function exportFunction(file, name, deps) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer, `${file}: ${name}`);
  const { outputText } = ts.transpileModule(`const run = ${initializer.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  return new Function(...Object.keys(deps), `${outputText}\nreturn run;`)(...Object.values(deps));
}

async function roundTrip(workbook) {
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(await workbook.xlsx.writeBuffer());
  return result;
}

const employee = { staff_id: 1, staff_name: "테스트직원", employee_number: "00123", staff_position: "기관사" };
const cells = [{ text: "휴72 지(야)비", turn: "휴72", isRest: false, isSubstituted: false, special: null }];
const makeMaps = (month) => ({ dates: [`${month}-01`], holidaySet: new Set([`${month}-01`]) });

test("관련 목록 xlsx는 사번 열 없이 이름(사번)과 전화번호·날짜 서식을 유지한다", async () => {
  for (const requests of [false, true]) {
    let blob;
    const run = exportFunction(`components/admin-panels/${requests ? "requests-panel" : "lottery-losers-panel"}.tsx`, "exportExcel", {
      ExcelJS, year: 2026, quarter: 4, monthValue: "2026-10", nameFilter: "", positionFilter: "전체",
      filtered: requests
        ? [{ employee: { ...employee, phone_number: "01012345678" }, target_date: "2026-10-01", regularTurn: "휴71", record_type: "지근" }]
        : [{ ...employee, phone_number: "01012345678", dates: [{ target_date: "2026-10-01", record_type: "지근" }] }],
      jigeunNumberRows: [], designatedNightRows: [], EXCLUDED_EXPORT_TURNS: ["휴72"], DESIGNATED_NIGHT_TURN: "지(야)",
      startOfMonth, endOfMonth, format, holidays: new Set(), getDayName: () => "목", getDayExcelColor: () => "FFFF0000",
      shortDateLabel: (date) => date,
      Blob, URL: { createObjectURL: (value) => { blob = value; return "blob:test"; }, revokeObjectURL: () => {} },
      document: { createElement: () => ({ click() {} }) },
    });
    await run();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet(requests ? "직원정보" : "추첨 탈락자");
    assert.equal(ws.getCell("A1").value, "직책");
    assert.equal(ws.getCell("B1").value, "이름");
    assert.equal(ws.getCell("B2").value, "테스트직원(00123)");
    assert.equal(ws.getCell("C2").value, "01012345678");
    assert.equal(ws.columnCount, requests ? 6 : 5);
    if (requests) assert.equal(ws.getCell("D2").font.color.argb, "FFFF0000");
    else assert.equal(ws.getCell("C2").numFmt, "@");
  }
});

test("분기휴무 검증 xlsx도 사번 열을 없애고 사번 누락 시 이름만 표시한다", async () => {
  let buffer;
  const run = exportFunction("components/quarter-balance.tsx", "exportExcel", {
    XLSX: { ...XLSX, writeFile: (wb) => { buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }); } },
    year: 2026, quarter: 4, position: "기관사", total: () => 23, QUARTER_TARGET: 24,
    mismatched: [employee, { ...employee, employee_number: null }],
  });
  run();
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  assert.equal(rows[0].includes("사번"), false);
  assert.equal(rows[0][1], "이름");
  assert.equal(rows[1][1], "테스트직원(00123)");
  assert.equal(rows[2][1], "테스트직원");
});

for (const quarterly of [false, true]) {
  test(`${quarterly ? "분기" : "월간"} 근무표 xlsx는 이름(사번)으로 통합하고 날짜·총휴무·틀 고정·병합을 유지한다`, async () => {
    let workbook;
    const run = exportFunction("components/admin-calendar.tsx", quarterly ? "exportQuarterExcel" : "exportExcel", {
      ExcelJS, POSITIONS: ["기관사"], monthValue: "2026-10", quarterInfo: { year: 2026, quarter: 4 },
      holidayTurnRules: [], jigeunTurns: {}, weekendHolidayTurns: [], excelColors: {},
      buildMonthMaps: async (month) => makeMaps(month), fetchExportEmployees: async () => [employee],
      quarterMonths: () => ["10", "11", "12"].map((m) => ({ start: `2026-${m}-01` })),
      buildEmployeeMonthCells: () => ({ cells, totals: 2 }), monthRestTotal: (totals) => totals,
      getDayName: () => "일", getDayExcelColor: () => "FFFF0000", getTurnExcelFill: () => "FFCCEFFF",
      buildRequestRoster: () => new Map(),
      downloadWorkbook: async (wb) => { workbook = await roundTrip(wb); },
    });
    await run();
    const ws = workbook.getWorksheet("기관사");
    assert.equal(ws.getCell("A1").value, "이름");
    assert.equal(ws.getCell("A2").value, "테스트직원(00123)");
    assert.equal(ws.getCell("B1").value, "총휴무갯수");
    assert.equal(ws.getCell("B2").value, quarterly ? 6 : 2);
    assert.equal(ws.columnCount, quarterly ? 5 : 3);
    assert.equal(ws.views[0].xSplit, quarterly ? 4 : 2);
    const dayCell = ws.getCell(2, quarterly ? 5 : 3);
    assert.equal(dayCell.value, "휴72 지(야)비");
    assert.equal(dayCell.fill.fgColor.argb, "FFCCEFFF");
    if (quarterly) {
      assert.deepEqual(ws.model.merges.sort(), ["A2:A4", "B2:B4"]);
      assert.equal(ws.getCell("C2").value, "10월");
      assert.equal(ws.getCell("D2").value, 2);
    } else {
      assert.equal(ws.getCell("C1").font.color.argb, "FFFF0000");
    }
  });
}
