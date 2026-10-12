import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import ExcelJS from "exceljs";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith("@/") ? path.join(root, name.slice(2)) : name, ...args);
};
Module._extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
  });
  module._compile(outputText, filename);
};
require.cache[path.join(root, "lib/supabase.ts")] = { exports: { supabase: {} } };
const { buildEmployeeMonthCells } = require("../lib/schedule-excel.ts");
const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
const args = {
  staffId: 1,
  maps: {
    dates,
    regularByStaff: new Map(dates.map((d, i) => [`1|${d}`, ["60~", "휴72", "60", "58"][i]])),
    displayByStaff: new Map(dates.map((d, i) => [`1|${d}`, ["60~", "휴72", "휴77", "58"][i]])),
    specialByStaff: new Map(), holidaySet: new Set(),
  },
  jigeunTurns: { dayTurns: ["60~"], nightTurns: ["휴72"] },
  weekendHolidayTurns: [],
};

test("엑셀 안보임은 주간·야간·운휴대기 원래 번호만 숨기고 표기·집계·색상 판정을 보존한다", () => {
  const baseline = buildEmployeeMonthCells(args);
  assert.deepEqual(baseline.cells.map((c) => c.text), ["60~ 지(주)", "휴72 지(야)비", "60\n휴77", "58"]);
  for (const [key, index, expected] of [
    ["hideDayTurn", 0, "지(주)"],
    ["hideNightTurn", 1, "지(야)비"],
    ["hideOriginalHolidayTurn", 2, "휴77"],
  ]) {
    const result = buildEmployeeMonthCells({ ...args, visibility: { [key]: true } });
    assert.equal(result.cells[index].text, expected);
    assert.deepEqual(result.totals, baseline.totals);
    result.cells.forEach((cell, i) => {
      const { text, ...metadata } = cell;
      const { text: originalText, ...originalMetadata } = baseline.cells[i];
      assert.deepEqual(metadata, originalMetadata);
      if (i !== index) assert.equal(text, originalText);
    });
  }
});

function exportFunction(name, deps) {
  const file = "components/admin-calendar.tsx";
  const source = readFileSync(path.join(root, file), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer);
  const { outputText } = ts.transpileModule(`const run = ${initializer.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  return new Function(...Object.keys(deps), `${outputText}\nreturn run;`)(...Object.values(deps));
}

test("숨김은 지근·지휴 신청 표기를 지우지 않고 연휴 치환 배지도 남긴다", () => {
  const maps = {
    ...args.maps,
    displayByStaff: new Map(args.maps.displayByStaff).set(`1|${dates[2]}`, "지(야)~"),
    specialByStaff: new Map([[`1|${dates[0]}`, "지근"], [`1|${dates[1]}`, "지휴"]]),
  };
  const baseline = buildEmployeeMonthCells({ ...args, maps });
  const hidden = buildEmployeeMonthCells({ ...args, maps, visibility: { hideDayTurn: true, hideNightTurn: true, hideOriginalHolidayTurn: true } });
  assert.deepEqual(hidden.cells.map((c) => c.text), ["지근", "지휴", "지(야)~", "58"]);
  assert.deepEqual(hidden.totals, baseline.totals);
});

test("분기 신청현황 시트의 근무번호에도 같은 숨김 선택을 적용한다", () => {
  const { getTurnDisplay } = require("../lib/schedule-utils.ts");
  const { getJigeunKind, getJigeunBadgeLabel } = require("../lib/types.ts");
  const run = exportFunction("buildRequestRoster", { getTurnDisplay, getJigeunKind, getJigeunBadgeLabel, jigeunTurns: args.jigeunTurns });
  const maps = { ...args.maps, specialByStaff: new Map(dates.map((date) => [`1|${date}`, "지근"])) };
  const employees = [{ staff_id: 1, staff_name: "테스트직원" }];
  const roster = run(maps, employees, { hideDayTurn: true, hideNightTurn: true, hideOriginalHolidayTurn: true });
  assert.deepEqual(dates.map((date) => roster.get(date).지근[0]), ["테스트직원(지(주))", "테스트직원(지(야)비)", "테스트직원(휴77)", "테스트직원(58)"]);
});

test("월간·분기 실제 xlsx 다운로드에 선택한 표시 옵션을 전달하고 배경색·합계를 유지한다", async () => {
  const { monthRestTotal } = require("../lib/schedule-excel.ts");
  const { getTurnExcelFill, getDayName, getDayExcelColor } = require("../lib/schedule-utils.ts");
  const { DEFAULT_EXCEL_FILL_COLORS } = require("../lib/types.ts");
  for (const quarterly of [false, true]) {
    const files = [];
    const run = exportFunction(quarterly ? "exportQuarterExcel" : "exportExcel", {
      ExcelJS, POSITIONS: ["기관사"], monthValue: "2026-10", quarterInfo: { year: 2026, quarter: 4 },
      holidayTurnRules: [], jigeunTurns: args.jigeunTurns, weekendHolidayTurns: [], excelColors: DEFAULT_EXCEL_FILL_COLORS,
      buildMonthMaps: async () => args.maps,
      fetchExportEmployees: async () => [{ staff_id: 1, staff_name: "테스트직원", employee_number: "00123", staff_position: "기관사" }],
      quarterMonths: () => ["10", "11", "12"].map((month) => ({ start: `2026-${month}-01` })),
      buildEmployeeMonthCells, monthRestTotal, getDayName, getDayExcelColor, getTurnExcelFill,
      buildRequestRoster: () => new Map(),
      downloadWorkbook: async (wb) => {
        const loaded = new ExcelJS.Workbook();
        await loaded.xlsx.load(await wb.xlsx.writeBuffer());
        files.push(loaded);
      },
    });
    await run();
    await run({ hideDayTurn: true, hideNightTurn: true, hideOriginalHolidayTurn: true });
    const column = quarterly ? 5 : 3;
    const original = files[0].getWorksheet("기관사");
    const hidden = files[1].getWorksheet("기관사");
    assert.deepEqual([0, 1, 2, 3].map((i) => hidden.getCell(2, column + i).value), ["지(주)", "지(야)비", "휴77", "58"]);
    assert.equal(hidden.getCell("B2").value, original.getCell("B2").value);
    for (let i = 0; i < 4; i++) assert.deepEqual(hidden.getCell(2, column + i).fill, original.getCell(2, column + i).fill);
  }
});
