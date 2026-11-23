import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cardSlots, cpmSlots, hardwareIssues, integratedCard, iomMdaSlots, lineCardSlots, mdaSlotsFor, moduleSlots } from "./hardwareModel";

interface HardwareCase {
  name: string;
  chassis: string;
  components: unknown[];
  issues: Array<{ code: string; path: string }>;
}

const cases = JSON.parse(readFileSync(new URL("../tests/hardware-cases.json", import.meta.url), "utf-8")) as HardwareCase[];

for (const hardwareCase of cases) {
  test(`hardware case: ${hardwareCase.name}`, () => {
    const issues = hardwareIssues(hardwareCase.chassis, hardwareCase.components).map(({ code, path }) => ({ code, path }));
    assert.deepEqual(issues, hardwareCase.issues);
  });
}

test("slot lookups come from the model", () => {
  assert.deepEqual(lineCardSlots("sr-14s"), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(cpmSlots("ixr-6"), ["A", "B"]);
  assert.deepEqual(cpmSlots("ixr-e"), ["A"]);
  assert.deepEqual(cpmSlots("sr-7s"), []);
  assert.deepEqual(lineCardSlots("sr-1s"), []);
  assert.deepEqual(lineCardSlots("sr-7"), [1, 2, 3, 4, 5]);
  assert.deepEqual(lineCardSlots("ixr-e2"), []);
  assert.deepEqual(moduleSlots("xcm2-14s"), [1, 2]);
  assert.deepEqual(moduleSlots("cpm-1s"), [1]);
  assert.deepEqual(moduleSlots("iom5-e"), []);
  assert.deepEqual(iomMdaSlots("iom2-se-6.0t"), [1, 2]);
  assert.deepEqual(moduleSlots("x2-s36-400g-qsfp112-3.0t"), []);
  assert.deepEqual(cardSlots("x2-s36-400g-qsfp112-3.0t"), [1]);
  assert.deepEqual(cardSlots("cma-7s"), []);
  assert.deepEqual(mdaSlotsFor("x2-s36-400g-qsfp112-3.0t", "m36-400g-qsfp112"), [1]);
  assert.deepEqual(mdaSlotsFor("x2-s36-400g-qsfp112-3.0t", "m36-800g-qsfpdd"), []);
  assert.deepEqual(integratedCard("sr-1s"), "cpm-1s");
  assert.deepEqual(integratedCard("sr-7s"), "");
  assert.deepEqual(lineCardSlots("sr-1se"), [1]);
  assert.deepEqual(mdaSlotsFor("imm36-800g-qsfpdd", "ms36-800g-qsfpdd"), [1]);
});
