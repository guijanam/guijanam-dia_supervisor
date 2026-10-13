import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith("@/") ? path.join(root, name.slice(2)) : name, ...args);
};
for (const ext of [".ts", ".tsx"]) {
  Module._extensions[ext] = (module, filename) => {
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
    });
    module._compile(outputText, filename);
  };
}
let response;
const selections = [];
require.cache[path.join(root, "lib/supabase.ts")] = { exports: { supabase: { from: (table) => {
  assert.equal(table, "app_settings");
  return { select: (columns) => { selections.push(columns); return { eq: () => ({ maybeSingle: async () => response }) }; } };
} } } };
require.cache[path.join(root, "lib/auth-context.tsx")] = { exports: { useAuth: () => ({ employee: { staff_name: "관리자" }, logout() {} }) } };
require.cache[path.join(root, "components/theme-toggle.tsx")] = { exports: { ThemeToggle: () => null } };
require.cache[path.join(root, "components/quarter-balance-calendar-modal.tsx")] = { exports: { QuarterBalanceCalendarModal: () => null } };
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { QuarterBalance } = require("../components/quarter-balance.tsx");

async function render(result, check) {
  response = result;
  selections.length = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(QuarterBalance))); });
    await check(container);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}

test("설정된 대상 년도·분기를 기본 선택하고 범위 밖 년도도 표시한다", async () => {
  await render({ data: { extra_request_year: 2040, extra_request_quarter: 2 }, error: null }, async (container) => {
    const [year, quarter] = container.querySelectorAll("select");
    assert.equal(year.value, "2040");
    assert.equal(quarter.value, "2");
    assert.ok(selections.every((columns) => columns === "extra_request_year, extra_request_quarter"));
    await act(async () => {
      quarter.value = "3";
      quarter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(quarter.value, "3", "관리자 수동 선택을 기본값으로 덮어쓰지 않는다");
  });
});

test("설정 미지정·잘못된 분기·조회 오류는 현재 년도와 분기를 유지한다", async () => {
  const now = new Date();
  for (const result of [
    { data: null, error: null },
    { data: { extra_request_year: 2040, extra_request_quarter: null }, error: null },
    { data: { extra_request_year: 2040, extra_request_quarter: 5 }, error: null },
    { data: { extra_request_year: -1, extra_request_quarter: 2 }, error: null },
    { data: { extra_request_year: 2040, extra_request_quarter: 2 }, error: new Error("조회 실패") },
  ]) {
    await render(result, (container) => {
      const [year, quarter] = container.querySelectorAll("select");
      assert.equal(year.value, String(now.getFullYear()));
      assert.equal(quarter.value, String(Math.floor(now.getMonth() / 3) + 1));
      assert.equal(year.disabled, false);
      assert.equal(quarter.disabled, false);
    });
  }
});

test("설정 로딩 중 잘못된 분기로 조회하지 않고 응답 후 선택이 활성화된다", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  await render(pending, async (container) => {
    const [year, quarter] = container.querySelectorAll("select");
    const query = [...container.querySelectorAll("button")].find((button) => button.textContent === "조회");
    assert.equal(year.disabled, true);
    assert.equal(quarter.disabled, true);
    assert.equal(query.disabled, true);
    await act(async () => { resolve({ data: { extra_request_year: 2040, extra_request_quarter: 4 }, error: null }); });
    assert.equal(year.value, "2040");
    assert.equal(quarter.value, "4");
    assert.equal(query.disabled, false);
  });
});

test("이전 화면의 늦은 설정 응답이 새 화면의 선택을 덮어쓰지 않는다", async () => {
  let resolve;
  await render(new Promise((done) => { resolve = done; }), () => {});
  await render({ data: { extra_request_year: 2030, extra_request_quarter: 1 }, error: null }, async (container) => {
    await act(async () => { resolve({ data: { extra_request_year: 2040, extra_request_quarter: 4 }, error: null }); });
    const [year, quarter] = container.querySelectorAll("select");
    assert.equal(year.value, "2030");
    assert.equal(quarter.value, "1");
  });
});
