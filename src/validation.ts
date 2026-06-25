import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import YAML from "yaml";

import clabSchemaData from "./data/clab.schema.json";
import srsimSchemaData from "./data/srsim-hw.schema.json";
import {
  buildMatrix,
  canonicalToken,
  clabChassisToken,
  cleanText,
  directMdaSlotOptions,
  deploymentMode,
  isEmptyValue,
  splitValues,
  xiomMdaSlotOptions
} from "./matrix";
import type {
  HardwareModelEntry,
  HardwareSchema,
  RawHardwareRecord,
  ValidationIssue,
  ValidationReport
} from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

let compiledValidator: ValidateFunction | null = null;

function clabValidator(): ValidateFunction {
  if (compiledValidator) return compiledValidator;

  const clabSchema = clabSchemaData as Record<string, unknown>;
  const clabDefinitions = asRecord(clabSchema.definitions) ?? {};
  const srsimSchema = structuredClone(srsimSchemaData) as Record<string, unknown>;
  const srsimDefinitions = asRecord(srsimSchema.definitions) ?? {};

  // The generated sidecar references the containerlab env definition locally.
  // Add it before compiling so browser validation can resolve every local ref.
  if (!("env" in srsimDefinitions) && "env" in clabDefinitions) {
    srsimDefinitions.env = clabDefinitions.env;
    srsimSchema.definitions = srsimDefinitions;
  }

  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    verbose: true
  });
  ajv.addSchema(srsimSchema);
  compiledValidator = ajv.compile(clabSchema);
  return compiledValidator;
}

function formatAjvError(error: ErrorObject): ValidationIssue {
  const path = error.instancePath || "/";
  const label = error.params && "missingProperty" in error.params
    ? `${path}/${String(error.params.missingProperty)}`
    : path;
  return {
    source: "schema",
    path: label.replace(/\/+/g, "/"),
    message: error.message ?? `schema validation failed at ${label}`
  };
}

function filterSchemaIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const filtered = issues.filter((issue) => {
    if (issue.path?.startsWith("/topology/nodes/") && issue.message === "must be null") {
      return false;
    }
    if (issue.path?.startsWith("/topology/nodes/") && issue.message.includes('must match "then" schema')) {
      return false;
    }
    return true;
  });
  return filtered.length ? filtered : issues;
}

function entryAliases(model: string, entry: HardwareModelEntry): string[] {
  const aliases = (entry.supported_values?.chassis ?? []).flatMap((value) => splitValues(value).map(clabChassisToken));
  if (aliases.length) return aliases;
  const rowAliases = [...(entry.default_layout ?? []), ...(entry.supported_hardware ?? [])]
    .flatMap((row) => row.chassis ? splitValues(row.chassis).map(clabChassisToken) : []);
  return rowAliases.length ? rowAliases : [clabChassisToken(model)];
}

function rowMatchesChassis(row: RawHardwareRecord, chassis: string): boolean {
  return !row.chassis || splitValues(row.chassis).map(clabChassisToken).includes(chassis);
}

function findChassisEntry(schema: HardwareSchema, chassis: string): [string, HardwareModelEntry] | null {
  const wanted = clabChassisToken(chassis);
  const models: string[] = [];
  const defaultLayout: RawHardwareRecord[] = [];
  const supportedHardware: RawHardwareRecord[] = [];

  for (const [name, entry] of Object.entries(schema.models ?? {})) {
    if (!entryAliases(name, entry).includes(wanted) && canonicalToken(name) !== canonicalToken(chassis)) continue;
    models.push(name);
    defaultLayout.push(...(entry.default_layout ?? []).filter((row) => rowMatchesChassis(row, wanted)));
    supportedHardware.push(...(entry.supported_hardware ?? []).filter((row) => rowMatchesChassis(row, wanted)));
  }

  if (!models.length) return null;
  return [
    models.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })).join(", "),
    {
      default_layout: defaultLayout,
      supported_hardware: supportedHardware,
      supported_values: { chassis: [wanted] }
    }
  ];
}

function recordMatchesTopology(record: RawHardwareRecord, criteria: Record<string, string>): boolean {
  for (const [field, expected] of Object.entries(criteria)) {
    if (!expected) continue;
    if (!(field in record) && field !== "mda") continue;
    let rawValues: string[];
    if (field === "mda") {
      rawValues = Object.entries(record)
        .filter(([key]) => key === "mda" || key.startsWith("mda_"))
        .flatMap(([, value]) => splitValues(value));
    } else if (field === "card") {
      rawValues = splitValues(record[field]).flatMap((value) => {
        const index = value.indexOf("/");
        if (index === -1) return [value];
        const cpm = value.slice(0, index);
        const lineCard = value.slice(index + 1);
        const normalizedCpm = canonicalToken(cpm);
        return normalizedCpm.startsWith("cpm") || normalizedCpm.startsWith("cpiom")
          ? [value, cpm, lineCard].filter(Boolean)
          : [value];
      });
    } else if (field === "chassis") {
      rawValues = splitValues(record[field]).map(clabChassisToken);
    } else {
      rawValues = splitValues(record[field]);
    }
    const values = new Set(rawValues.map(canonicalToken));
    if (!values.has(canonicalToken(expected))) return false;
  }
  return true;
}

function matchingRows(rows: RawHardwareRecord[] | undefined, criteria: Record<string, string>): RawHardwareRecord[] {
  return (rows ?? []).filter((row) => recordMatchesTopology(row, criteria));
}

function missingRequiredFields(matches: RawHardwareRecord[], criteria: Record<string, string>): Set<string> {
  const topologyFields = new Set(["card", "sfm", "xiom", "mda"]);
  const missing = new Set<string>();
  for (const row of matches) {
    for (const [field, value] of Object.entries(row)) {
      const targetField = field.startsWith("mda_") ? "mda" : field;
      if (!topologyFields.has(targetField) || targetField in criteria || isEmptyValue(value)) continue;
      missing.add(targetField);
    }
  }
  return missing;
}

function cleanCriteria(criteria: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(criteria)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, value]) => [key, cleanText(value)] as const)
      .filter(([, value]) => value.length > 0)
  );
}

function validateCriteria(params: {
  schema: HardwareSchema;
  nodeName: string;
  location: string;
  modelName: string;
  criteria: Record<string, string>;
  strict: boolean;
}): ValidationIssue[] {
  const { schema, nodeName, location, modelName, strict } = params;
  const modelMatch = findChassisEntry(schema, modelName);
  if (!modelMatch) {
    return [{ source: "hardware", message: `${nodeName}: model/chassis not found: ${modelName}` }];
  }

  const [, model] = modelMatch;
  const criteria = cleanCriteria(params.criteria);
  const supportedMatches = matchingRows(model.supported_hardware, criteria);
  const defaultMatches = matchingRows(model.default_layout, criteria);
  const matches = [...supportedMatches, ...defaultMatches];

  if (!matches.length) {
    return [
      {
        source: "hardware",
        path: location,
        message: `unsupported tuple ${JSON.stringify(criteria)}`
      }
    ];
  }

  if (strict && supportedMatches.length && !defaultMatches.length) {
    const missing = missingRequiredFields(supportedMatches, criteria);
    const matrixEntry = buildMatrix(schema).find((entry) => entry.chassis === clabChassisToken(modelName));
    if (["standalone", "integrated_redundant"].includes(deploymentMode(matrixEntry))) {
      missing.delete("card");
    }
    if (/^[A-Z]$/i.test(criteria.slot ?? "") && /^(?:cpm|cpiom)/.test(canonicalToken(criteria.card ?? ""))) {
      missing.delete("mda");
      missing.delete("xiom");
    }
    if (missing.size) {
      return [
        {
          source: "hardware",
          path: location,
          message: `missing required field(s): ${[...missing].sort().join(", ")}; tuple ${JSON.stringify(criteria)}`
        }
      ];
    }
  }

  return [];
}

function asList(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  throw new Error(`${label} expected list, got ${Array.isArray(value) ? "array" : typeof value}`);
}

function componentName(nodeName: string, slot: unknown): string {
  return `${nodeName}[slot=${slot === undefined || slot === null ? "?" : String(slot)}]`;
}

function numericSlot(slot: unknown): number | null {
  const value = Number(slot);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function validateNestedMdaSlot(params: {
  location: string;
  slot: unknown;
  type: unknown;
  allowedSlots: number[];
  seenSlots: Set<string>;
}): ValidationIssue[] {
  const { location, slot, type, allowedSlots, seenSlots } = params;
  const slotText = String(slot ?? "").trim();
  const issues: ValidationIssue[] = [];

  if (slotText) {
    if (seenSlots.has(slotText)) {
      issues.push({ source: "hardware", path: location, message: `duplicate MDA slot ${slotText}` });
    } else {
      seenSlots.add(slotText);
    }
  }

  const slotNumber = numericSlot(slot);
  if (slotNumber !== null && allowedSlots.length && !allowedSlots.includes(slotNumber)) {
    const label = String(type ?? "MDA");
    issues.push({ source: "hardware", path: location, message: `${label} must use MDA slot(s) ${allowedSlots.join(", ")}` });
  }

  return issues;
}

function validateComponent(params: {
  schema: HardwareSchema;
  nodeName: string;
  chassis: string;
  component: Record<string, unknown>;
  strict: boolean;
}): ValidationIssue[] {
  const { schema, nodeName, chassis, component, strict } = params;
  const slot = component.slot;
  const location = componentName(nodeName, slot);
  const base = {
    chassis,
    slot: slot === undefined || slot === null ? "" : String(slot),
    sfm: String(component.sfm ?? ""),
    card: String(component.type ?? "")
  };
  const matrixEntry = buildMatrix(schema).find((entry) => entry.chassis === clabChassisToken(chassis));
  const baseComponent = { slot: component.slot as string | number | undefined, type: String(component.type ?? "") };

  let xioms: unknown[];
  let mdas: unknown[];
  try {
    xioms = asList(component.xiom, "XIOM");
    mdas = asList(component.mda, "MDA");
  } catch (error) {
    return [{ source: "hardware", path: location, message: (error as Error).message }];
  }

  if (!xioms.length && !mdas.length) {
    return validateCriteria({ schema, nodeName, location, modelName: chassis, criteria: base, strict });
  }

  const issues: ValidationIssue[] = [];
  const seenDirectMdaSlots = new Set<string>();
  for (const mda of mdas) {
    const mdaRecord = asRecord(mda);
    if (!mdaRecord) {
      issues.push({ source: "hardware", path: location, message: "MDA entries must be mappings" });
      continue;
    }
    const mdaLocation = `${location}.mda[${String(mdaRecord.slot ?? "?")}]`;
    issues.push(
      ...validateNestedMdaSlot({
        location: mdaLocation,
        slot: mdaRecord.slot,
        type: mdaRecord.type,
        allowedSlots: directMdaSlotOptions(matrixEntry, baseComponent, base.sfm, 2, 1, String(mdaRecord.type ?? "")),
        seenSlots: seenDirectMdaSlots
      })
    );
    issues.push(
      ...validateCriteria({
        schema,
        nodeName,
        location: mdaLocation,
        modelName: chassis,
        criteria: { ...base, mda: String(mdaRecord.type ?? ""), _mda_slot: String(mdaRecord.slot ?? "") },
        strict
      })
    );
  }

  for (const xiom of xioms) {
    const xiomRecord = asRecord(xiom);
    if (!xiomRecord) {
      issues.push({ source: "hardware", path: location, message: "XIOM entries must be mappings" });
      continue;
    }

    let xiomMdas: unknown[];
    try {
      xiomMdas = asList(xiomRecord.mda, "mda");
    } catch (error) {
      issues.push({
        source: "hardware",
        path: `${location}.xiom[${String(xiomRecord.slot ?? "?")}]`,
        message: (error as Error).message
      });
      continue;
    }

    const xiomBase = { ...base, xiom: String(xiomRecord.type ?? "") };
    const xiomComponent = { slot: xiomRecord.slot as string | number | undefined, type: String(xiomRecord.type ?? "") };
    if (!xiomMdas.length) {
      issues.push(
        ...validateCriteria({
          schema,
          nodeName,
          location: `${location}.xiom[${String(xiomRecord.slot ?? "?")}]`,
          modelName: chassis,
          criteria: xiomBase,
          strict
        })
      );
      continue;
    }

    const seenXiomMdaSlots = new Set<string>();
    for (const mda of xiomMdas) {
      const mdaRecord = asRecord(mda);
      if (!mdaRecord) {
        issues.push({
          source: "hardware",
          path: `${location}.xiom[${String(xiomRecord.slot ?? "?")}]`,
          message: "MDA entries must be mappings"
        });
        continue;
      }
      const mdaLocation = `${location}.xiom[${String(xiomRecord.slot ?? "?")}].mda[${String(mdaRecord.slot ?? "?")}]`;
      issues.push(
        ...validateNestedMdaSlot({
          location: mdaLocation,
          slot: mdaRecord.slot,
          type: mdaRecord.type,
          allowedSlots: xiomMdaSlotOptions(matrixEntry, baseComponent, xiomComponent, base.sfm, 2, 1, String(mdaRecord.type ?? "")),
          seenSlots: seenXiomMdaSlots
        })
      );
      issues.push(
        ...validateCriteria({
          schema,
          nodeName,
          location: mdaLocation,
          modelName: chassis,
          criteria: { ...xiomBase, mda: String(mdaRecord.type ?? ""), _mda_slot: String(mdaRecord.slot ?? "") },
          strict
        })
      );
    }
  }

  return issues;
}

function inferredComponentSlotCount(chassis: string): number {
  const value = clabChassisToken(chassis);
  const srA = value.match(/^sr-a(\d+)$/);
  if (srA) return Number(srA[1]);
  const ixrR = value.match(/^ixr-r(\d+)/);
  if (ixrR) return Number(ixrR[1]);
  const modular = value.match(/^(?:ess|ixr|sr|xrs)-(\d+)(?:[a-z]*)$/);
  if (modular) return Number(modular[1]);
  return 1;
}

function validateComponentListShape(params: {
  schema: HardwareSchema;
  nodeName: string;
  chassis: string;
  components: unknown[];
}): ValidationIssue[] {
  const { schema, nodeName, chassis, components } = params;
  const matrixEntry = buildMatrix(schema).find((entry) => entry.chassis === clabChassisToken(chassis));
  const mode = deploymentMode(matrixEntry);
  const issues: ValidationIssue[] = [];
  const slotValue = (component: unknown) => {
    const record = asRecord(component);
    return record?.slot === undefined || record.slot === null ? "" : String(record.slot).trim();
  };
  const slots = components.map(slotValue);
  const alphaSlots = slots.filter((slot) => /^[A-Z]$/i.test(slot));
  const numericSlots = slots.filter((slot) => /^\d+$/.test(slot));
  const seenSlots = new Set<string>();
  for (const slot of slots) {
    if (!slot) continue;
    const key = slot.toUpperCase();
    if (seenSlots.has(key)) {
      issues.push({ source: "hardware", path: componentName(nodeName, slot), message: `duplicate component slot ${slot}` });
    } else {
      seenSlots.add(key);
    }
  }

  if (mode === "standalone") {
    if (components.length > 1) {
      issues.push({ source: "hardware", message: `${nodeName}: standalone SR-SIM chassis ${chassis} accepts at most one component override` });
    }
    for (const component of components) {
      const record = asRecord(component);
      const slot = slotValue(component);
      if (slot && slot.toUpperCase() !== "A") {
        issues.push({ source: "hardware", path: componentName(nodeName, slot), message: "standalone component slot must be omitted or A" });
      }
      if (record?.sfm) {
        issues.push({ source: "hardware", path: componentName(nodeName, slot), message: "standalone component must not set sfm" });
      }
      if (record?.xiom) {
        issues.push({ source: "hardware", path: componentName(nodeName, slot), message: "standalone component must not set xiom" });
      }
    }
    return issues;
  }

  if (mode === "integrated_redundant") {
    if (components.length > 2) {
      issues.push({ source: "hardware", message: `${nodeName}: ${chassis} accepts at most two redundant integrated components` });
    }
    for (const component of components) {
      const slot = slotValue(component);
      if (slot && !["A", "B"].includes(slot.toUpperCase())) {
        issues.push({ source: "hardware", path: componentName(nodeName, slot), message: "redundant integrated component slot must be A or B" });
      }
    }
    return issues;
  }

  if (components.length && components.length < 2) {
    issues.push({ source: "hardware", message: `${nodeName}: distributed SR-SIM chassis ${chassis} requires at least two components` });
  }
  if (components.length && !alphaSlots.length) {
    issues.push({ source: "hardware", message: `${nodeName}: distributed SR-SIM chassis ${chassis} requires a CPM component slot` });
  }
  if (components.length && !numericSlots.length) {
    issues.push({ source: "hardware", message: `${nodeName}: distributed SR-SIM chassis ${chassis} requires a numeric line-card component slot` });
  }
  const maxSlot = inferredComponentSlotCount(chassis);
  for (const slot of numericSlots) {
    const slotNumber = Number(slot);
    if (slotNumber < 1 || slotNumber > maxSlot) {
      issues.push({ source: "hardware", path: componentName(nodeName, slot), message: `slot must be between 1 and ${maxSlot}` });
    }
  }
  for (const [index, component] of components.entries()) {
    if (asRecord(component) && !slots[index]) {
      issues.push({ source: "hardware", path: componentName(nodeName, slots[index]), message: "distributed components require a slot" });
    }
  }
  return issues;
}

export function validateSrsimHardware(topology: unknown, schema: HardwareSchema, strict = true): ValidationIssue[] {
  const root = asRecord(topology);
  const topologyRecord = root ? asRecord(root.topology) : null;
  const nodes = topologyRecord ? asRecord(topologyRecord.nodes) : null;
  if (!nodes) {
    return [{ source: "hardware", path: "/topology/nodes", message: "expected topology.nodes mapping" }];
  }

  const issues: ValidationIssue[] = [];
  for (const [nodeName, nodeValue] of Object.entries(nodes)) {
    const node = asRecord(nodeValue);
    if (!node || node.kind !== "nokia_srsim") continue;

    if (!("components" in node)) continue;
    const chassis = String(node.type ?? "");
    if (!chassis) {
      issues.push({
        source: "hardware",
        path: `/topology/nodes/${nodeName}/type`,
        message: `${nodeName}: nokia_srsim node with components requires a type/chassis`
      });
      continue;
    }

    let components: unknown[];
    try {
      components = asList(node.components, "components");
    } catch (error) {
      issues.push({
        source: "hardware",
        path: `/topology/nodes/${nodeName}/components`,
        message: `${nodeName}: ${(error as Error).message}`
      });
      continue;
    }

    issues.push(...validateComponentListShape({ schema, nodeName, chassis, components }));

    for (const component of components) {
      const componentRecord = asRecord(component);
      if (!componentRecord) {
        issues.push({
          source: "hardware",
          path: `/topology/nodes/${nodeName}/components`,
          message: `${nodeName}: component entries must be mappings`
        });
        continue;
      }
      issues.push(...validateComponent({ schema, nodeName, chassis, component: componentRecord, strict }));
    }
  }

  return issues;
}

export function validateTopologyYaml(yamlText: string, hardwareSchema: HardwareSchema): ValidationReport {
  const document = YAML.parseDocument(yamlText, { prettyErrors: true });
  if (document.errors.length) {
    const issues = document.errors.map((error) => ({
      source: "yaml" as const,
      message: error.message
    }));
    return { valid: false, issues };
  }

  const parsed = document.toJSON();
  const validate = clabValidator();
  const schemaValid = validate(parsed);
  const schemaIssues = schemaValid ? [] : filterSchemaIssues((validate.errors ?? []).map(formatAjvError));
  const hardwareIssues = validateSrsimHardware(parsed, hardwareSchema, true);
  const issues = [...schemaIssues, ...hardwareIssues];

  return {
    valid: issues.length === 0,
    parsed,
    issues
  };
}
