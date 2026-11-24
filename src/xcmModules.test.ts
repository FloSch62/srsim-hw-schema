import assert from "node:assert/strict";
import { describe, it } from "node:test";

import hardwareData from "../srsim-supported-hardware.json";
import { buildMatrix, getEntry } from "./matrix";
import { chassisVariants } from "./hardwareModel";
import type { HardwareSchema } from "./types";
import {
  componentWithXcmModules,
  hasXcmModules,
  variantModule,
  xcmIomOptions,
  xcmModuleSlotOptions,
  xcmModulesFromComponent,
  xcmXmaOptions
} from "./xcmModules";

const matrix = buildMatrix(hardwareData as HardwareSchema);
const sr7s = getEntry(matrix, "sr-7s");
const xcm2 = { slot: 1, type: "xcm2-7s" };

describe("XCM modules", () => {
  it("uses module slots on XCMs and the SR-1s integrated card", () => {
    assert.equal(hasXcmModules(sr7s, xcm2), true);
    assert.equal(hasXcmModules(getEntry(matrix, "xrs-20"), { slot: 1, type: "xcm-x20" }), true);
    assert.equal(hasXcmModules(getEntry(matrix, "sr-1s"), { slot: "A", type: "cpm-1s" }), true);
    assert.equal(hasXcmModules(getEntry(matrix, "sr-1"), { slot: "A", type: "cpm-1" }), false);
    assert.equal(hasXcmModules(getEntry(matrix, "sr-7"), { slot: 1, type: "iom5-e" }), false);
  });

  it("offers the SR-1s integrated XMA-s or IOM-s in its one module slot", () => {
    const sr1s = getEntry(matrix, "sr-1s");
    const cpm = { slot: "A", type: "cpm-1s" };
    assert.deepEqual(xcmModuleSlotOptions(sr1s, cpm), [1]);
    assert.ok(xcmXmaOptions(sr1s, cpm, "").includes("s36-100gb-qsfp28"));
    assert.deepEqual(xcmIomOptions(sr1s, cpm, ""), ["iom-s-3.0t"]);
    const mda = [{ slot: 1, type: "ms16-100gb-sfpdd+4-100gb-qsfp28" }];
    assert.deepEqual(componentWithXcmModules(sr1s, cpm, [{ slot: 1, kind: "iom", type: "iom-s-3.0t", mda }], ""), {
      slot: "A",
      type: "cpm-1s",
      xiom: [{ slot: 1, type: "iom-s-3.0t", mda }]
    });
  });

  it("offers every XMA variant as an XMA and only real IOMs as IOMs", () => {
    assert.deepEqual(xcmXmaOptions(sr7s, xcm2, "sfm2-s"), [
      "x2-s36-400g-qsfp112-3.0t",
      "x2-s36-800g-qsfpdd-12.0t",
      "x2-s36-800g-qsfpdd-18.0t",
      "x2-s36-800g-qsfpdd-6.0t"
    ]);
    assert.deepEqual(xcmIomOptions(sr7s, xcm2, "sfm2-s"), ["iom2-se-3.0t", "iom2-se-6.0t"]);
  });

  it("offers only XMAs on an XRS XCM", () => {
    const xrs = getEntry(matrix, "xrs-20");
    const card = { slot: 1, type: "xcm-x20" };
    assert.deepEqual(xcmIomOptions(xrs, card, ""), []);
    assert.ok(xcmXmaOptions(xrs, card, "").includes("x40-10g-sfp"));
  });

  it("writes four/six-complex XMA2-s as card > mda", () => {
    const component = componentWithXcmModules(sr7s, xcm2, [{ slot: 1, kind: "xma", type: "x2-s36-800g-qsfpdd-18.0t", mda: [] }], "sfm2-s");
    assert.deepEqual(component, { slot: 1, type: "xcm2-7s", mda: [{ slot: 1, type: "x2-s36-800g-qsfpdd-18.0t" }] });
  });

  it("writes one/two-complex XMA2-s as card > xiom > mda with the virtual MDA", () => {
    const component = componentWithXcmModules(sr7s, xcm2, [{ slot: 1, kind: "xma", type: "x2-s36-800g-qsfpdd-6.0t", mda: [] }], "sfm2-s");
    assert.deepEqual(component, {
      slot: 1,
      type: "xcm2-7s",
      xiom: [{ slot: 1, type: "x2-s36-800g-qsfpdd-6.0t", mda: [{ slot: 1, type: "m36-800g-qsfpdd" }] }]
    });
  });

  it("writes an IOM with its MDAs as card > xiom > mda", () => {
    const mda = [{ slot: 1, type: "mse6-800g-qsfpdd" }];
    const component = componentWithXcmModules(sr7s, xcm2, [{ slot: 1, kind: "iom", type: "iom2-se-6.0t", mda }], "sfm2-s");
    assert.deepEqual(component, { slot: 1, type: "xcm2-7s", xiom: [{ slot: 1, type: "iom2-se-6.0t", mda }] });
  });

  it("reads both XMA hierarchies back as XMA modules", () => {
    const sr14s = getEntry(matrix, "sr-14s");
    const card = { slot: 1, type: "xcm2-14s" };
    const modules = [
      { slot: 1, kind: "xma" as const, type: "x2-s36-800g-qsfpdd-6.0t", mda: [] },
      { slot: 2, kind: "xma" as const, type: "x2-s36-800g-qsfpdd-18.0t", mda: [] }
    ];
    assert.deepEqual(xcmModulesFromComponent(componentWithXcmModules(sr14s, card, modules, "sfm2-s")), modules);
  });

  it("starts a product with the module it pins", () => {
    const [twoComplex, , modular] = chassisVariants("sr-1s");
    assert.deepEqual(variantModule(twoComplex), { slot: 1, kind: "xma", type: "s36-100gb-qsfp28", mda: [] });
    assert.deepEqual(variantModule(modular), { slot: 1, kind: "iom", type: "iom-s-3.0t", mda: [] });
    assert.equal(variantModule(chassisVariants("ixr-x")[0]), undefined);
  });

  it("numbers module slots from the XCM", () => {
    assert.deepEqual(xcmModuleSlotOptions(sr7s, xcm2), [1]);
    assert.deepEqual(xcmModuleSlotOptions(getEntry(matrix, "sr-14s"), { slot: 1, type: "xcm2-14s" }), [1, 2]);
    assert.deepEqual(xcmModuleSlotOptions(getEntry(matrix, "xrs-20"), { slot: 1, type: "xcm-x20" }), [1, 2]);
    assert.deepEqual(xcmModuleSlotOptions(getEntry(matrix, "sr-1s"), { slot: "A" }), [1]);
  });
});
