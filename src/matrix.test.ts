import assert from "node:assert/strict";
import { describe, it } from "node:test";

import hardwareData from "../srsim-supported-hardware.json";
import {
  buildMatrix,
  componentCardSlotOptions,
  componentCompatibleWithSfm,
  componentFromMatrixRow,
  componentCpmSlotOptions,
  componentTypeOptions,
  cpmOptions,
  availableNumericSlotOptions,
  defaultImpliesFields,
  defaultComponentsForEntry,
  defaultSfmForEntry,
  deploymentMode,
  directMdaSlotOptions,
  directMdaOptions,
  getEntry,
  mdaOptions,
  schemaNumericSlotOptions,
  sfmOptions,
  upsertComponentBySlot,
  xiomMdaOptions,
  xiomOptions
} from "./matrix";
import type { HardwareSchema } from "./types";

const hardware = hardwareData as HardwareSchema;

describe("SR-SIM matrix helpers", () => {
  it("normalizes Nokia model rows into clab chassis aliases", () => {
    const matrix = buildMatrix(hardware);
    const sr7s = getEntry(matrix, "sr-7s");

    assert.ok(sr7s);
    assert.equal(sr7s.chassis, "sr-7s");
    assert.ok(sr7s.models.includes("7750 SR-7s"));
  });

  it("builds default components and compatible option lists", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-7s");
    const components = defaultComponentsForEntry(entry);
    const lineCard = components.find((component) => component.slot === 1 || component.slot === "1");
    const blankLineCard = { slot: 1 };

    assert.ok(components.some((component) => component.slot === "A"));
    assert.ok(lineCard);
    assert.ok(cpmOptions(entry, "").includes("cpm2-s"));
    assert.ok(componentTypeOptions(entry, blankLineCard, "sfm-s").includes("xcm-7s"));
    assert.ok(sfmOptions(entry, []).includes("sfm-s"));
    assert.deepEqual(sfmOptions(entry, [{ slot: "A", type: "cpm-s" }]), ["sfm-s"]);
    assert.ok(sfmOptions(entry, components).includes("sfm2-s"));
    assert.equal(defaultSfmForEntry(entry), "sfm2-s");
    assert.ok(xiomOptions(entry, { ...blankLineCard, type: "xcm-7s" }, "sfm-s").includes("iom-s-1.5t"));
    assert.ok(
      xiomMdaOptions(entry, { ...blankLineCard, type: "xcm-7s" }, { slot: 1, type: "iom-s-1.5t" }, "sfm-s").includes(
        "ms2-400gb-qsfpdd+2-100gb-qsfp28"
      )
    );
  });

  it("keeps IXR-X defaults to one component per top-level slot", () => {
    const entry = getEntry(buildMatrix(hardware), "ixr-x");
    const defaults = defaultComponentsForEntry(entry);

    assert.deepEqual(defaults.map((component) => String(component.slot).toUpperCase()).sort(), ["1", "A"]);
    assert.ok(defaults.some((component) => component.slot === "1" && component.type === "imm32-qsfp28+4-qsfpdd"));
    assert.equal(defaults.some((component) => component.type === "imm6-qsfpdd+48-sfp56"), false);
    assert.ok(componentTypeOptions(entry, { slot: 1 }, "").includes("imm6-qsfpdd+48-sfp56"));
  });

  it("builds default components with unique top-level slots for every chassis", () => {
    for (const entry of buildMatrix(hardware)) {
      const slots = defaultComponentsForEntry(entry)
        .map((component) => String(component.slot ?? "").trim().toUpperCase())
        .filter(Boolean);
      assert.equal(new Set(slots).size, slots.length, `${entry.chassis} default components contain duplicate slots`);
    }
  });

  it("separates direct MDA and XIOM MDA option dependencies", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-7s");
    const xcm = { slot: 1, type: "xcm-7s" };
    const xcm2 = { slot: 1, type: "xcm2-7s" };

    assert.equal(directMdaOptions(entry, xcm, "sfm-s").includes("ms2-400gb-qsfpdd+2-100gb-qsfp28"), false);
    assert.ok(xiomMdaOptions(entry, xcm, { slot: 1, type: "iom-s-1.5t" }, "sfm-s").includes("ms2-400gb-qsfpdd+2-100gb-qsfp28"));
    assert.ok(directMdaOptions(entry, xcm2, "sfm2-s").includes("x2-s36-800g-qsfpdd-18.0t"));
    assert.equal(directMdaOptions(entry, xcm2, "sfm2-s").includes("ms2-400gb-qsfpdd+2-100gb-qsfp28"), false);
  });

  it("detects components that must be pruned when a matrix row changes SFM", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-7s");

    assert.equal(
      componentCompatibleWithSfm(
        entry,
        { slot: 1, type: "xcm2-7s", mda: [{ slot: 1, type: "x2-s36-800g-qsfpdd-18.0t" }] },
        "sfm-s"
      ),
      false
    );
    assert.equal(componentCompatibleWithSfm(entry, { slot: "A", type: "cpm2-s" }, "sfm-s"), true);
  });

  it("models integrated chassis as direct MDA systems, not line-card systems", () => {
    const matrix = buildMatrix(hardware);
    const sr1s = getEntry(matrix, "sr-1s");
    const sr1sDefaults = defaultComponentsForEntry(sr1s);

    assert.equal(deploymentMode(sr1s), "standalone");
    assert.deepEqual(sr1sDefaults, [{ slot: "A", type: "cpm-1s", mda: [{ slot: 1, type: "s36-100gb-qsfp28" }] }]);
    assert.deepEqual(componentTypeOptions(sr1s, { slot: 1 }, ""), []);
    assert.ok(mdaOptions(sr1s, sr1sDefaults[0], "").includes("s36-100gb-qsfp28"));
    assert.equal(mdaOptions(sr1s, sr1sDefaults[0], "").includes("ms24-10/100gb-sfpdd"), false);

    const ixrR6 = getEntry(matrix, "ixr-r6");
    assert.equal(deploymentMode(ixrR6), "integrated_redundant");
    assert.deepEqual(componentTypeOptions(ixrR6, { slot: 1 }, ""), []);
  });

  it("keeps integrated default CPM identity available for display and explicit YAML", () => {
    const entry = getEntry(buildMatrix(hardware), "sar-mx");

    assert.deepEqual(defaultComponentsForEntry(entry)[0], {
      slot: "A",
      type: "iom-sar-1x",
      mda: [
        { slot: 1, type: "m2-1g-sfp+2-10g-sfp+" },
        { slot: 2, type: "m4-1g-rj+6-10g-sfp++2-25g-sfp28" },
        { slot: 3, type: "isa-ms-v" },
        { slot: 4, type: "isa-ms-v" }
      ]
    });
  });

  it("does not add every supported MDA alternative as duplicate integrated MDA slots", () => {
    const entry = getEntry(buildMatrix(hardware), "sar-mx");
    const supportedRow = entry?.rows.find((row) =>
      row.source === "supported_hardware" &&
      row.values.mda?.includes("m4-rs232-rj45+4-c3794-sfp") &&
      row.values.mda?.includes("m8-t1e1-rj48")
    );
    assert.ok(supportedRow);

    assert.deepEqual(componentFromMatrixRow(supportedRow, defaultComponentsForEntry(entry), entry, "replace"), {
      slot: "A",
      type: "iom-sar-1x",
      mda: [{ slot: 1, type: "m2-1g-sfp+2-10g-sfp+" }]
    });
    assert.equal(componentFromMatrixRow(supportedRow, defaultComponentsForEntry(entry), entry, "add"), null);
  });

  it("preserves numbered MDA defaults from appendix mda_N columns", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-a4");
    const lineCard = defaultComponentsForEntry(entry).find((component) => component.slot === "1");

    assert.deepEqual(lineCard?.mda?.map((mda) => mda.slot), [1, 2, 3, 4]);
    assert.deepEqual(lineCard?.mda?.map((mda) => mda.type), [
      "maxp1-100gb-cfp",
      "ma44-1gb-csfp",
      "maxp10-10gb-sfp+",
      "ma2-10gb-sfp+12-1gb-sfp"
    ]);
  });

  it("does not duplicate default MDAs when a row has both mda and mda_N fields", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-2s");
    const lineCard = defaultComponentsForEntry(entry).find((component) => component.slot === "1");

    assert.deepEqual(lineCard?.mda, [{ slot: 1, type: "s36-100gb-qsfp28" }]);
  });

  it("splits slash-combined CPM and IMM card values for IXR-e roles", () => {
    const entry = getEntry(buildMatrix(hardware), "ixr-e");

    assert.ok(cpmOptions(entry, "").includes("cpm-ixr-e-gnss"));
    assert.ok(componentTypeOptions(entry, { slot: 1 }, "").includes("imm14-10g-sfp++4-1g-tx"));
    assert.equal(componentTypeOptions(entry, { slot: 1 }, "").includes("cpm-ixr-e-gnss/imm14-10g-sfp++4-1g-tx"), false);
  });

  it("knows which selected values are implied by the default layout", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-7s");

    assert.equal(defaultImpliesFields(entry, { slot: "A", type: "cpm2-s" }, "sfm2-s", ["sfm"]), true);
    assert.equal(defaultImpliesFields(entry, { slot: "A", type: "cpm-s" }, "sfm-s", ["sfm"]), false);
    assert.equal(
      defaultImpliesFields(
        entry,
        { slot: 1, type: "xcm2-7s", mda: [{ slot: 1, type: "x2-s36-800g-qsfpdd-18.0t" }] },
        "sfm2-s",
        ["mda"]
      ),
      true
    );
  });

  it("builds schema-compatible slot option lists for dropdowns", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-7s");

    assert.deepEqual(componentCpmSlotOptions(entry), ["A", "B"]);
    assert.deepEqual(componentCardSlotOptions(entry), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(schemaNumericSlotOptions([], 2), [1, 2]);
    assert.deepEqual(schemaNumericSlotOptions([{ slot: 5 }], 2), [1, 2, 3, 4, 5]);
  });

  it("builds bounded MDA slot option lists from matrix rows and footnotes", () => {
    const matrix = buildMatrix(hardware);
    const sr1x48d = getEntry(matrix, "sr-1x-48d");
    assert.deepEqual(
      directMdaSlotOptions(sr1x48d, { slot: 1, type: "cpm-1x/i48-800g-qsfpdd-1x" }, ""),
      [1, 2]
    );
    assert.deepEqual(availableNumericSlotOptions([1, 2], [{ slot: 1 }, { slot: 2 }]), []);

    const srA4 = getEntry(matrix, "sr-a4");
    const srA4LineCard = defaultComponentsForEntry(srA4).find((component) => component.slot === "1");
    assert.ok(srA4LineCard);
    assert.deepEqual(directMdaSlotOptions(srA4, srA4LineCard, ""), [1, 2, 3, 4]);
    assert.deepEqual(directMdaSlotOptions(srA4, srA4LineCard, "", 2, 1, "ma44-1gb-csfp"), [2]);

    const sr1e = getEntry(matrix, "sr-1e");
    assert.deepEqual(directMdaSlotOptions(sr1e, { slot: 1, type: "iom-e" }, ""), [1, 2, 3, 4]);
    assert.deepEqual(directMdaSlotOptions(sr1e, { slot: 1, type: "iom-e" }, "", 2, 1, "isa2-aa"), [4]);

    const ixrR4 = getEntry(matrix, "ixr-r4");
    assert.deepEqual(directMdaSlotOptions(ixrR4, { slot: 1, type: "iom-ixr-r4" }, "", 2, 1, "m20-1g-csfp"), [1, 2, 3]);
    assert.deepEqual(directMdaSlotOptions(ixrR4, { slot: 1, type: "iom-ixr-r4" }, "", 2, 1, "m10-1g-sfp+2-10g-sfp+"), [5]);
  });

  it("converts matrix rows into editor components", () => {
    const entry = getEntry(buildMatrix(hardware), "sr-7s");
    assert.ok(entry);

    const defaultCardRow = entry.rows.find((row) => row.source === "default_layout" && row.values.card?.includes("xcm2-7s"));
    assert.ok(defaultCardRow);
    assert.deepEqual(componentFromMatrixRow(defaultCardRow, [], entry, "add"), {
      slot: 1,
      type: "xcm2-7s",
      mda: [{ slot: 1, type: "x2-s36-800g-qsfpdd-18.0t" }]
    });
    assert.deepEqual(componentFromMatrixRow(defaultCardRow, [{ slot: 1, type: "xcm2-7s" }], entry, "add"), {
      slot: 2,
      type: "xcm2-7s",
      mda: [{ slot: 1, type: "x2-s36-800g-qsfpdd-18.0t" }]
    });

    const supportedCpmRow = entry.rows.find((row) => row.source === "supported_hardware" && row.values.card?.includes("cpm-s"));
    assert.ok(supportedCpmRow);
    assert.deepEqual(componentFromMatrixRow(supportedCpmRow, [{ slot: "A", type: "cpm2-s" }], entry, "replace"), {
      slot: "A",
      type: "cpm-s"
    });
    assert.deepEqual(componentFromMatrixRow(supportedCpmRow, [{ slot: "A", type: "cpm2-s" }], entry, "add"), {
      slot: "B",
      type: "cpm-s"
    });

    const supportedCardRow = entry.rows.find((row) =>
      row.source === "supported_hardware" &&
      row.values.card?.includes("xcm-7s") &&
      row.values.xiom?.includes("iom-s-1.5t") &&
      row.values.mda?.includes("ms2-400gb-qsfpdd+2-100gb-qsfp28")
    );
    assert.ok(supportedCardRow);
    assert.deepEqual(componentFromMatrixRow(supportedCardRow, [{ slot: 1, type: "xcm2-7s" }], entry, "add"), {
      slot: 2,
      type: "xcm-7s",
      xiom: [
        {
          slot: 1,
          type: "iom-s-1.5t",
          mda: [{ slot: 1, type: "ms2-400gb-qsfpdd+2-100gb-qsfp28" }]
        }
      ]
    });
    assert.deepEqual(componentFromMatrixRow(supportedCardRow, [{ slot: 1, type: "xcm2-7s" }], entry, "replace"), {
      slot: 1,
      type: "xcm-7s",
      xiom: [
        {
          slot: 1,
          type: "iom-s-1.5t",
          mda: [{ slot: 1, type: "ms2-400gb-qsfpdd+2-100gb-qsfp28" }]
        }
      ]
    });

    assert.equal(
      componentFromMatrixRow(
        supportedCardRow,
        [1, 2, 3, 4, 5, 6, 7].map((slot) => ({ slot, type: "xcm2-7s" })),
        entry,
        "add"
      ),
      null
    );

    assert.deepEqual(
      upsertComponentBySlot([{ slot: 1, type: "xcm2-7s" }], { slot: 1, type: "xcm-7s" }),
      [{ slot: 1, type: "xcm-7s" }]
    );
  });
});
