import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost" });
for (const key of ["window", "document", "navigator", "sessionStorage"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith("@/") ? path.join(root, name.slice(2)) : name, ...args);
};
Module._extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
let response;
let calls;
require.cache[path.join(root, "lib/supabase.ts")] = {
  exports: { supabase: { from: (table) => {
    calls.push(table);
    return { select: () => ({ eq: () => ({ maybeSingle: async () => response }) }) };
  } } },
};
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { useMonthState } = require("../lib/use-month-state.ts");
const { getTodayMonthStr } = require("../lib/schedule-utils.ts");
async function render(scope, check) {
  const container = document.createElement("div");
  const root = createRoot(container);
  let setMonth;
  function Probe() {
    const [month, setter] = useMonthState(scope);
    React.useEffect(() => { setMonth = setter; }, [setter]);
    return React.createElement("span", null, month);
  }
  try {
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Probe))); });
    await check(container, async (month) => { await act(async () => { setMonth(month); }); });
  } finally {
    await act(async () => { root.unmount(); });
  }
}
test.beforeEach(() => {
  sessionStorage.clear();
  calls = [];
  response = { data: { extra_request_year: 2031, extra_request_quarter: 2 }, error: null };
});

test("관리자와 사용자 달력은 설정된 연도·분기의 첫 달을 표시한다", async () => {
  for (const scope of ["admin-calendar", "user-calendar"]) {
    sessionStorage.setItem(`dia_month_${scope}`, "2020-12");
    for (const [quarter, month] of [[1, "01"], [2, "04"], [3, "07"], [4, "10"]]) {
      response.data.extra_request_quarter = quarter;
      await render(scope, (container) => { assert.equal(container.textContent, `2031-${month}`); });
    }
  }
  assert.ok(calls.includes("app_settings"));
});

test("월 이동과 재마운트 시 선택 월을 유지하고 대상 분기 변경 시 첫 달을 표시한다", async () => {
  for (const scope of ["admin-calendar", "user-calendar"]) {
    response.data.extra_request_quarter = 2;
    await render(scope, async (container, setMonth) => {
      await setMonth("2031-05");
      assert.equal(container.textContent, "2031-05");
    });
    await render(scope, (container) => { assert.equal(container.textContent, "2031-05"); });
    response.data.extra_request_quarter = 3;
    await render(scope, (container) => { assert.equal(container.textContent, "2031-07"); });
  }
});

test("분기 미설정·잘못된 설정·조회 오류는 현재 월로 대체한다", async () => {
  for (const result of [
    { data: null, error: null },
    { data: { extra_request_year: null, extra_request_quarter: 2 }, error: null },
    { data: { extra_request_year: 2031, extra_request_quarter: 5 }, error: null },
    { data: null, error: new Error("settings unavailable") },
  ]) {
    response = result;
    await render("user-calendar", (container) => { assert.equal(container.textContent, getTodayMonthStr()); });
  }
});

test("저장소 접근이 차단되어도 설정 분기와 월 이동은 동작한다", async () => {
  const prototype = Object.getPrototypeOf(sessionStorage);
  const getItem = prototype.getItem;
  const setItem = prototype.setItem;
  prototype.getItem = prototype.setItem = () => { throw new Error("Storage blocked"); };
  try {
    await render("admin-calendar", async (container, setMonth) => {
      assert.equal(container.textContent, "2031-04");
      await setMonth("2031-06");
      assert.equal(container.textContent, "2031-06");
    });
  } finally {
    prototype.getItem = getItem;
    prototype.setItem = setItem;
  }
});

test("근무표와 신청 목록의 기존 저장 월은 변경하지 않는다", async () => {
  for (const scope of ["schedule-viewer", "requests-panel"]) {
    sessionStorage.setItem(`dia_month_${scope}`, "2030-12");
    await render(scope, (container) => { assert.equal(container.textContent, "2030-12"); });
  }
  assert.deepEqual(calls, []);
});
