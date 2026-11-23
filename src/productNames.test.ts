import assert from "node:assert/strict";
import test from "node:test";

import {
  chassisGroup,
  chassisGroupOrder,
  generationGroup,
  generationGroupOrder,
  groupOptions,
  productHelp,
  productHelpText,
  productName
} from "./productNames";

test("productHelp prefixes the Nokia name when it differs from the schema value", () => {
  assert.equal(productHelp("ess-12"), "7450 ESS-12: 10 IOM slots, modular chassis; dual SF/CPM support");
});

test("productHelp returns only the help text when the name equals the schema value", () => {
  assert.equal(productHelp("me6-100gb-qsfp28"), "6x 100G QSFP28 MDA-e-XP (E4)");
});

test("productHelp returns an empty string for values without vetted text", () => {
  assert.equal(productHelp("not-a-real-type"), "");
});

test("chassisGroup maps chassis to their Nokia product family", () => {
  assert.equal(chassisGroup("sr-7s"), "7750 SR-s");
  assert.equal(chassisGroup("sr-1-24d"), "7750 SR-x");
  assert.equal(chassisGroup("sr-12e"), "7750 SR");
  assert.equal(chassisGroup("sr-2e"), "7750 SR-e");
  assert.equal(chassisGroup("sr-a8"), "7750 SR-a");
  assert.equal(chassisGroup("dms-1-24d"), "Other");
  assert.equal(chassisGroup("ess-7"), "7450 ESS");
  assert.equal(chassisGroup("sar-hm"), "7705 SAR");
  assert.equal(chassisGroup("ixr-e"), "7250 IXR");
  assert.equal(chassisGroup("xrs-20"), "7950 XRS");
  assert.equal(chassisGroup("vsr-i"), "Other");
});

test("generationGroup puts E4 MDAs in FP4 and E5 MDAs in FP5", () => {
  assert.equal(generationGroup("me6-100gb-qsfp28"), "FP4 (E4)");
  assert.equal(generationGroup("m5e16-100g-sfp112"), "FP5 (E5)");
  assert.equal(generationGroup("iom2-se-3.0t"), "FP5 (E5)");
  assert.equal(generationGroup("x40-10g-sfp"), "FP3");
  assert.equal(generationGroup("me10-10gb-sfp+"), "Other");
});

test("chassisGroupOrder lists the 7750 product lines first, in Nokia order", () => {
  assert.deepEqual(chassisGroupOrder.slice(0, 5), ["7750 SR-s", "7750 SR-x", "7750 SR", "7750 SR-e", "7750 SR-a"]);
  assert.equal(chassisGroupOrder.at(-1), "Other");
});

test("generationGroupOrder lists the newest forwarding generation first", () => {
  assert.deepEqual(generationGroupOrder, ["FP5 (E5)", "FP4 (E4)", "FP3", "Other"]);
});

test("groupOptions sorts by group order, keeps order within groups, and skips single-group lists", () => {
  const group = (option: string) => option[0];
  assert.deepEqual(groupOptions(["b2", "a1", "c1", "b1", "a2"], group, ["a", "b"]), {
    options: ["a1", "a2", "b2", "b1", "c1"],
    grouped: true
  });
  assert.deepEqual(groupOptions(["a2", "a1"], group, ["a"]), { options: ["a2", "a1"], grouped: false });
  assert.deepEqual(groupOptions(["x"], undefined), { options: ["x"], grouped: false });
});

test("productName gives the product name without its family number", () => {
  assert.equal(productName("sr-7s"), "SR-7s");
  assert.equal(productName("dms-1-24d"), "DMS-1-24D");
  assert.equal(productName("ixr-e2sc"), "IXR-e2sc");
  assert.equal(productName("vsr-i"), "VSR-I");
  assert.equal(productName("unknown-chassis"), "unknown-chassis");
  assert.equal(productName("m-sfm5-12"), "SFM5-12");
  assert.equal(productName("cpm-ixr-e-gnss"), "CPM-IXR-e GNSS");
  assert.equal(productName("me6-100gb-qsfp28"), "me6-100gb-qsfp28");
  assert.equal(productHelpText("sr-7s"), productHelp("sr-7s").replace("7750 SR-7s: ", ""));
});
