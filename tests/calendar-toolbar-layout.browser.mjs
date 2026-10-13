// Run with PLAYWRIGHT_MODULE=<playwright module path> node tests/calendar-toolbar-layout.browser.mjs
// Uses installed Chrome and the real toolbar JSX + application Tailwind CSS; no database access.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
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
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { renderToStaticMarkup } = require("react-dom/server");
const { Button } = require("../components/ui/button.tsx");
const icons = require("lucide-react");
const source = readFileSync(path.join(root, "components/admin-calendar.tsx"), "utf8");
const ast = ts.createSourceFile("admin-calendar.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const candidates = [];
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "div") {
    const text = node.getText(ast);
    if (text.includes("월간 근무표 엑셀 다운로드") && text.includes("{monthValue}")) candidates.push(text);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(candidates.length, "실제 관리자 달력 툴바를 찾아야 한다");
const toolbar = candidates.sort((a, b) => a.length - b.length)[0];
const transpiled = ts.transpileModule(`module.exports = (${toolbar});`, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
function markup(quarterInfo, bulkTargets) {
  const deps = { Button, ...icons, monthValue: "2027-03", quarterInfo, bulkTargets, exportBusy: false, quarterExportBusy: false, isLoading: false,
    shiftMonth() {}, exportTriggerRef: { current: null }, setExportTarget() {}, setBulkResult() {}, setBulkOpen() {} };
  const evaluatedModule = { exports: null };
  new Function("require", "module", "exports", ...Object.keys(deps), transpiled)(require, evaluatedModule, {}, ...Object.values(deps));
  return renderToStaticMarkup(evaluatedModule.exports);
}
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const { css } = await postcss([tailwind({ base: root })]).process(readFileSync(path.join(root, "app/globals.css"), "utf8"), {
  from: path.join(root, "app/globals.css"),
});
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
});
const failures = [];
let checked = 0;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  for (const quarter of [false, true]) {
    for (const bulk of [0, 3, 62]) {
      for (const width of [320, 360, 390, 480, 768, 1280]) {
        for (const fontSize of [16, 20, 24, 32]) {
          await page.setViewportSize({ width, height: 844 });
          await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${markup(quarter ? { year: 2027, quarter: 1 } : null, Array.from({ length: bulk }, () => ({})))}</body></html>`);
          await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
          const result = await page.evaluate(() => {
            const width = window.innerWidth;
            const month = [...document.querySelectorAll("span")].find((el) => el.textContent === "2027-03");
            const range = document.createRange();
            range.selectNodeContents(month);
            const outside = [...document.querySelectorAll("button, span")].filter((el) => {
              const rect = el.getBoundingClientRect();
              return rect.left < -1 || rect.right > width + 1 || el.scrollWidth > el.clientWidth + 1;
            }).map((el) => el.textContent.trim() || el.getAttribute("aria-label") || "arrow");
            return { viewport: width, scroll: document.documentElement.scrollWidth, lines: range.getClientRects().length, outside };
          });
          checked++;
          if (result.scroll > width + 1 || result.lines !== 1 || result.outside.length) {
            failures.push({ width, fontSize, quarter, bulk, ...result });
          }
          if (process.env.LAYOUT_SCREENSHOT && width === 360 && fontSize === 24 && quarter && bulk === 3) {
            mkdirSync(path.dirname(process.env.LAYOUT_SCREENSHOT), { recursive: true });
            await page.locator("body > div").screenshot({ path: process.env.LAYOUT_SCREENSHOT });
          }
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ checked, failures }, null, 2));
assert.equal(failures.length, 0, "월은 한 줄이고 모든 작업 버튼은 화면 안에 표시되어야 한다");
