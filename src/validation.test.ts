import assert from "node:assert/strict";
import { describe, it } from "node:test";

import hardwareData from "../srsim-supported-hardware.json";
import {
  buildMatrix,
  componentFromMatrixRow,
  defaultComponentsForEntry,
  defaultImpliesFields,
  deploymentMode,
  fixedDistributedCpmTypeIsImplied,
  firstValue,
  getEntry,
  upsertComponentBySlot
} from "./matrix";
import { buildTopologyYaml } from "./topologyYaml";
import type { HardwareSchema } from "./types";
import { validateTopologyYaml } from "./validation";

const hardware = hardwareData as HardwareSchema;

const validConfig = {
  labName: "srsimtest",
  nodeName: "sros1",
  chassis: "sr-7s",
  sfm: "sfm-s",
  components: [
    { slot: "A", type: "cpm2-s" },
    {
      slot: 1,
      type: "xcm-7s",
      xiom: [
        {
          slot: 1,
          type: "iom-s-1.5t",
          mda: [{ slot: 1, type: "ms2-400gb-qsfpdd+2-100gb-qsfp28" }]
        }
      ]
    }
  ]
};

describe("topology validation", () => {
  it("writes distributed SFM explicitly while omitting default MDAs", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-7s");
    const distributed = deploymentMode(entry) === "distributed";
    const yaml = buildTopologyYaml(
      {
        labName: "srsimtest",
        nodeName: "sros1",
        chassis: "sr-7s",
        sfm: "sfm2-s",
        components: [
          { slot: "A", type: "cpm2-s" },
          { slot: 1, type: "xcm2-7s", mda: [{ slot: 1, type: "x2-s36-800g-qsfpdd-18.0t" }] }
        ]
      },
      {
        shouldWriteSfm: (component) => distributed && Boolean(component.slot),
        shouldWriteDirectMda: (component, mda) =>
          !defaultImpliesFields(entry, { ...component, mda: [mda] }, "sfm2-s", ["mda"])
      }
    );

    assert.equal(yaml.includes("slot: A\n          sfm: sfm2-s\n          type: cpm2-s"), true);
    assert.equal((yaml.match(/sfm: sfm2-s/g) ?? []).length, 2);
    assert.equal(yaml.includes("mda:"), false);
    assert.equal(validateTopologyYaml(yaml, hardware).valid, true);
  });

  it("writes fixed distributed slash-card chassis as slot-only CPM plus line-card MDA", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-1-92s");
    const distributed = deploymentMode(entry) === "distributed";
    const yaml = buildTopologyYaml(
      {
        labName: "srsim-lab",
        nodeName: "sros1",
        chassis: "sr-1-92s",
        sfm: "",
        components: defaultComponentsForEntry(entry)
      },
      {
        shouldWriteComponentSlot: (component) =>
          distributed || !defaultImpliesFields(entry, component, "", []),
        shouldWriteComponentType: (component) =>
          (distributed && !fixedDistributedCpmTypeIsImplied(entry, component)) ||
          !defaultImpliesFields(entry, component, "", []),
        shouldWriteSfm: (component) => distributed && Boolean(component.slot),
        shouldWriteDirectMda: (component, mda) =>
          !distributed || !defaultImpliesFields(entry, { ...component, mda: [mda] }, "", ["mda"])
      }
    );

    assert.equal(yaml.includes("type: cpm-1x/i80-200g-sfpdd+12-400g-qsfpdd-1"), false);
    assert.equal(yaml.includes("type: cpm-1x\n"), false);
    assert.equal(
      yaml.includes(
        "- slot: A\n        - slot: 1\n          type: i80-200g-sfpdd+12-400g-qsfpdd-1\n          mda:\n            - slot: 1\n              type: m80-200g-sfpdd+12-400g-qsfpdd-1"
      ),
      true
    );
    assert.equal(validateTopologyYaml(yaml, hardware).valid, true);
  });

  it("writes SR-1s as an integrated direct-MDA component", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-1s");
    const yaml = buildTopologyYaml({
      labName: "srsimtest",
      nodeName: "sros1",
      chassis: "sr-1s",
      sfm: "",
      components: defaultComponentsForEntry(entry)
    }, {
      shouldWriteComponentSlot: () => false,
      shouldWriteComponentType: () => false
    });

    assert.equal(yaml.includes("- mda:"), true);
    assert.equal(yaml.includes("type: cpm-1s"), false);
    assert.equal(yaml.includes("slot: 1\n          type: cpm-1s"), false);
    assert.equal(validateTopologyYaml(yaml, hardware).valid, true);
  });

  it("can include integrated default slot and CPM type in generated YAML", () => {
    const entry = getEntry(buildMatrix(hardware), "sar-mx");
    const config = {
      labName: "srsimtest",
      nodeName: "sros1",
      chassis: "sar-mx",
      sfm: "",
      components: defaultComponentsForEntry(entry)
    };
    const compactYaml = buildTopologyYaml(config, {
      shouldWriteComponentSlot: () => false,
      shouldWriteComponentType: () => false
    });
    const explicitYaml = buildTopologyYaml(config);

    assert.equal(compactYaml.includes("type: iom-sar-1x"), false);
    assert.equal(explicitYaml.includes("slot: A\n          type: iom-sar-1x"), true);
    assert.equal(validateTopologyYaml(compactYaml, hardware).valid, true);
    assert.equal(validateTopologyYaml(explicitYaml, hardware).valid, true);
  });

  it("validates SAR-Mx supported rows whose appendix chassis includes the 7705 prefix", () => {
    const report = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: sar-mx\n      components:\n        - slot: A\n          type: iom-sar-1x\n          mda:\n            - slot: 1\n              type: m4-rs232-rj45+4-c3794-sfp\n",
      hardware
    );

    assert.equal(report.valid, true);
  });

  it("validates a generated SR-SIM topology through schema and hardware checks", () => {
    const report = validateTopologyYaml(buildTopologyYaml(validConfig), hardware);

    assert.equal(report.valid, true);
    assert.deepEqual(report.issues, []);
  });

  it("keeps generated YAML valid when adding a slotless supported matrix row into a free slot", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-7s");
    assert.ok(entry);
    const supportedRow = entry.rows.find((row) =>
      row.source === "supported_hardware" &&
      row.values.card?.includes("xcm-7s-b") &&
      row.values.xiom?.includes("iom-s-1.5t") &&
      row.values.mda?.includes("ms24-10/100gb-sfpdd")
    );
    assert.ok(supportedRow);

    const defaults = defaultComponentsForEntry(entry);
    const component = componentFromMatrixRow(supportedRow, defaults, entry, "add");
    assert.ok(component);
    const yaml = buildTopologyYaml({
      labName: "srsimtest",
      nodeName: "sros1",
      chassis: "sr-7s",
      sfm: firstValue(supportedRow, "sfm"),
      components: upsertComponentBySlot(defaults, component)
    });

    assert.equal(yaml.includes("slot: 2"), true);
    assert.equal(validateTopologyYaml(yaml, hardware).valid, true);
  });

  it("keeps generated YAML valid when adding matrix rows repeatedly", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-7s");
    assert.ok(entry);
    const supportedRow = entry.rows.find((row) =>
      row.source === "supported_hardware" &&
      row.values.card?.includes("xcm-7s-b") &&
      row.values.xiom?.includes("iom-s-1.5t") &&
      row.values.mda?.includes("ms24-10/100gb-sfpdd")
    );
    assert.ok(supportedRow);

    const defaults = defaultComponentsForEntry(entry);
    const firstAdded = componentFromMatrixRow(supportedRow, defaults, entry, "add");
    assert.ok(firstAdded);
    const withFirst = upsertComponentBySlot(defaults, firstAdded);
    const secondAdded = componentFromMatrixRow(supportedRow, withFirst, entry, "add");
    assert.ok(secondAdded);
    const yaml = buildTopologyYaml({
      labName: "srsimtest",
      nodeName: "sros1",
      chassis: "sr-7s",
      sfm: firstValue(supportedRow, "sfm"),
      components: upsertComponentBySlot(withFirst, secondAdded)
    });

    assert.equal(yaml.includes("slot: 2"), true);
    assert.equal(yaml.includes("slot: 3"), true);
    assert.equal(validateTopologyYaml(yaml, hardware).valid, true);
  });

  it("keeps generated YAML valid when replacing a matrix row target", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-7s");
    assert.ok(entry);
    const supportedRow = entry.rows.find((row) =>
      row.source === "supported_hardware" &&
      row.values.card?.includes("xcm-7s-b") &&
      row.values.xiom?.includes("iom-s-1.5t") &&
      row.values.mda?.includes("ms24-10/100gb-sfpdd")
    );
    assert.ok(supportedRow);

    const defaults = defaultComponentsForEntry(entry);
    const replacement = componentFromMatrixRow(supportedRow, defaults, entry, "replace");
    assert.ok(replacement);
    const yaml = buildTopologyYaml({
      labName: "srsimtest",
      nodeName: "sros1",
      chassis: "sr-7s",
      sfm: firstValue(supportedRow, "sfm"),
      components: upsertComponentBySlot(defaults, replacement)
    });

    assert.equal(yaml.includes("slot: 1"), true);
    assert.equal(yaml.includes("slot: 2"), false);
    assert.equal(validateTopologyYaml(yaml, hardware).valid, true);
  });

  it("reports incompatible pasted SR-SIM hardware tuples", () => {
    const yaml = buildTopologyYaml({
      ...validConfig,
      components: [
        validConfig.components[0],
        {
          slot: 1,
          type: "xcm-7s",
          xiom: [{ slot: 1, type: "iom-s-1.5t", mda: [{ slot: 1, type: "not-a-real-mda" }] }]
        }
      ]
    });

    const report = validateTopologyYaml(yaml, hardware);

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.source === "hardware"));
  });

  it("requires SFM for non-default supported CPMs", () => {
    const invalid = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: sr-7s\n      components:\n        - slot: A\n          type: cpm-s\n        - slot: 1\n          sfm: sfm-s\n          type: xcm-7s\n          xiom:\n            - slot: 1\n              type: iom-s-1.5t\n              mda:\n                - slot: 1\n                  type: ms2-400gb-qsfpdd+2-100gb-qsfp28\n",
      hardware
    );
    const valid = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: sr-7s\n      components:\n        - slot: A\n          sfm: sfm-s\n          type: cpm-s\n        - slot: 1\n          sfm: sfm-s\n          type: xcm-7s\n          xiom:\n            - slot: 1\n              type: iom-s-1.5t\n              mda:\n                - slot: 1\n                  type: ms2-400gb-qsfpdd+2-100gb-qsfp28\n",
      hardware
    );

    assert.equal(invalid.valid, false);
    assert.equal(invalid.issues[0].message.startsWith("sros1[slot=A]:"), false);
    assert.equal(valid.valid, true);
  });

  it("rejects pasted SR-1s configs that model the CPM as a slot-1 line card", () => {
    const report = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: sr-1s\n      components:\n        - slot: 1\n          type: cpm-1s\n",
      hardware
    );

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.message.includes("standalone component slot")));
  });

  it("rejects incomplete and out-of-range distributed component lists", () => {
    const singleComponent = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: sr-7s\n      components:\n        - slot: 1\n          type: xcm2-7s\n",
      hardware
    );
    const outOfRange = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: sr-7s\n      components:\n        - slot: A\n          sfm: sfm2-s\n          type: cpm2-s\n        - slot: 99\n          sfm: sfm2-s\n          type: xcm2-7s\n",
      hardware
    );

    assert.equal(singleComponent.valid, false);
    assert.ok(singleComponent.issues.some((issue) => issue.message.includes("requires a CPM component slot")));
    assert.equal(outOfRange.valid, false);
    assert.ok(outOfRange.issues.some((issue) => issue.message.includes("slot must be between 1 and 7")));
  });

  it("rejects duplicate distributed component slots", () => {
    const report = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: ixr-x\n      components:\n        - slot: A\n          type: cpm-ixr-x\n        - slot: 1\n          type: imm32-qsfp28+4-qsfpdd\n        - slot: 1\n          type: imm6-qsfpdd+48-sfp56\n",
      hardware
    );

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.message.includes("duplicate component slot 1")));
  });

  it("enforces appendix MDA slot footnotes", () => {
    const report = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: ixr-r4\n      components:\n        - slot: A\n          type: cpm-ixr-r4\n        - slot: 1\n          type: iom-ixr-r4\n          mda:\n            - slot: 4\n              type: m20-1g-csfp\n",
      hardware
    );

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.message.includes("m20-1g-csfp must use MDA slot(s) 1, 2, 3")));
  });

  it("rejects direct MDA slots outside the matrix slot options", () => {
    const report = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: sr-1x-48d\n      components:\n        - slot: A\n        - slot: 1\n          type: i48-800g-qsfpdd-1x\n          mda:\n            - slot: 3\n              type: m48-800g-qsfpdd-1x\n",
      hardware
    );

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.message.includes("m48-800g-qsfpdd-1x must use MDA slot(s) 1, 2")));
  });

  it("rejects SR-1e direct MDA slots above the numbered default slots", () => {
    const report = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: sr-1e\n      components:\n        - slot: A\n          type: cpm-e\n        - slot: 1\n          type: iom-e\n          mda:\n            - slot: 5\n              type: isa2-aa\n",
      hardware
    );

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.message.includes("isa2-aa must use MDA slot(s) 4")));
  });

  it("rejects SR-1e direct MDA type and slot combinations outside numbered fields", () => {
    const report = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: sr-1e\n      components:\n        - slot: A\n          type: cpm-e\n        - slot: 1\n          type: iom-e\n          mda:\n            - slot: 1\n              type: isa2-aa\n",
      hardware
    );

    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.message.includes("isa2-aa must use MDA slot(s) 4")));
  });

  it("validates split IXR-e CPM and IMM values from slash-combined appendix rows", () => {
    const report = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: ixr-e\n      components:\n        - slot: A\n          type: cpm-ixr-e-gnss\n        - slot: 1\n          type: imm14-10g-sfp++4-1g-tx\n          mda:\n            - slot: 1\n              type: m14-10g-sfp++4-1g-tx\n",
      hardware
    );

    assert.equal(report.valid, true);
  });

  it("does not surface low-signal node branch schema errors", () => {
    const report = validateTopologyYaml(
      "name: srsim-lab\ntopology:\n  nodes:\n    sros1:\n      kind: nokia_srsim\n      type: sr-7s\n      components:\n        - slot: 1\n          type: xcm2-7s\n          mda:\n            - slot: 1\n              type: not-a-real-mda\n",
      hardware
    );

    assert.equal(report.valid, false);
    assert.equal(report.issues.some((issue) => issue.message === "must be null"), false);
    assert.equal(report.issues.some((issue) => issue.message.includes('must match "then" schema')), false);
  });


  it("reports YAML parser errors before schema validation", () => {
    const report = validateTopologyYaml("name: [", hardware);

    assert.equal(report.valid, false);
    assert.equal(report.issues[0].source, "yaml");
  });
});
