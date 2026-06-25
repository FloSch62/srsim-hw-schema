import YAML from "yaml";

import { clabChassisToken, isCpmSlot, uniqueSorted } from "./matrix";
import type {
  EdaCatalogComponentDefault,
  EdaConnectorGroup,
  EdaConnectorDefault,
  EdaPowerProfileEntry,
  EdaTopoNodeComponent,
  EdaTopoNodeComponentKind,
  EdaYangCatalog,
  MatrixEntry,
  SrsimComponent,
  SrsimConfig,
  SrsimMda,
  SrsimXiom
} from "./types";

export const defaultEdaNamespace = "eda";
export const defaultEdaVersion = "26.3.R1";

const kindOrder = new Map<EdaTopoNodeComponentKind, number>([
  ["controlCard", 0],
  ["lineCard", 1],
  ["fabric", 2],
  ["xiom", 3],
  ["powerShelf", 4],
  ["powerModule", 5],
  ["mda", 6],
  ["connector", 7]
]);

function isConnectorDefault(component: EdaCatalogComponentDefault): component is EdaConnectorDefault {
  return component.kind === "connector" && "count" in component;
}

function connectorProfileKey(mdaType: string): string {
  return mdaType.trim().toLowerCase();
}

export function edaCatalogDefaults(catalog: EdaYangCatalog, chassis: string): EdaCatalogComponentDefault[] {
  return catalog.toponode_component_defaults?.[clabChassisToken(chassis)]?.components ?? [];
}

function hasEdaCatalogDefaults(catalog: EdaYangCatalog, chassis: string): boolean {
  return edaCatalogDefaults(catalog, chassis).length > 0;
}

function normalizedSlot(slot: string | number | undefined): string {
  return String(slot ?? "").trim();
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function slotSortKey(slot: string): string {
  return slot
    .split(/([0-9]+)/)
    .map((part) => (/^\d+$/.test(part) ? part.padStart(8, "0") : part.toLowerCase()))
    .join("");
}

function mdaSlotSuffix(slot: string | number | undefined): string {
  const text = normalizedSlot(slot);
  const number = Number(text || 1);
  if (Number.isInteger(number) && number > 0 && number <= 26) {
    return String.fromCharCode("a".charCodeAt(0) + number - 1);
  }
  return text.toLowerCase() || "a";
}

function numericParentSlot(slot: string | number | undefined): string {
  const text = normalizedSlot(slot);
  if (/^\d+$/.test(text)) return String(Number(text));
  if (/^[A-Z]$/i.test(text)) {
    return String(text.toUpperCase().charCodeAt(0) - "A".charCodeAt(0) + 1);
  }
  return text || "1";
}

function componentSort(left: SrsimComponent, right: SrsimComponent): number {
  const leftSlot = normalizedSlot(left.slot);
  const rightSlot = normalizedSlot(right.slot);
  const leftCpm = isCpmSlot(left.slot);
  const rightCpm = isCpmSlot(right.slot);
  if (leftCpm !== rightCpm) return leftCpm ? -1 : 1;
  return leftSlot.localeCompare(rightSlot, undefined, { numeric: true, sensitivity: "base" });
}

function componentKey(component: EdaTopoNodeComponent): string {
  return `${component.kind}:${component.slot}`;
}

export function edaComponentSort(left: EdaTopoNodeComponent, right: EdaTopoNodeComponent): number {
  const leftKind = kindOrder.get(left.kind) ?? 99;
  const rightKind = kindOrder.get(right.kind) ?? 99;
  if (leftKind !== rightKind) return leftKind - rightKind;
  const slotCompare = slotSortKey(left.slot).localeCompare(slotSortKey(right.slot));
  if (slotCompare) return slotCompare;
  return left.type.localeCompare(right.type, undefined, { numeric: true, sensitivity: "base" });
}

function appendComponent(target: EdaTopoNodeComponent[], component: EdaTopoNodeComponent): void {
  if (!component.type || !component.slot) return;
  const key = `${component.kind}:${component.slot}`;
  if (!target.some((existing) => `${existing.kind}:${existing.slot}` === key)) {
    target.push(component);
  }
}

function splitCombinedCardType(type: string): [string, string] | null {
  const index = type.indexOf("/");
  if (index === -1) return null;
  const controlCard = type.slice(0, index);
  const lineCard = type.slice(index + 1);
  return controlCard && lineCard ? [controlCard, lineCard] : null;
}

function edaCardType(catalog: EdaYangCatalog, kind: "controlCard" | "lineCard", type: string): string {
  const options = edaComponentTypeOptions(catalog, { kind, slot: "", type: "" });
  if (options.includes(type)) return type;
  const parts = splitCombinedCardType(type);
  if (!parts) return type;
  const candidate = kind === "controlCard" ? parts[0] : parts[1];
  return options.includes(candidate) ? candidate : type;
}

function appendMda(target: EdaTopoNodeComponent[], parentSlot: string, mda: SrsimMda): void {
  if (!mda.type) return;
  appendComponent(target, {
    kind: "mda",
    slot: `${parentSlot}-${mdaSlotSuffix(mda.slot)}`,
    type: mda.type
  });
}

function appendXiom(target: EdaTopoNodeComponent[], parentSlot: string, xiom: SrsimXiom): void {
  const xiomSlot = normalizedSlot(xiom.slot) || "1";
  const edaXiomSlot = `${parentSlot}-x${xiomSlot}`;
  if (xiom.type) {
    appendComponent(target, {
      kind: "xiom",
      slot: edaXiomSlot,
      type: xiom.type
    });
  }
  for (const mda of xiom.mda ?? []) {
    appendMda(target, edaXiomSlot, mda);
  }
}

function configuredMdaSlots(components: EdaTopoNodeComponent[]): string[] {
  const slots = components
    .filter((component) => component.kind === "mda" && component.slot)
    .map((component) => component.slot);
  return slots.length ? slots : ["1-a"];
}

function appendCatalogDefaults(target: EdaTopoNodeComponent[], catalog: EdaYangCatalog, chassis: string): void {
  const entries = edaCatalogDefaults(catalog, chassis);
  const mdaSlots = configuredMdaSlots(target);
  for (const entry of entries) {
    if (isConnectorDefault(entry)) {
      if (!entry.type || !Number.isFinite(entry.count)) continue;
      for (const mdaSlot of mdaSlots) {
        for (let index = 1; index <= entry.count; index += 1) {
          appendComponent(target, { kind: "connector", slot: `${mdaSlot}-${index}`, type: entry.type });
        }
      }
      continue;
    }
    appendComponent(target, {
      kind: entry.kind,
      slot: entry.slot,
      type: entry.type
    });
  }
}

export function edaConnectorBreakoutTypes(catalog: EdaYangCatalog): string[] {
  return uniqueSorted(catalog.typedefs?.connector_breakout ?? []);
}

export function edaConnectorGroupsForMda(catalog: EdaYangCatalog, mdaType: string): EdaConnectorGroup[] {
  return catalog.toponode_connector_profiles?.[connectorProfileKey(mdaType)]?.connectors ?? [];
}

function connectorTypeOptionsForGroup(group: EdaConnectorGroup): string[] {
  return uniqueOrdered([group.defaultType, ...(group.types ?? [])]);
}

export function edaConnectorTypeOptionsForMda(catalog: EdaYangCatalog, mdaType: string, connectorIndex: number): string[] {
  let cursor = 1;
  for (const group of edaConnectorGroupsForMda(catalog, mdaType)) {
    const count = Number(group.count);
    if (!Number.isInteger(count) || count <= 0) continue;
    if (connectorIndex >= cursor && connectorIndex < cursor + count) {
      return connectorTypeOptionsForGroup(group);
    }
    cursor += count;
  }
  return [];
}

function normalizedConnectorSpeed(value: string): string {
  return value.replace(/g$/i, "G");
}

export interface EdaConnectorBreakoutMode {
  type: string;
  channels: number;
  speed: string;
  suffix: string;
  impact: string;
}

export function edaConnectorBreakoutMode(type: string): EdaConnectorBreakoutMode {
  const match = type.match(/^c(\d+)-(\d+g)(.*)$/i);
  const channels = match ? Number(match[1]) : 0;
  const speed = match ? normalizedConnectorSpeed(match[2]) : "";
  const suffix = match?.[3]?.replace(/^-/, "") ?? "";
  return {
    type,
    channels,
    speed,
    suffix,
    impact: channels && speed
      ? `${channels} x ${speed}`
      : "Unknown"
  };
}

export function edaConnectorBreakoutLabel(type: string): string {
  const mode = edaConnectorBreakoutMode(type);
  if (!mode.channels || !mode.speed) return type;
  return mode.suffix ? `${type} (${mode.impact}, ${mode.suffix})` : `${type} (${mode.impact})`;
}

export function edaConnectorParentSlot(slot: string): string {
  return slot.replace(/-\d+$/, "");
}

export function edaConnectorIndex(slot: string): number {
  const match = slot.match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export interface EdaConnectorCompatibility {
  parentSlot: string;
  connectorIndex: number;
  parentMda?: EdaTopoNodeComponent;
  options: string[];
  knownProfile: boolean;
  validSlot: boolean;
}

export function edaConnectorCompatibility(
  catalog: EdaYangCatalog,
  components: EdaTopoNodeComponent[],
  connectorSlot: string
): EdaConnectorCompatibility {
  const connectorIndex = edaConnectorIndex(connectorSlot);
  const parentSlot = edaConnectorParentSlot(connectorSlot);
  const parentMda = components.find((component) => component.kind === "mda" && component.slot === parentSlot);
  const groups = parentMda ? edaConnectorGroupsForMda(catalog, parentMda.type) : [];
  return {
    parentSlot,
    connectorIndex,
    parentMda,
    options: parentMda ? edaConnectorTypeOptionsForMda(catalog, parentMda.type, connectorIndex) : [],
    knownProfile: groups.length > 0,
    validSlot: connectorIndex > 0 && parentSlot !== connectorSlot
  };
}

function appendGeneratedConnectors(target: EdaTopoNodeComponent[], catalog: EdaYangCatalog): void {
  const mdas = [...target].filter((component) => component.kind === "mda" && component.slot && component.type);
  for (const mda of mdas) {
    let connectorIndex = 1;
    for (const group of edaConnectorGroupsForMda(catalog, mda.type)) {
      const count = Number(group.count);
      if (!Number.isInteger(count) || count <= 0) continue;
      const type = group.defaultType || group.types?.[0] || "";
      if (!type) continue;
      for (let index = 0; index < count; index += 1) {
        appendComponent(target, {
          kind: "connector",
          slot: `${mda.slot}-${connectorIndex}`,
          type
        });
        connectorIndex += 1;
      }
    }
  }
}

export function buildEdaTopoNodeComponents(
  config: Pick<SrsimConfig, "chassis" | "components" | "sfm">,
  catalog: EdaYangCatalog
): EdaTopoNodeComponent[] {
  const components: EdaTopoNodeComponent[] = [];
  const numericSlots = config.components
    .map((component) => normalizedSlot(component.slot))
    .filter((slot) => /^\d+$/.test(slot));
  const fabricSlot = numericSlots[0] || "1";
  const includeControlCards = !hasEdaCatalogDefaults(catalog, config.chassis);
  let wroteFabric = false;

  for (const component of [...config.components].sort(componentSort)) {
    const slot = normalizedSlot(component.slot);
    const parentSlot = numericParentSlot(component.slot);
    const cpm = isCpmSlot(component.slot);
    if (component.type && (!cpm || includeControlCards)) {
      const kind = cpm ? "controlCard" : "lineCard";
      appendComponent(components, {
        kind,
        slot: slot || parentSlot,
        type: edaCardType(catalog, kind, component.type)
      });
    }

    if (!cpm && config.sfm && !wroteFabric) {
      appendComponent(components, { kind: "fabric", slot: fabricSlot, type: config.sfm });
      wroteFabric = true;
    }

    for (const xiom of component.xiom ?? []) {
      appendXiom(components, parentSlot, xiom);
    }
    for (const mda of component.mda ?? []) {
      appendMda(components, parentSlot, mda);
    }
  }

  appendCatalogDefaults(components, catalog, config.chassis);
  appendGeneratedConnectors(components, catalog);
  return components.sort(edaComponentSort);
}

function isPowerComponent(component: EdaTopoNodeComponent): boolean {
  return component.kind === "powerShelf" || component.kind === "powerModule";
}

export function reconcileEdaComponents(
  config: Pick<SrsimConfig, "chassis" | "components" | "sfm">,
  catalog: EdaYangCatalog,
  existing: EdaTopoNodeComponent[] = [],
  options: { preservePower?: boolean } = {}
): EdaTopoNodeComponent[] {
  const defaults = buildEdaTopoNodeComponents(config, catalog).filter((component) =>
    options.preservePower ? !isPowerComponent(component) : true
  );
  const existingByKey = new Map(existing.map((component) => [componentKey(component), component]));
  const merged = defaults.map((component) => {
    const existingComponent = existingByKey.get(componentKey(component));
    if (!existingComponent) return component;
    if (component.kind !== "connector") return existingComponent;

    const compatibility = edaConnectorCompatibility(catalog, defaults, component.slot);
    if (compatibility.options.length && !compatibility.options.includes(existingComponent.type)) {
      return component;
    }
    return existingComponent;
  });
  const defaultKeys = new Set(defaults.map(componentKey));

  for (const component of existing) {
    if (!defaultKeys.has(componentKey(component)) && isPowerComponent(component)) {
      merged.push(component);
    }
  }

  return merged.filter((component) => component.kind && component.type).sort(edaComponentSort);
}

function safeKubernetesName(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return cleaned || "srsim-lab";
}

export function defaultEdaNodeProfile(labName: string, version = defaultEdaVersion): string {
  return `${safeKubernetesName(labName)}-sros-${version.toLowerCase()}`;
}

export function normalizeEdaConfig(config: SrsimConfig, catalog: EdaYangCatalog, previous?: SrsimConfig): SrsimConfig {
  const namespace = config.edaNamespace || previous?.edaNamespace || defaultEdaNamespace;
  const version = config.edaVersion || previous?.edaVersion || defaultEdaVersion;
  const nodeProfile = config.edaNodeProfile || previous?.edaNodeProfile || defaultEdaNodeProfile(config.labName, version);
  const existing = config.edaComponents ?? previous?.edaComponents;
  const preserveEdaInventory = Boolean(previous) && previous?.chassis === config.chassis && Boolean(config.edaComponents?.length);
  return {
    ...config,
    edaNamespace: namespace,
    edaVersion: version,
    edaNodeProfile: nodeProfile,
    edaComponents: reconcileEdaComponents(config, catalog, existing, { preservePower: preserveEdaInventory })
  };
}

function platformFromEntry(config: SrsimConfig, entry: MatrixEntry | undefined): string {
  return entry?.models[0] ?? config.chassis;
}

export function buildEdaTopoNodeObject(config: SrsimConfig, entry?: MatrixEntry): Record<string, unknown> {
  return {
    apiVersion: "core.eda.nokia.com/v1",
    kind: "TopoNode",
    metadata: {
      name: config.nodeName || "sros1",
      namespace: config.edaNamespace || defaultEdaNamespace
    },
    spec: {
      nodeProfile: config.edaNodeProfile || defaultEdaNodeProfile(config.labName, config.edaVersion || defaultEdaVersion),
      operatingSystem: "sros",
      platform: platformFromEntry(config, entry),
      version: config.edaVersion || defaultEdaVersion,
      component: [...config.edaComponents].sort(edaComponentSort)
    }
  };
}

export function buildEdaTopoNodeYaml(config: SrsimConfig, entry?: MatrixEntry): string {
  return YAML.stringify(buildEdaTopoNodeObject(config, entry), {
    lineWidth: 0,
    singleQuote: false
  }).trimEnd() + "\n";
}

export function edaComponentTypeOptions(catalog: EdaYangCatalog, component: EdaTopoNodeComponent): string[] {
  const typedefs = catalog.typedefs ?? {};
  if (component.kind === "controlCard") return typedefs.control_card ?? [];
  if (component.kind === "lineCard") return typedefs.card ?? [];
  if (component.kind === "fabric") return typedefs.fabric ?? [];
  if (component.kind === "xiom") return typedefs.xiom ?? [];
  if (component.kind === "powerShelf") return typedefs.power_shelf ?? [];
  if (component.kind === "powerModule") return typedefs.power_module ?? [];
  if (component.kind === "connector") return typedefs.connector_breakout ?? [];
  if (component.kind === "mda") {
    const direct = typedefs.mda ?? [];
    const xiom = typedefs.xiom_mda ?? [];
    return component.slot.includes("-x") ? uniqueSorted([...xiom, ...direct]) : uniqueSorted([...direct, ...xiom]);
  }
  return [];
}

function catalogTopoNodeDefaults(catalog: EdaYangCatalog, chassis: string): EdaTopoNodeComponent[] {
  return edaCatalogDefaults(catalog, chassis).filter((component): component is EdaTopoNodeComponent => !isConnectorDefault(component));
}

function powerProfileEntriesForChassis(
  catalog: EdaYangCatalog,
  chassis: string,
  kind: "powerShelf" | "powerModule"
): EdaPowerProfileEntry[] {
  const profile = catalog.toponode_power_profiles?.[clabChassisToken(chassis)];
  return profile?.[kind] ?? [];
}

export function edaHasPowerProfileForChassis(catalog: EdaYangCatalog, chassis: string): boolean {
  return Boolean(catalog.toponode_power_profiles?.[clabChassisToken(chassis)]);
}

export function edaPowerComponentsForChassis(
  catalog: EdaYangCatalog,
  chassis: string,
  kind: "powerShelf" | "powerModule"
): EdaTopoNodeComponent[] {
  const profileEntries = powerProfileEntriesForChassis(catalog, chassis, kind);
  if (profileEntries.length) {
    return profileEntries.map((entry) => ({
      kind,
      slot: entry.slot,
      type: entry.types[0] ?? ""
    }));
  }
  return catalogTopoNodeDefaults(catalog, chassis).filter((component) => component.kind === kind);
}

function genericPowerSlots(catalog: EdaYangCatalog, kind: "powerShelf" | "powerModule"): string[] {
  const inventory = catalog.inventory_schema ?? {};
  if (kind === "powerShelf") return uniqueSorted(inventory.powerShelf?.slots ?? []);
  const shelfModuleSlots = inventory.powerShelfPowerModule?.slots ?? [];
  return uniqueSorted(shelfModuleSlots.length ? shelfModuleSlots : (inventory.powerModule?.slots ?? []));
}

export function edaPowerSlotsForChassis(catalog: EdaYangCatalog, chassis: string, kind: "powerShelf" | "powerModule"): string[] {
  const profileEntries = powerProfileEntriesForChassis(catalog, chassis, kind);
  if (profileEntries.length) return uniqueSorted(profileEntries.map((entry) => entry.slot));
  const defaults = uniqueSorted(edaPowerComponentsForChassis(catalog, chassis, kind).map((component) => component.slot));
  return defaults.length ? defaults : genericPowerSlots(catalog, kind);
}

export function edaPowerTypesForChassis(catalog: EdaYangCatalog, chassis: string, kind: "powerShelf" | "powerModule"): string[] {
  const typedefs = edaComponentTypeOptions(catalog, { kind, slot: "", type: "" });
  const profileEntries = powerProfileEntriesForChassis(catalog, chassis, kind);
  if (profileEntries.length) {
    const profileTypes = uniqueSorted(profileEntries.flatMap((entry) => entry.types));
    const catalogTypes = profileTypes.filter((type) => typedefs.includes(type));
    return catalogTypes.length ? catalogTypes : profileTypes;
  }
  const defaults = uniqueSorted(edaPowerComponentsForChassis(catalog, chassis, kind).map((component) => component.type));
  const catalogTypes = defaults.filter((type) => typedefs.includes(type));
  if (catalogTypes.length) return catalogTypes;
  return defaults.length ? defaults : typedefs;
}

export function edaConnectorTypesForChassis(catalog: EdaYangCatalog, chassis: string): string[] {
  const types = edaCatalogDefaults(catalog, chassis)
    .filter(isConnectorDefault)
    .map((component) => component.type);
  return uniqueSorted([...types, ...edaConnectorBreakoutTypes(catalog)]);
}
