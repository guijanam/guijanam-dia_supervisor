import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { getJigeunBadgeLabel, getJigeunKind, isDesignatedJigeunDisplay } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const settings = { dayTurns: ["휴73"], nightTurns: ["휴71", "휴72"] };

test("야간 지정근무 휴72는 지(야)비로 표시하고 다른 배지는 유지한다", () => {
  assert.equal(getJigeunBadgeLabel(getJigeunKind("휴72", settings), "휴72"), "지(야)비");
  assert.equal(getJigeunBadgeLabel(getJigeunKind("휴71", settings), "휴71"), "지(야)");
  assert.equal(getJigeunBadgeLabel("night", "58"), "지(야)");
  assert.equal(getJigeunBadgeLabel("day", "휴72"), "지(주)");
  assert.equal(getJigeunBadgeLabel("night"), "지(야)");
  assert.equal(getJigeunKind("휴72", settings), "night");
  assert.equal(isDesignatedJigeunDisplay("휴72", settings), true);
  assert.equal(isDesignatedJigeunDisplay("휴72", { dayTurns: [], nightTurns: [] }), false);
});
