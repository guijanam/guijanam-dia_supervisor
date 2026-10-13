import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import ts from "typescript";

const require = createRequire(import.meta.url);
const project = path.resolve(import.meta.dirname, "..");
const dom = new JSDOM('<!doctype html><html><head><style>* { animation-name: none; }</style></head><body></body></html>', { url: "http://localhost" });
for (const key of ["window", "document", "navigator", "sessionStorage", "HTMLElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "HTMLInputElement"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith("@/") ? path.join(project, name.slice(2)) : name, ...args);
};
for (const ext of [".ts", ".tsx"]) {
  Module._extensions[ext] = (module, filename) => {
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let quarter;
let requests;
let employee;
const notice = { id: "notice-1", title: "안내 공지", content: "근무 확인", created_at: "2031-04-01T00:00:00Z", updated_at: "2031-04-01T00:00:00Z" };
require.cache[path.join(project, "lib/supabase.ts")] = {
  exports: { supabase: { from(table) {
    let columns;
    const query = {
      select(value) { columns = value; return query; },
      eq() { return query; }, gte() { return query; }, lte() { return query; },
      order() { return query; }, limit() { return query; }, in() { return query; },
      maybeSingle() {
        return columns === "extra_request_year, extra_request_quarter"
          ? quarter.promise : Promise.resolve({ data: null, error: null });
      },
      then(yes, no) {
        const data = table === "announcements" ? [notice] : [];
        return Promise.resolve({ data, error: null }).then(yes, no);
      },
    };
    return query;
  } } },
};
require.cache[path.join(project, "lib/fetch-schedule.ts")] = {
  exports: { fetchScheduleByRange(start, end) {
    const request = { start, end, ...deferred() };
    requests.push(request);
    return request.promise;
  } },
};
require.cache[path.join(project, "lib/auth-context.tsx")] = {
  exports: { useAuth: () => ({ employee, logout() {} }) },
};
for (const [file, name] of [
  ["day-modal", "DayModal"], ["document-board", "DocumentBoard"],
  ["reference-editor", "ReferenceEditor"], ["theme-toggle", "ThemeToggle"],
]) {
  require.cache[path.join(project, `components/${file}.tsx`)] = { exports: { [name]: () => null } };
}
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { UserCalendar } = require("../components/user-calendar.tsx");
const row = { staff_id: 7, name: "테스트 직원", staff_position: "기관사", pattern_name: "", date: "2031-04-01", turn: "TEST-TURN-101", phone_number: "" };
async function render(check) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(React.createElement(UserCalendar)); });
    await check(container, async () => {
      await act(async () => { root.render(React.createElement(UserCalendar)); });
    });
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}
async function selectQuarter() {
  await act(async () => {
    quarter.resolve({ data: { extra_request_year: 2031, extra_request_quarter: 2 }, error: null });
  });
  assert.equal(requests.length, 2, "초기 월과 대상 분기 월 조회가 겹치는 상황이어야 한다");
}
test.beforeEach(() => {
  sessionStorage.clear();
  window.localStorage.clear();
  sessionStorage.setItem("dia_month_user-calendar", "2030-12");
  quarter = deferred();
  requests = [];
  employee = { staff_id: 7, staff_name: "테스트 직원", staff_position: "기관사", role: "user" };
});

test("첫 진입·공지 팝업 후 이전 월 조회가 늦게 끝나도 현재 월 근무를 유지한다", async () => {
  await render(async (container) => {
    assert.ok(document.querySelector('[role="dialog"]'), "실제 공지 팝업이 자동으로 열려야 한다");
    await selectQuarter();
    await act(async () => { requests[1].resolve([row]); });
    assert.match(container.textContent, /2031-04/);
    assert.match(container.textContent, /TEST-TURN-101/);
    await act(async () => { requests[0].resolve([]); });
    const close = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === "확인");
    await act(async () => { close.click(); });
    assert.match(container.textContent, /TEST-TURN-101/, "이전 월 빈 결과가 현재 근무를 지우면 안 된다");
  });
});

test("이전 조회가 먼저 끝나도 현재 월 조회의 로딩 표시를 끄지 않는다", async () => {
  await render(async (container) => {
    await selectQuarter();
    await act(async () => { requests[0].resolve([]); });
    assert.ok(container.querySelector(".animate-spin"), "최신 조회가 진행 중이면 로딩을 유지해야 한다");
    await act(async () => { requests[1].resolve([row]); });
    assert.equal(container.querySelector(".animate-spin"), null);
    assert.match(container.textContent, /TEST-TURN-101/);
  });
});

test("이전 월의 늦은 조회 오류는 현재 월에 표시하지 않는다", async () => {
  await render(async (container) => {
    await selectQuarter();
    await act(async () => { requests[1].resolve([row]); });
    await act(async () => { requests[0].reject(new Error("STALE-ERROR")); });
    assert.doesNotMatch(container.textContent, /STALE-ERROR/);
    assert.match(container.textContent, /TEST-TURN-101/);
  });
});

test("현재 월 조회 실패는 오류를 표시하고 로딩을 종료한다", async () => {
  await render(async (container) => {
    await selectQuarter();
    await act(async () => { requests[1].reject(new Error("CURRENT-ERROR")); });
    assert.match(container.textContent, /CURRENT-ERROR/);
    assert.equal(container.querySelector(".animate-spin"), null);
    await act(async () => { requests[0].resolve([]); });
    assert.match(container.textContent, /CURRENT-ERROR/);
  });
});

test("직원 정보 갱신으로 조회가 겹쳐도 이전 직원 근무가 최신 결과를 덮지 않는다", async () => {
  await render(async (container, rerender) => {
    await selectQuarter();
    employee = { ...employee, staff_id: 8, staff_name: "다음 직원" };
    await rerender();
    assert.equal(requests.length, 3);
    await act(async () => { requests[2].resolve([{ ...row, staff_id: 8, turn: "CURRENT-TURN-202" }]); });
    await act(async () => { requests[1].resolve([row]); requests[0].resolve([]); });
    assert.match(container.textContent, /CURRENT-TURN-202/);
    assert.doesNotMatch(container.textContent, /TEST-TURN-101/);
  });
});
