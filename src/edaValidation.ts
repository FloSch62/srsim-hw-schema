import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import YAML from "yaml";

import {
  edaCatalogDefaults,
  edaComponentTypeOptions,
  edaConnectorBreakoutTypes,
  edaConnectorCompatibility,
  edaHasPowerProfileForChassis,
  edaPowerSlotsForChassis,
  edaPowerTypesForChassis
} from "./edaComponents";
import { buildMatrix, clabChassisToken, rowCpmCards, rowLineCards, uniqueSorted } from "./matrix";
import type { EdaTopoNodeComponent, EdaTopoNodeComponentKind, EdaYangCatalog, HardwareSchema, MatrixEntry, ValidationIssue, ValidationReport } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const componentKinds = ["controlCard", "lineCard", "fabric", "mda", "connector", "xiom", "powerShelf", "powerModule"];

const topoNodeSchema = {
  type: "object",
  required: ["apiVersion", "kind", "metadata", "spec"],
  properties: {
    apiVersion: { const: "core.eda.nokia.com/v1" },
    kind: { const: "TopoNode" },
    metadata: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        namespace: { type: "string" }
      }
    },
    spec: {
      type: "object",
      required: ["nodeProfile", "operatingSystem", "platform", "version"],
      properties: {
        nodeProfile: { type: "string", minLength: 1 },
        operatingSystem: { enum: ["srl", "sros", "eos", "sonic", "ios-xr", "nxos"] },
        platform: { type: "string", minLength: 1 },
        version: { type: "string", minLength: 1 },
        component: {
          type: "array",
          items: {
            type: "object",
            required: ["kind", "type"],
            properties: {
              kind: { enum: componentKinds },
              slot: { type: "string" },
              type: { type: "string", minLength: 1 }
            }
          }
        }
      }
    }
  }
};

let topoNodeValidator: ValidateFunction | null = null;

function validateTopoNodeSchema(value: unknown): ErrorObject[] {
  if (!topoNodeValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    topoNodeValidator = ajv.compile(topoNodeSchema);
  }
  return topoNodeValidator(value) ? [] : [...(topoNodeValidator.errors ?? [])];
}

function formatAjvError(error: ErrorObject, docIndex: number): ValidationIssue {
  const path = error.instancePath || "/";
  const label = error.params && "missingProperty" in error.params
    ? `${path}/${String(error.params.missingProperty)}`
    : path;
  return {
    source: "schema",
    path: `document ${docIndex + 1}${label.replace(/\/+/g, "/")}`,
    message: error.message ?? `schema validation failed at ${label}`
  };
}

function entryForPlatform(schema: HardwareSchema, platform: string): MatrixEntry | undefined {
  const matrix = buildMatrix(schema);
  const token = clabChassisToken(platform);
  return matrix.find((entry) =>
    entry.chassis === token ||
    entry.models.some((model) => model.toLowerCase() === platform.toLowerCase())
  );
}

function validatePowerComponent(
  component: EdaTopoNodeComponent,
  entry: MatrixEntry,
  catalog: EdaYangCatalog,
  path: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const kind = component.kind as "powerShelf" | "powerModule";
  const label = kind === "powerShelf" ? "power shelf" : "power module";
  if (!edaHasPowerProfileForChassis(catalog, entry.chassis)) return issues;

  const slots = edaPowerSlotsForChassis(catalog, entry.chassis, kind);
  const types = edaPowerTypesForChassis(catalog, entry.chassis, kind);

  if (!slots.length) {
    issues.push({ source: "hardware", path, message: `${entry.chassis} has no supported EDA ${label} profile` });
  } else if (!slots.includes(component.slot)) {
    issues.push({ source: "hardware", path: `${path}/slot`, message: `${entry.chassis} ${label} slot must be ${slots.join(", ")}` });
  }

  if (types.length && !types.includes(component.type)) {
    issues.push({ source: "hardware", path: `${path}/type`, message: `${entry.chassis} ${label} type must be ${types.join(", ")}` });
  }

  return issues;
}

function rowMdaValues(entry: MatrixEntry): string[] {
  return uniqueSorted(entry.rows.flatMap((row) =>
    Object.entries(row.values)
      .filter(([field]) => field === "mda" || field.startsWith("mda_"))
      .flatMap(([, values]) => values)
  ));
}

function splitCombinedCardType(type: string): [string, string] | null {
  const index = type.indexOf("/");
  if (index === -1) return null;
  const controlCard = type.slice(0, index);
  const lineCard = type.slice(index + 1);
  return controlCard && lineCard ? [controlCard, lineCard] : null;
}

function combinedCardRoleTypes(entry: MatrixEntry, role: "controlCard" | "lineCard"): string[] {
  return entry.rows.flatMap((row) =>
    (row.values.card ?? []).flatMap((type) => {
      const parts = splitCombinedCardType(type);
      if (!parts) return [];
      return role === "controlCard" ? [parts[0]] : [parts[1]];
    })
  );
}

function matrixComponentTypeOptions(catalog: EdaYangCatalog, entry: MatrixEntry, kind: EdaTopoNodeComponentKind): string[] {
  if (kind === "controlCard") {
    return uniqueSorted([
      ...entry.rows.flatMap((row) => rowCpmCards(row, entry)),
      ...combinedCardRoleTypes(entry, "controlCard")
    ]);
  }
  if (kind === "lineCard") {
    const matrixTypes = [
      ...entry.rows.flatMap((row) => rowLineCards(row, entry)),
      ...combinedCardRoleTypes(entry, "lineCard")
    ];
    const catalogDefaults = edaCatalogDefaults(catalog, entry.chassis)
      .filter((component): component is EdaTopoNodeComponent => component.kind === "lineCard" && "slot" in component)
      .map((component) => component.type);
    return uniqueSorted([...matrixTypes, ...catalogDefaults]);
  }
  if (kind === "fabric") {
    return uniqueSorted(entry.rows.flatMap((row) => row.values.sfm ?? []));
  }
  if (kind === "xiom") {
    return uniqueSorted(entry.rows.flatMap((row) => row.values.xiom ?? []));
  }
  if (kind === "mda") {
    return rowMdaValues(entry);
  }
  return [];
}

function validateMatrixComponent(
  component: EdaTopoNodeComponent,
  entry: MatrixEntry,
  catalog: EdaYangCatalog,
  path: string
): ValidationIssue[] {
  const options = matrixComponentTypeOptions(catalog, entry, component.kind);
  if (!options.length || options.includes(component.type)) return [];
  return [{
    source: "hardware",
    path: `${path}/type`,
    message: `${component.type} is not supported for ${entry.chassis} ${component.kind}; supported types: ${options.join(", ")}`
  }];
}

function validateTopoNodeHardware(document: Record<string, unknown>, schema: HardwareSchema, catalog: EdaYangCatalog, docIndex: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const spec = asRecord(document.spec) ?? {};
  if (spec.operatingSystem !== "sros") return issues;

  const entry = entryForPlatform(schema, String(spec.platform ?? ""));
  if (!entry) {
    issues.push({
      source: "hardware",
      path: `document ${docIndex + 1}/spec/platform`,
      message: `unsupported SR-SIM platform ${String(spec.platform ?? "")}`
    });
    return issues;
  }

  const components = Array.isArray(spec.component) ? spec.component : [];
  components.forEach((item, index) => {
    const component = asRecord(item) as unknown as EdaTopoNodeComponent | null;
    if (!component) return;
    const path = `document ${docIndex + 1}/spec/component/${index}`;

    if (component.kind === "connector") {
      const globalConnectorTypes = edaConnectorBreakoutTypes(catalog);
      const compatibility = edaConnectorCompatibility(catalog, components as EdaTopoNodeComponent[], component.slot);

      if (!compatibility.validSlot) {
        issues.push({ source: "hardware", path: `${path}/slot`, message: "connector slot must be <mda-slot>-<connector-index>" });
      } else if (!compatibility.parentMda) {
        issues.push({ source: "hardware", path: `${path}/slot`, message: `connector parent MDA slot ${compatibility.parentSlot} is not configured` });
      } else if (compatibility.knownProfile && !compatibility.options.length) {
        issues.push({ source: "hardware", path: `${path}/slot`, message: `${compatibility.parentMda.type} has no connector ${compatibility.connectorIndex}` });
      } else if (compatibility.options.length && !compatibility.options.includes(component.type)) {
        issues.push({
          source: "hardware",
          path: `${path}/type`,
          message: `${compatibility.parentMda.type} connector ${compatibility.connectorIndex} type must be ${compatibility.options.join(", ")}`
        });
      } else if (!compatibility.knownProfile && globalConnectorTypes.length && !globalConnectorTypes.includes(component.type)) {
        issues.push({ source: "hardware", path: `${path}/type`, message: `connector type must be ${globalConnectorTypes.join(", ")}` });
      }
      return;
    }

    if (component.kind === "powerShelf" || component.kind === "powerModule") {
      issues.push(...validatePowerComponent(component, entry, catalog, path));
      return;
    }

    const options = edaComponentTypeOptions(catalog, component);
    if (options.length && !options.includes(component.type)) {
      issues.push({ source: "hardware", path: `${path}/type`, message: `${component.type} is not in the SR OS 26.3 YANG typedefs for ${component.kind}` });
      return;
    }
    issues.push(...validateMatrixComponent(component, entry, catalog, path));
  });
  return issues;
}

export function validateEdaYaml(yamlText: string, schema: HardwareSchema, catalog: EdaYangCatalog): ValidationReport {
  let docs: YAML.Document[];
  try {
    const parsed = YAML.parseAllDocuments(yamlText);
    docs = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return { valid: false, issues: [{ source: "yaml", message: error instanceof Error ? error.message : String(error) }] };
  }

  const issues: ValidationIssue[] = [];
  const values: Record<string, unknown>[] = [];
  docs.forEach((doc, index) => {
    if (doc.errors.length) {
      for (const error of doc.errors) {
        issues.push({ source: "yaml", path: `document ${index + 1}`, message: error.message });
      }
      return;
    }
    const value = asRecord(doc.toJSON());
    if (!value) {
      issues.push({ source: "schema", path: `document ${index + 1}`, message: "EDA YAML document must be an object" });
      return;
    }
    values.push(value);
  });

  values.forEach((value, index) => {
    if (value.apiVersion === "core.eda.nokia.com/v1" && value.kind === "TopoNode") {
      issues.push(...validateTopoNodeSchema(value).map((error) => formatAjvError(error, index)));
      issues.push(...validateTopoNodeHardware(value, schema, catalog, index));
      return;
    }

    issues.push({
      source: "schema",
      path: `document ${index + 1}`,
      message: `unsupported EDA resource ${String(value.apiVersion ?? "?")}/${String(value.kind ?? "?")}`
    });
  });

  if (!values.some((value) => value.apiVersion === "core.eda.nokia.com/v1" && value.kind === "TopoNode")) {
    issues.push({ source: "schema", message: "EDA YAML must include a TopoNode resource" });
  }

  return {
    valid: issues.length === 0,
    parsed: values,
    issues
  };
}
