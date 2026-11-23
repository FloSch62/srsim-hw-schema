import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cardSlots,
  cpmCarriers,
  cpmSlots,
  fittingCarrier,
  hardwareIssues,
  integratedCard,
  iomMdaSlots,
  lineCardSlots,
  mdaSlotsFor,
  moduleSlots
} from "./hardwareModel";

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

test("SR-7s CPM adapters say which CPMs they hold and which slots they take", () => {
  const carriers = cpmCarriers("sr-7s");
  assert.deepEqual(
    carriers.map(({ type, cpmTypes, cpmSlots, blocksLineSlots }) => ({ type, cpmTypes, cpmSlots, blocksLineSlots })),
    [
      { type: "cma-7s", cpmTypes: ["cpm-s"], cpmSlots: ["A"], blocksLineSlots: [] },
      { type: "cma-7s-d", cpmTypes: ["cpm-s"], cpmSlots: ["A", "B"], blocksLineSlots: [6] },
      { type: "cma2-7s", cpmTypes: ["cpm2-s"], cpmSlots: ["A", "B"], blocksLineSlots: [] }
    ]
  );
  assert.deepEqual(cpmCarriers("sr-2s"), []);

  const cpms = [{ slot: "A", type: "cpm-s" }, { slot: "B", type: "cpm-s" }];
  assert.equal(fittingCarrier("sr-7s", cpms)?.type, "cma-7s-d");
  assert.equal(fittingCarrier("sr-7s", [...cpms, { slot: 6, type: "xcm-7s" }]), undefined);
  assert.equal(fittingCarrier("sr-7s", [{ slot: "A", type: "cpm2-s" }])?.type, "cma2-7s");
});
