import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hardwareIssues, iomMdaSlots, lineCardSlots, moduleSlots } from "./hardwareModel";

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
  assert.deepEqual(lineCardSlots("sr-1s"), []);
  assert.deepEqual(lineCardSlots("sr-7"), []);
  assert.deepEqual(moduleSlots("xcm2-14s"), [1, 2]);
  assert.deepEqual(moduleSlots("cpm-1s"), [1]);
  assert.deepEqual(moduleSlots("iom5-e"), []);
  assert.deepEqual(iomMdaSlots("iom2-se-6.0t"), [1, 2]);
});
