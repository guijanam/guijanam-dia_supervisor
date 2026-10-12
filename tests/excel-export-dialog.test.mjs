import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const dom = new JSDOM("<!doctype html><html><head><style>* { animation-name: none; }</style></head><body></body></html>", { url: "http://localhost" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "HTMLInputElement"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
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
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
async function render(props, check) {
  const { ExcelExportDialog } = require("../components/excel-export-dialog.tsx");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(React.createElement(ExcelExportDialog, props)); });
    await check(document.querySelector('[role="dialog"]'));
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}
const button = (dialog, text) => [...dialog.querySelectorAll("button")].find((b) => b.textContent === text);
const defaults = { hideDayTurn: false, hideNightTurn: false, hideOriginalHolidayTurn: false };

test("다운로드 확인창의 기본은 모두 보임이고 확인해야 다운로드한다", async () => {
  const downloads = [];
  let closed = 0;
  await render({ title: "월간 근무표", onClose: () => { closed++; }, onDownload: async (options) => { downloads.push(options); } }, async (dialog) => {
    assert.ok(dialog);
    assert.ok(dialog.getAttribute("aria-labelledby"));
    assert.ok(dialog.getAttribute("aria-describedby"));
    const checks = [...dialog.querySelectorAll('input[type="checkbox"]')];
    assert.equal(checks.length, 3);
    assert.ok(checks.every((c) => !c.checked && c.labels.length));
    assert.deepEqual(downloads, []);
    await act(async () => { button(dialog, "다운로드").click(); });
    assert.deepEqual(downloads, [defaults]);
    assert.equal(closed, 1);
  });
});

test("각 안보임 선택은 독립적이고 다음 확인창에서는 기본값으로 돌아간다", async () => {
  for (const [index, key] of Object.keys(defaults).entries()) {
    let submitted;
    await render({ title: "분기 근무표", onClose() {}, onDownload: async (options) => { submitted = options; } }, async (dialog) => {
      const checks = dialog.querySelectorAll('input[type="checkbox"]');
      assert.ok([...checks].every((c) => !c.checked));
      await act(async () => { checks[index].click(); });
      await act(async () => { button(dialog, "다운로드").click(); });
      assert.deepEqual(submitted, { ...defaults, [key]: true });
    });
  }
});

test("취소와 ESC는 파일을 만들지 않는다", async () => {
  for (const escape of [false, true]) {
    let closed = 0;
    await render({ title: "월간 근무표", onClose: () => { closed++; }, onDownload: async () => { assert.fail("취소 시 다운로드 금지"); } }, async (dialog) => {
      await act(async () => {
        if (escape) document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else button(dialog, "취소").click();
      });
      assert.equal(closed, 1);
    });
  }
});

test("생성 중 중복 다운로드를 막고 실패 시 오류를 보여주며 재시도할 수 있다", async () => {
  let reject;
  let calls = 0;
  await render({ title: "월간 근무표", onClose() {}, onDownload: () => {
    calls++;
    return new Promise((_, fail) => { reject = fail; });
  } }, async (dialog) => {
    await act(async () => { button(dialog, "다운로드").click(); });
    assert.ok(dialog.querySelector('button[disabled]'));
    assert.ok([...dialog.querySelectorAll('input')].every((input) => input.disabled));
    assert.equal(calls, 1);
    await act(async () => { reject(new Error("엑셀 생성 실패")); });
    assert.match(dialog.querySelector('[role="alert"]').textContent, /엑셀 생성 실패/);
    assert.equal(button(dialog, "다운로드").disabled, false);
  });
});
