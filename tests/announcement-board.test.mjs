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
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };
}
let response;
require.cache[path.join(root, "lib/supabase.ts")] = {
  exports: { supabase: { from: () => ({ select: () => ({ order: () => ({ limit: async () => response }) }) }) } },
};
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { AnnouncementBoard } = require("../components/announcement-board.tsx");
const notice = { id: "notice-1", title: "필수 공지", content: "첫 번째 줄\n두 번째 줄", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };

async function render(result, check) {
  response = result;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(React.createElement(AnnouncementBoard)); });
    await check(container);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}

test.beforeEach(() => { window.localStorage.clear(); });

test("공지가 없으면 빈 팝업과 버튼을 표시하지 않는다", async () => {
  await render({ data: [], error: null }, (container) => {
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(container.textContent, "");
  });
});

test("조회 오류는 팝업 대신 안내한다", async () => {
  await render({ data: null, error: new Error("공지를 불러오지 못했습니다.") }, (container) => {
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.match(container.textContent, /공지를 불러오지 못했습니다/);
  });
});

test("공지 조회 후 자동 팝업, 닫기, 재열기 및 포커스 복원", async () => {
  await render({ data: [notice], error: null }, async (container) => {
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, "공지가 있으면 팝업이 자동으로 열려야 합니다");
    assert.match(dialog.textContent, /필수 공지/);
    assert.match(dialog.textContent, /첫 번째 줄\n두 번째 줄/);
    assert.ok(dialog.getAttribute("aria-labelledby"));
    assert.ok(dialog.getAttribute("aria-describedby"));
    const close = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "확인");
    assert.ok(close, "확인 버튼으로 닫을 수 있어야 합니다");
    await act(async () => { close.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.equal(document.querySelector('[role="dialog"]'), null);
    const trigger = [...container.querySelectorAll("button")].find((button) => button.textContent.includes("공지사항"));
    assert.ok(trigger);
    assert.equal(document.activeElement, trigger);
    await act(async () => { trigger.click(); });
    assert.ok(document.querySelector('[role="dialog"]'));
    await act(async () => { document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(document.querySelector('[role="dialog"]'), null);
  });
});

test("다시 보지 않기를 체크하면 재마운트 후 자동 팝업을 숨기고 수동으로 다시 볼 수 있다", async () => {
  await render({ data: [notice], error: null }, async () => {
    const checkbox = document.querySelector('input[type="checkbox"]');
    assert.ok(checkbox, "다시 보지 않기 체크박스가 있어야 합니다");
    assert.match(checkbox.labels[0].textContent, /다시 보지 않기/);
    await act(async () => { checkbox.click(); });
    assert.equal(checkbox.checked, true);
  });
  await render({ data: [notice], error: null }, async (container) => {
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await act(async () => { container.querySelector("button").click(); });
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.equal(document.querySelector('input[type="checkbox"]').checked, true);
  });
});

test("숨김 해제 후에는 자동 팝업을 다시 표시한다", async () => {
  await render({ data: [notice], error: null }, async () => {
    const checkbox = document.querySelector('input[type="checkbox"]');
    await act(async () => { checkbox.click(); });
    await act(async () => { checkbox.click(); });
    assert.equal(checkbox.checked, false);
  });
  await render({ data: [notice], error: null }, () => {
    assert.ok(document.querySelector('[role="dialog"]'));
  });
});

test("새 공지나 수정된 공지는 이전 숨김 설정과 관계없이 자동으로 표시한다", async () => {
  await render({ data: [notice], error: null }, async () => {
    await act(async () => { document.querySelector('input[type="checkbox"]').click(); });
  });
  for (const items of [
    [{ ...notice, updated_at: "2026-10-02T00:00:00Z" }],
    [notice, { ...notice, id: "notice-2" }],
  ]) {
    await render({ data: items, error: null }, () => {
      assert.ok(document.querySelector('[role="dialog"]'));
      assert.equal(document.querySelector('input[type="checkbox"]').checked, false);
    });
  }
});

test("브라우저 저장소가 차단되어도 공지 열람과 체크 조작이 가능하다", async () => {
  const prototype = Object.getPrototypeOf(window.localStorage);
  const getItem = prototype.getItem;
  const setItem = prototype.setItem;
  prototype.getItem = () => { throw new Error("Storage blocked"); };
  prototype.setItem = () => { throw new Error("Storage blocked"); };
  try {
    await render({ data: [notice], error: null }, async () => {
      assert.ok(document.querySelector('[role="dialog"]'));
      const checkbox = document.querySelector('input[type="checkbox"]');
      await act(async () => { checkbox.click(); });
      assert.equal(checkbox.checked, true);
    });
  } finally {
    prototype.getItem = getItem;
    prototype.setItem = setItem;
  }
});
