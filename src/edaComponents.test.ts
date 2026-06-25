import assert from "node:assert/strict";
import { describe, it } from "node:test";

import hardwareData from "../srsim-supported-hardware.json";
import edaCatalogData from "./data/eda-yang-catalog.json";
import {
  buildEdaTopoNodeComponents,
  buildEdaTopoNodeObject,
  buildEdaTopoNodeYaml,
  defaultEdaVersion,
  edaComponentTypeOptions,
  edaConnectorBreakoutMode,
  edaConnectorCompatibility,
  edaConnectorTypeOptionsForMda,
  edaHasPowerProfileForChassis,
  edaPowerSlotsForChassis,
  edaPowerTypesForChassis,
  normalizeEdaConfig
} from "./edaComponents";
import { buildMatrix, defaultComponentsForEntry, defaultSfmForEntry, getEntry } from "./matrix";
import type { EdaYangCatalog, HardwareSchema, SrsimConfig } from "./types";

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

describe("EDA TopoNode export", () => {
  it("renders SR-2s defaults from appendix and generated catalog data", () => {
    const components = buildEdaTopoNodeComponents(defaultConfig("sr-2s"), catalog);

    assert.deepEqual(components.slice(0, 3), [
      { kind: "lineCard", slot: "1", type: "xcm-2s" },
      { kind: "fabric", slot: "1", type: "sfm-2s" },
      { kind: "mda", slot: "1-a", type: "s36-100gb-qsfp28" }
    ]);
    assert.equal(components.some((component) => component.kind === "powerShelf" || component.kind === "powerModule"), false);
    assert.equal(components.filter((component) => component.kind === "connector").length, 36);
    assert.ok(components.some((component) => component.kind === "connector" && component.slot === "1-a-36" && component.type === "c1-100g"));
    assert.equal(components.some((component) => component.kind === "controlCard"), false);
  });

  it("renders 400G MDA connectors with compatible breakout options", () => {
    const components = buildEdaTopoNodeComponents({
      chassis: "sr-2s",
      sfm: "sfm-2s",
      components: [
        {
          slot: 1,
          type: "xcm-2s",
          mda: [{ slot: 1, type: "s36-400gb-qsfpdd" }]
        }
      ]
    }, catalog);

    assert.equal(components.filter((component) => component.kind === "connector").length, 36);
    assert.ok(components.some((component) => component.kind === "connector" && component.slot === "1-a-7" && component.type === "c1-400g"));
    assert.deepEqual(edaConnectorTypeOptionsForMda(catalog, "s36-400gb-qsfpdd", 7), [
      "c1-400g",
      "c4-100g",
      "c1-400g-flex",
      "c1-400g-aui4",
      "c1-400g-aui4-flex"
    ]);
  });

  it("describes connector breakout impact", () => {
    assert.deepEqual(edaConnectorBreakoutMode("c4-100g"), {
      type: "c4-100g",
      channels: 4,
      speed: "100G",
      suffix: "",
      impact: "4 x 100G"
    });
    assert.deepEqual(edaConnectorBreakoutMode("c1-400g-flex"), {
      type: "c1-400g-flex",
      channels: 1,
      speed: "400G",
      suffix: "flex",
      impact: "1 x 400G"
    });
  });

  it("renders standalone SR-1s with line card, MDA, and connectors", () => {
    const components = buildEdaTopoNodeComponents(defaultConfig("sr-1s"), catalog);

    assert.ok(components.some((component) => component.kind === "lineCard" && component.slot === "1" && component.type === "xcm-1s"));
    assert.ok(components.some((component) => component.kind === "mda" && component.slot === "1-a" && component.type === "s36-100gb-qsfp28"));
    assert.equal(components.some((component) => component.kind === "powerShelf" || component.kind === "powerModule"), false);
    assert.equal(components.filter((component) => component.kind === "connector").length, 36);
  });

  it("splits combined clab CPM/IMM card values into EDA role types", () => {
    const components = buildEdaTopoNodeComponents(defaultConfig("sr-1se"), catalog);

    assert.ok(components.some((component) => component.kind === "controlCard" && component.slot === "A" && component.type === "cpm-1se"));
    assert.ok(components.some((component) => component.kind === "lineCard" && component.slot === "1" && component.type === "imm36-800g-qsfpdd"));
    assert.equal(components.some((component) => component.type === "cpm-1se/imm36-800g-qsfpdd"), false);
  });

  it("renders XIOM and XIOM MDA paths while preserving editable EDA extras", () => {
    const config = normalizeEdaConfig({
      labName: "srsim-lab",
      nodeName: "sros1",
      chassis: "sr-7s",
      sfm: "sfm-s",
      components: [
        { slot: "A", type: "cpm-s" },
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
      ],
      edaNamespace: "eda",
      edaNodeProfile: "",
      edaVersion: defaultEdaVersion,
      edaComponents: [{ kind: "powerShelf", slot: "1", type: "ps-a10-shelf-dc" }]
    }, catalog);

    assert.deepEqual(config.edaComponents, [
      { kind: "controlCard", slot: "A", type: "cpm-s" },
      { kind: "lineCard", slot: "1", type: "xcm-7s" },
      { kind: "fabric", slot: "1", type: "sfm-s" },
      { kind: "xiom", slot: "1-x1", type: "iom-s-1.5t" },
      { kind: "powerShelf", slot: "1", type: "ps-a10-shelf-dc" },
      { kind: "mda", slot: "1-x1-a", type: "ms2-400gb-qsfpdd+2-100gb-qsfp28" },
      { kind: "connector", slot: "1-x1-a-1", type: "c1-400g" },
      { kind: "connector", slot: "1-x1-a-2", type: "c1-400g" },
      { kind: "connector", slot: "1-x1-a-3", type: "c1-100g" },
      { kind: "connector", slot: "1-x1-a-4", type: "c1-100g" }
    ]);
  });

  it("preserves compatible edited connector breakout modes", () => {
    const config = normalizeEdaConfig({
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
      edaComponents: [{ kind: "connector", slot: "1-a-7", type: "c4-100g" }]
    }, catalog);

    assert.ok(config.edaComponents.some((component) => component.kind === "connector" && component.slot === "1-a-7" && component.type === "c4-100g"));
  });

  it("generates only connector types compatible with their parent MDA", () => {
    const config = defaultConfig("sr-2s");
    for (const component of config.edaComponents.filter((item) => item.kind === "connector")) {
      const compatibility = edaConnectorCompatibility(catalog, config.edaComponents, component.slot);
      assert.ok(compatibility.parentMda, `${component.slot} should have a parent MDA`);
      assert.ok(compatibility.options.includes(component.type), `${component.slot} ${component.type} should be compatible`);
    }
  });

  it("renders a full TopoNode resource", () => {
    const config = defaultConfig("sr-2s");
    const entry = getEntry(buildMatrix(hardware), "sr-2s");
    const object = buildEdaTopoNodeObject(config, entry);

    assert.equal(object.apiVersion, "core.eda.nokia.com/v1");
    assert.equal(object.kind, "TopoNode");
    assert.deepEqual(object.metadata, { name: "sros1", namespace: "eda" });
    assert.deepEqual((object.spec as Record<string, unknown>).platform, "7750 SR-2s");
    assert.deepEqual((object.spec as Record<string, unknown>).operatingSystem, "sros");
    assert.ok(Array.isArray((object.spec as Record<string, unknown>).component));
  });

  it("renders only the TopoNode resource", () => {
    const yaml = buildEdaTopoNodeYaml(defaultConfig("sr-2s"), getEntry(buildMatrix(hardware), "sr-2s"));

    assert.equal(yaml.includes("\n---\n"), false);
    assert.equal(yaml.includes("apiVersion: components.eda.nokia.com/v2"), false);
    assert.equal(yaml.includes("kind: Component"), false);
    assert.ok(yaml.includes("apiVersion: core.eda.nokia.com/v1"));
    assert.ok(yaml.includes("kind: TopoNode"));
  });

  it("uses the generated YANG catalog for EDA type selectors", () => {
    assert.ok(edaComponentTypeOptions(catalog, { kind: "powerShelf", slot: "1", type: "" }).includes("ps-a4-shelf-dc"));
    assert.ok(edaComponentTypeOptions(catalog, { kind: "powerModule", slot: "1-1", type: "" }).includes("ps-a-dc-6000"));
    assert.ok(edaComponentTypeOptions(catalog, { kind: "mda", slot: "1-x1-a", type: "" }).includes("ms2-400gb-qsfpdd+2-100gb-qsfp28"));
    assert.ok(edaComponentTypeOptions(catalog, { kind: "connector", slot: "1-a-1", type: "" }).includes("c1-400g"));
  });

  it("uses chassis power profiles when known and generic YANG suggestions otherwise", () => {
    const shelfModuleSlots = catalog.inventory_schema?.powerShelfPowerModule?.slots ?? [];

    assert.deepEqual(catalog.inventory_schema?.powerShelf?.slots, ["1", "2"]);
    assert.ok(shelfModuleSlots.includes("1-1"));
    assert.ok(shelfModuleSlots.includes("2-12"));

    assert.equal(edaHasPowerProfileForChassis(catalog, "sr-2se"), true);
    assert.deepEqual(edaPowerSlotsForChassis(catalog, "sr-2se", "powerShelf"), ["1"]);
    assert.deepEqual(edaPowerSlotsForChassis(catalog, "sr-2se", "powerModule"), ["1-1", "1-2", "1-3", "1-4"]);
    assert.ok(edaPowerTypesForChassis(catalog, "sr-2se", "powerShelf").includes("ps-a4-shelf-dc"));
    assert.equal(edaPowerTypesForChassis(catalog, "sr-2se", "powerShelf").includes("ps-a10-shelf-dc"), false);

    assert.equal(edaHasPowerProfileForChassis(catalog, "sr-1"), false);
    assert.deepEqual(edaPowerSlotsForChassis(catalog, "sr-1", "powerShelf"), ["1", "2"]);
    assert.ok(edaPowerSlotsForChassis(catalog, "sr-1", "powerModule").includes("2-12"));
    assert.ok(edaPowerTypesForChassis(catalog, "sr-1", "powerShelf").includes("ps-a10-shelf-dc"));
  });
});
