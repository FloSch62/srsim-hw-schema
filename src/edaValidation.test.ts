import assert from "node:assert/strict";
import { describe, it } from "node:test";

import hardwareData from "../srsim-supported-hardware.json";
import edaCatalogData from "./data/eda-yang-catalog.json";
import { buildEdaTopoNodeYaml, defaultEdaVersion, normalizeEdaConfig } from "./edaComponents";
import { buildMatrix, defaultComponentsForEntry, defaultSfmForEntry, getEntry } from "./matrix";
import type { EdaYangCatalog, HardwareSchema, SrsimConfig } from "./types";
import { validateEdaYaml } from "./edaValidation";

const hardware = hardwareData as HardwareSchema;
const catalog = edaCatalogData as EdaYangCatalog;

function defaultConfig(chassis: string): SrsimConfig {
  const entry = getEntry(buildMatrix(hardware), chassis);
  return normalizeEdaConfig({
    labName: "srsim-lab",
    nodeName: "sros1",
    chassis,
    sfm: defaultSfmForEntry(entry),
    components: defaultComponentsForEntry(entry),
    edaNamespace: "eda",
    edaNodeProfile: "",
    edaVersion: defaultEdaVersion,
    edaComponents: []
  }, catalog);
}

function sr2s400gConfig(): SrsimConfig {
  return normalizeEdaConfig({
    labName: "srsim-lab",
    nodeName: "sros1",
    chassis: "sr-2s",
    sfm: "sfm-2s",
    components: [
      {
        slot: 1,
        type: "xcm-2s",
        mda: [{ slot: 1, type: "s36-400gb-qsfpdd" }]
      }
    ],
    edaNamespace: "eda",
    edaNodeProfile: "",
    edaVersion: defaultEdaVersion,
    edaComponents: []
  }, catalog);
}

describe("EDA validation", () => {
  it("validates generated TopoNode resources", () => {
    const yaml = buildEdaTopoNodeYaml(defaultConfig("sr-2s"), getEntry(buildMatrix(hardware), "sr-2s"));
    const report = validateEdaYaml(yaml, hardware, catalog);

    assert.equal(report.valid, true);
    assert.deepEqual(report.issues, []);
  });

  it("validates generated SR-7s TopoNodes against the compatibility matrix", () => {
    const yaml = buildEdaTopoNodeYaml(defaultConfig("sr-7s"), getEntry(buildMatrix(hardware), "sr-7s"));
    const report = validateEdaYaml(yaml, hardware, catalog);

    assert.equal(report.valid, true);
    assert.deepEqual(report.issues, []);
  });

  it("validates generated SR-1se TopoNodes with split EDA card role types", () => {
    const yaml = buildEdaTopoNodeYaml(defaultConfig("sr-1se"), getEntry(buildMatrix(hardware), "sr-1se"));
    const report = validateEdaYaml(yaml, hardware, catalog);

    assert.equal(report.valid, true);
    assert.deepEqual(report.issues, []);
    assert.ok(yaml.includes("type: cpm-1se"));
    assert.ok(yaml.includes("type: imm36-800g-qsfpdd"));
    assert.equal(yaml.includes("type: cpm-1se/imm36-800g-qsfpdd"), false);
  });

  it("rejects EDA component types unsupported by the selected chassis matrix", () => {
    const yaml = buildEdaTopoNodeYaml(defaultConfig("sr-2s"), getEntry(buildMatrix(hardware), "sr-2s"))
      .replace("  component:\n", `  component:
    - kind: lineCard
      slot: "1"
      type: xcm-7s
    - kind: fabric
      slot: "1"
      type: sfm2-s
    - kind: xiom
      slot: 1-x1
      type: iom2-se-3.0t
    - kind: mda
      slot: 1-x1-a
      type: x2-s36-800g-qsfpdd-18.0t
`);
    const report = validateEdaYaml(yaml, hardware, catalog);
    const messages = report.issues.map((issue) => issue.message);

    assert.equal(report.valid, false);
    assert.ok(messages.some((message) => message.includes("xcm-7s is not supported for sr-2s lineCard")));
    assert.ok(messages.some((message) => message.includes("sfm2-s is not supported for sr-2s fabric")));
    assert.ok(messages.some((message) => message.includes("iom2-se-3.0t is not supported for sr-2s xiom")));
    assert.ok(messages.some((message) => message.includes("x2-s36-800g-qsfpdd-18.0t is not supported for sr-2s mda")));
  });

  it("rejects connector breakout types incompatible with the parent MDA", () => {
    const yaml = buildEdaTopoNodeYaml(sr2s400gConfig(), getEntry(buildMatrix(hardware), "sr-2s"))
      .replace(`    - kind: connector
      slot: 1-a-7
      type: c1-400g`, `    - kind: connector
      slot: 1-a-7
      type: c1-100g`);
    const report = validateEdaYaml(yaml, hardware, catalog);

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.message.includes("s36-400gb-qsfpdd connector 7 type must be")));
  });

  it("rejects connector slots without a configured parent MDA", () => {
    const yaml = buildEdaTopoNodeYaml(sr2s400gConfig(), getEntry(buildMatrix(hardware), "sr-2s"))
      .replace("  component:\n", `  component:
    - kind: connector
      slot: 1-b-1
      type: c1-400g
`);
    const report = validateEdaYaml(yaml, hardware, catalog);

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.message.includes("connector parent MDA slot 1-b is not configured")));
  });

  it("reports connector components without slots instead of throwing", () => {
    const yaml = buildEdaTopoNodeYaml(sr2s400gConfig(), getEntry(buildMatrix(hardware), "sr-2s"))
      .replace("  component:\n", `  component:
    - kind: connector
      type: c1-400g
`);
    const report = validateEdaYaml(yaml, hardware, catalog);

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) =>
      issue.path === "document 1/spec/component/0/slot" &&
      issue.message === "connector slot must be <mda-slot>-<connector-index>"
    ));
  });

  it("rejects Component CR documents", () => {
    const yaml = `${buildEdaTopoNodeYaml(defaultConfig("sr-2s"), getEntry(buildMatrix(hardware), "sr-2s"))}---
apiVersion: components.eda.nokia.com/v2
kind: Component
metadata:
  name: sros1-fantray-1
spec:
  node: sros1
  slot: "1"
  type: FanTray
`;
    const report = validateEdaYaml(yaml, hardware, catalog);

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.source === "schema" && issue.message.includes("unsupported EDA resource components.eda.nokia.com/v2/Component")));
  });

  it("rejects invalid EDA component schema and unsupported profiled power slots", () => {
    const yaml = buildEdaTopoNodeYaml(defaultConfig("sr-2s"), getEntry(buildMatrix(hardware), "sr-2s"))
      .replace("  component:\n", `  component:
    - kind: fanTray
      slot: "1"
      type: ps-a4-shelf-dc
    - kind: powerModule
      slot: 3-1
      type: ps-a-dc-6000
`);
    const report = validateEdaYaml(yaml, hardware, catalog);

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.source === "schema" && issue.message.includes("must be equal to one of the allowed values")));
    assert.ok(report.issues.some((issue) => issue.source === "hardware" && issue.message.includes("power module slot must be")));
  });

  it("allows free power inventory values when no chassis power profile is known", () => {
    const yaml = buildEdaTopoNodeYaml(defaultConfig("sr-1"), getEntry(buildMatrix(hardware), "sr-1"))
      .replace("  component:\n", `  component:
    - kind: powerShelf
      slot: custom-shelf
      type: custom-power-shelf
`);
    const report = validateEdaYaml(yaml, hardware, catalog);

    assert.equal(report.valid, true);
    assert.deepEqual(report.issues, []);
  });
});
