import type {
  HardwareModelEntry,
  HardwareSchema,
  MatrixEntry,
  MatrixRow,
  RawHardwareRecord,
  SrsimComponent,
  SrsimMda,
  SrsimXiom
} from "./types";

const hardwareFields = new Set(["card", "sfm", "xiom", "mda"]);
const integratedChassis = new Set(["sr-1", "sr-1s", "ixr-r6", "ixr-ec", "ixr-e2", "ixr-e2c"]);
const redundantIntegratedChassis = new Set(["ixr-r6"]);
const mdaSlotRestrictions = new Map<string, number[]>([
  ["ixr-r4:m20-1g-csfp", [1, 2, 3]],
  ["ixr-r4:m10-1g-sfp+2-10g-sfp+", [5]],
  ["ixr-r6:a32-chds1v2", [5, 6]],
  ["ixr-r6:m20-1g-csfp", [3, 4]]
]);

export type DeploymentMode = "standalone" | "integrated_redundant" | "distributed";
export type MatrixRowAction = "add" | "replace";

export function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function canonicalToken(value: unknown): string {
  return cleanText(value).toLowerCase();
}

export function isEmptyValue(value: unknown): boolean {
  const text = cleanText(value);
  return text === "" || text === "-" || text === "--" || text === "N/A" || text === "n/a";
}

export function uniqueSorted(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result.sort((a, b) => {
    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) return Number(a) - Number(b);
    if (aNum !== bNum) return aNum ? -1 : 1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function splitValues(value: unknown): string[] {
  const text = cleanText(value);
  if (isEmptyValue(text)) return [];

  const parts: string[] = [];
  for (const line of text.split("\n")) {
    for (const part of line.split(/\s+\bor\b\s+/i)) {
      const cleaned = cleanText(part);
      if (cleaned && !isEmptyValue(cleaned) && cleaned.toLowerCase() !== "or") {
        parts.push(cleaned);
      }
    }
  }
  return uniqueSorted(parts.length ? parts : [text]);
}

export function clabChassisToken(value: unknown): string {
  return cleanText(value)
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/^(?:7250|7450|7705|7750|7950)\s+/i, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function normalizedRecordValues(field: string, value: unknown): string[] {
  const values = splitValues(value);
  if (field === "chassis") {
    return uniqueSorted(values.map(clabChassisToken));
  }
  if (hardwareFields.has(field) || field.startsWith("mda_")) {
    return uniqueSorted(values.map((item) => cleanText(item).toLowerCase()));
  }
  return uniqueSorted(values);
}

function aliasesFromEntry(model: string, entry: HardwareModelEntry): string[] {
  let aliases: string[] = [];
  for (const value of entry.supported_values?.chassis ?? []) {
    aliases = aliases.concat(normalizedRecordValues("chassis", value));
  }
  if (aliases.length) return uniqueSorted(aliases);

  for (const source of ["default_layout", "supported_hardware"] as const) {
    for (const record of entry[source] ?? []) {
      if (record.chassis) {
        aliases = aliases.concat(normalizedRecordValues("chassis", record.chassis));
      }
    }
  }
  return aliases.length ? uniqueSorted(aliases) : uniqueSorted([clabChassisToken(model)]);
}

function normalizedRow(record: RawHardwareRecord): Record<string, string[]> {
  const row: Record<string, string[]> = {};
  for (const field of Object.keys(record).sort()) {
    const values = normalizedRecordValues(field, record[field]);
    if (values.length) row[field] = values;
  }
  return row;
}

function rowText(row: MatrixRow): string {
  const parts = [row.model, row.source];
  for (const field of ["slot", "card", "sfm", "xiom", "mda", "memory"]) {
    parts.push(...(row.values[field] ?? []));
  }
  return parts.join(" ").toLowerCase();
}

export function buildMatrix(data: HardwareSchema): MatrixEntry[] {
  const built = new Map<string, MatrixEntry & { seenRows: Set<string> }>();

  const ensureEntry = (chassis: string): MatrixEntry & { seenRows: Set<string> } => {
    const existing = built.get(chassis);
    if (existing) return existing;
    const next = { chassis, models: [], rows: [], seenRows: new Set<string>() };
    built.set(chassis, next);
    return next;
  };

  for (const [model, entry] of Object.entries(data.models ?? {}).sort()) {
    const aliases = aliasesFromEntry(model, entry);
    for (const alias of aliases) {
      const target = ensureEntry(alias);
      target.models = uniqueSorted([...target.models, model]);
    }

    for (const source of ["default_layout", "supported_hardware"] as const) {
      for (const record of entry[source] ?? []) {
        const values = normalizedRow(record);
        const rowAliases = values.chassis?.length ? values.chassis : aliases;
        for (const alias of rowAliases) {
          const target = ensureEntry(alias);
          target.models = uniqueSorted([...target.models, model]);
          const row = { model, source, values };
          const key = JSON.stringify(row);
          if (!target.seenRows.has(key)) {
            target.seenRows.add(key);
            target.rows.push(row);
          }
        }
      }
    }
  }

  return [...built.values()]
    .map(({ seenRows: _seenRows, ...entry }) => ({
      ...entry,
      rows: [...entry.rows].sort((a, b) =>
        rowText(a).localeCompare(rowText(b), undefined, { numeric: true, sensitivity: "base" })
      )
    }))
    .sort((a, b) =>
      a.chassis.localeCompare(b.chassis, undefined, { numeric: true, sensitivity: "base" })
    );
}

export function cardLooksCpm(card: unknown): boolean {
  const value = String(card ?? "");
  return value.startsWith("cpm") || value.startsWith("cpiom");
}

function rowHasAlphaSlot(row: MatrixRow): boolean {
  return (row.values.slot ?? []).some((slot) => /^[AB]$/i.test(slot));
}

function rowHasNumericSlot(row: MatrixRow): boolean {
  return (row.values.slot ?? []).some((slot) => /^\d+$/.test(slot));
}

function rowHasPayload(row: MatrixRow): boolean {
  return Boolean(rowMdaValues(row).length || (row.values.xiom ?? []).length);
}

export function rowCpmCards(row: MatrixRow, entry?: MatrixEntry): string[] {
  const mode = deploymentMode(entry);
  const values: string[] = [];
  for (const card of row.values.card ?? []) {
    const splitForRoles = splitCardParts(card) !== null && !combinedCardPreserved(entry, card);
    if (mode === "standalone" || mode === "integrated_redundant") {
      values.push(roleCardValue(card, entry, "cpm"));
    } else if (rowHasAlphaSlot(row) || splitForRoles || (cardLooksCpm(card) && !rowHasPayload(row))) {
      values.push(roleCardValue(card, entry, "cpm"));
    }
  }
  return uniqueSorted(values);
}

export function rowLineCards(row: MatrixRow, entry?: MatrixEntry): string[] {
  const mode = deploymentMode(entry);
  if (mode === "standalone" || mode === "integrated_redundant") return [];

  const values: string[] = [];
  for (const card of row.values.card ?? []) {
    if (rowHasNumericSlot(row) || rowHasPayload(row) || !cardLooksCpm(card)) {
      values.push(roleCardValue(card, entry, "line"));
    }
  }
  return uniqueSorted(values);
}

export function firstNumericSlot(row: MatrixRow | undefined): string {
  return row?.values.slot?.find((slot) => /^\d+$/.test(slot)) ?? "";
}

export function firstAlphaSlot(row: MatrixRow | undefined): string {
  return row?.values.slot?.find((slot) => /^[AB]$/i.test(slot)) ?? "";
}

export function firstValue(row: MatrixRow | undefined, field: string): string {
  return row?.values[field]?.[0] ?? "";
}

export function getEntry(matrix: MatrixEntry[], chassis: string): MatrixEntry | undefined {
  return matrix.find((entry) => entry.chassis === chassis) ?? matrix[0];
}

function entrySlots(entry: MatrixEntry | undefined): string[] {
  return uniqueSorted(
    (entry?.rows ?? [])
      .filter((row) => row.source === "default_layout")
      .flatMap((row) => row.values.slot ?? [])
  );
}

export function deploymentMode(entry: MatrixEntry | undefined): DeploymentMode {
  const chassis = entry?.chassis ?? "";
  if (redundantIntegratedChassis.has(chassis)) return "integrated_redundant";
  const slots = entrySlots(entry);
  const hasAlphaSlot = slots.some((slot) => /^[A-Z]$/i.test(slot));
  const hasNumericSlot = slots.some((slot) => /^\d+$/.test(slot));
  if (integratedChassis.has(chassis) || (hasAlphaSlot && !hasNumericSlot)) return "standalone";
  return "distributed";
}

function splitCardParts(card: string): [string, string] | null {
  const index = card.indexOf("/");
  if (index === -1) return null;
  const cpm = card.slice(0, index);
  const lineCard = card.slice(index + 1);
  return cardLooksCpm(cpm) && lineCard ? [cpm, lineCard] : null;
}

function combinedCardPreserved(entry: MatrixEntry | undefined, card: string): boolean {
  let alpha = false;
  let numeric = false;
  for (const row of entry?.rows ?? []) {
    if (row.source !== "default_layout" || !(row.values.card ?? []).includes(card)) continue;
    alpha ||= (row.values.slot ?? []).some((slot) => /^[A-Z]$/i.test(slot));
    numeric ||= (row.values.slot ?? []).some((slot) => /^\d+$/.test(slot));
  }
  return alpha && numeric;
}

function roleCardValue(card: string, entry: MatrixEntry | undefined, role: "cpm" | "line"): string {
  const parts = splitCardParts(card);
  if (parts && !combinedCardPreserved(entry, card)) {
    return role === "cpm" ? parts[0] : parts[1];
  }
  return card;
}

function mdaFields(row: MatrixRow): string[] {
  return Object.keys(row.values).filter((field) => field === "mda" || field.startsWith("mda_"));
}

function rowMdaValues(row: MatrixRow): string[] {
  return uniqueSorted(mdaFields(row).flatMap((field) => row.values[field] ?? []));
}

function rowNumberedMdaSlots(row: MatrixRow): number[] {
  return uniqueNumbers(
    mdaFields(row)
      .filter((field) => field.startsWith("mda_"))
      .map((field) => field.slice(4))
  );
}

function directMdasFromRow(row: MatrixRow): SrsimMda[] {
  const mdas: SrsimMda[] = [];
  const fields = mdaFields(row);
  const numberedFields = fields.filter((field) => field.startsWith("mda_"));
  for (const field of numberedFields.length ? numberedFields : fields) {
    const slot = field.startsWith("mda_") ? Number(field.slice(4)) : 1;
    for (const type of row.values[field] ?? []) {
      mdas.push({ slot, type });
    }
  }
  return mdas;
}

function componentMdasFromRow(row: MatrixRow): SrsimMda[] {
  const numberedFields = mdaFields(row).filter((field) => field.startsWith("mda_"));
  if (numberedFields.length) return directMdasFromRow(row);

  const type = firstValue(row, "mda");
  return type ? [makeMda(1, type)] : [];
}

function rowMatchesComponent(
  row: MatrixRow,
  entry: MatrixEntry | undefined,
  component: SrsimComponent,
  sfm: string,
  omitField?: "card" | "sfm" | "xiom" | "mda"
): boolean {
  if (sfm && omitField !== "sfm" && (row.values.sfm ?? []).length && !row.values.sfm.includes(sfm)) {
    return false;
  }
  const cardValues = isCpmSlot(component.slot) ? rowCpmCards(row, entry) : rowLineCards(row, entry);
  if (component.type && omitField !== "card" && !cardValues.includes(component.type)) {
    return false;
  }
  const selectedXiom = component.xiom?.find((xiom) => xiom.type)?.type ?? "";
  if (selectedXiom && omitField !== "xiom" && !(row.values.xiom ?? []).includes(selectedXiom)) {
    return false;
  }
  const selectedMda =
    component.mda?.find((mda) => mda.type)?.type ??
    component.xiom?.flatMap((xiom) => xiom.mda ?? []).find((mda) => mda.type)?.type ??
    "";
  if (selectedMda && omitField !== "mda" && !rowMdaValues(row).includes(selectedMda)) {
    return false;
  }
  return true;
}

function optionRows(entry: MatrixEntry | undefined, component: SrsimComponent, sfm: string, omitField: "card" | "sfm" | "xiom" | "mda"): MatrixRow[] {
  return (entry?.rows ?? []).filter((row) => rowMatchesComponent(row, entry, component, sfm, omitField));
}

export function cpmOptions(entry: MatrixEntry | undefined, sfm: string): string[] {
  const values: string[] = [];
  for (const row of entry?.rows ?? []) {
    if (sfm && (row.values.sfm ?? []).length && !row.values.sfm.includes(sfm)) continue;
    values.push(...rowCpmCards(row, entry));
  }
  return uniqueSorted(values);
}

export function componentTypeOptions(entry: MatrixEntry | undefined, component: SrsimComponent, sfm: string): string[] {
  const values: string[] = [];
  for (const row of optionRows(entry, component, sfm, "card")) {
    values.push(...rowLineCards(row, entry));
  }
  return uniqueSorted(values);
}

export function sfmOptions(entry: MatrixEntry | undefined, components: SrsimComponent[]): string[] {
  const selectedComponents = components.filter((component) => component.type);
  if (!selectedComponents.length) {
    return uniqueSorted((entry?.rows ?? []).flatMap((row) => row.values.sfm ?? []));
  }

  let intersection: string[] | null = null;
  for (const component of selectedComponents) {
    const values = uniqueSorted(
      (entry?.rows ?? [])
        .filter((row) => rowMatchesComponent(row, entry, component, "", "sfm"))
        .flatMap((row) => row.values.sfm ?? [])
    );
    if (!values.length) continue;
    intersection = intersection === null ? values : intersection.filter((value) => values.includes(value));
  }
  return uniqueSorted(intersection ?? []);
}

export function xiomOptions(entry: MatrixEntry | undefined, component: SrsimComponent, sfm: string): string[] {
  const base = { slot: component.slot, type: component.type };
  return uniqueSorted(optionRows(entry, base, sfm, "xiom").flatMap((row) => row.values.xiom ?? []));
}

export function directMdaOptions(entry: MatrixEntry | undefined, component: SrsimComponent, sfm: string): string[] {
  const base = { slot: component.slot, type: component.type };
  return uniqueSorted(
    optionRows(entry, base, sfm, "mda")
      .filter((row) => !(row.values.xiom ?? []).length)
      .flatMap(rowMdaValues)
  );
}

export function xiomMdaOptions(
  entry: MatrixEntry | undefined,
  component: SrsimComponent,
  xiom: SrsimXiom,
  sfm: string
): string[] {
  const base = {
    slot: component.slot,
    type: component.type,
    xiom: xiom.type ? [{ slot: xiom.slot, type: xiom.type }] : []
  };
  return uniqueSorted(
    optionRows(entry, base, sfm, "mda")
      .filter((row) => (row.values.xiom ?? []).length)
      .flatMap(rowMdaValues)
  );
}

export function restrictedMdaSlots(chassis: string | undefined, mdaType: string): number[] {
  return mdaSlotRestrictions.get(`${clabChassisToken(chassis)}:${canonicalToken(mdaType)}`) ?? [];
}

function mdaSlotOptionsFromRows(
  entry: MatrixEntry | undefined,
  rows: MatrixRow[],
  fallbackSlotCount: number,
  minimumSlot: number,
  mdaType = ""
): number[] {
  const restrictedSlots = uniqueNumbers(
    (mdaType ? [mdaType] : uniqueSorted(rows.flatMap(rowMdaValues)))
      .flatMap((type) => restrictedMdaSlots(entry?.chassis, type))
  ).filter((slot) => slot >= minimumSlot);
  if (mdaType && restrictedSlots.length) return restrictedSlots;

  const numberedSlots = uniqueNumbers(rows.flatMap(rowNumberedMdaSlots))
    .filter((slot) => slot >= minimumSlot);
  if (numberedSlots.length) return numberedSlots;

  const fallbackSlots = numberRange(fallbackSlotCount, minimumSlot);
  return restrictedSlots.length ? uniqueNumbers([...fallbackSlots, ...restrictedSlots]) : fallbackSlots;
}

export function directMdaSlotOptions(
  entry: MatrixEntry | undefined,
  component: SrsimComponent,
  sfm: string,
  fallbackSlotCount = 2,
  minimumSlot = 1,
  mdaType = ""
): number[] {
  const base = { slot: component.slot, type: component.type };
  const rows = optionRows(entry, base, sfm, "mda").filter((row) => !(row.values.xiom ?? []).length);
  return mdaSlotOptionsFromRows(entry, rows, fallbackSlotCount, minimumSlot, mdaType);
}

export function xiomMdaSlotOptions(
  entry: MatrixEntry | undefined,
  component: SrsimComponent,
  xiom: SrsimXiom,
  sfm: string,
  fallbackSlotCount = 2,
  minimumSlot = 1,
  mdaType = ""
): number[] {
  const base = {
    slot: component.slot,
    type: component.type,
    xiom: xiom.type ? [{ slot: xiom.slot, type: xiom.type }] : []
  };
  const rows = optionRows(entry, base, sfm, "mda").filter((row) => (row.values.xiom ?? []).length);
  return mdaSlotOptionsFromRows(entry, rows, fallbackSlotCount, minimumSlot, mdaType);
}

export function mdaOptions(entry: MatrixEntry | undefined, component: SrsimComponent, sfm: string): string[] {
  const mode = deploymentMode(entry);
  return uniqueSorted(
    optionRows(entry, component, sfm, "mda")
      .filter((row) => mode === "distributed" || !(row.values.xiom ?? []).length)
      .flatMap(rowMdaValues)
  );
}

function uniqueNumbers(values: unknown[]): number[] {
  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function numberRange(max: number, min = 1): number[] {
  const start = Math.max(1, min);
  const end = Math.max(start, max);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function inferredComponentSlotCount(chassis: string | undefined): number {
  const value = chassis ?? "";
  const srA = value.match(/^sr-a(\d+)$/);
  if (srA) return Number(srA[1]);

  const modular = value.match(/^(?:ess|ixr|sr|xrs)-(\d+)(?:[a-z]*)$/);
  if (modular) return Number(modular[1]);

  return 1;
}

function matrixCardSlotOptions(entry: MatrixEntry | undefined, minimumSlot = 1): number[] {
  const matrixSlots = uniqueNumbers((entry?.rows ?? []).flatMap((row) => row.values.slot ?? []));
  const maxSlot = Math.max(inferredComponentSlotCount(entry?.chassis), ...matrixSlots, minimumSlot);
  return numberRange(maxSlot, minimumSlot);
}

export function componentCpmSlotOptions(entry: MatrixEntry | undefined, schemaSlots: string[] = ["A", "B"]): string[] {
  const slots = (entry?.rows ?? [])
    .flatMap((row) => row.values.slot ?? [])
    .filter((slot) => /^[AB]$/i.test(slot))
    .map((slot) => slot.toUpperCase());
  return uniqueSorted([...slots, ...schemaSlots.map((slot) => slot.toUpperCase())]);
}

export function componentCardSlotOptions(
  entry: MatrixEntry | undefined,
  components: Array<{ slot?: string | number }> = [],
  minimumSlot = 1
): number[] {
  const configuredSlots = uniqueNumbers(components.map((component) => component.slot));
  const maxSlot = Math.max(...matrixCardSlotOptions(entry, minimumSlot), ...configuredSlots, minimumSlot);
  return numberRange(maxSlot, minimumSlot);
}

export function schemaNumericSlotOptions(
  items: Array<{ slot?: string | number }> = [],
  minimumVisibleSlots = 1,
  minimumSlot = 1
): number[] {
  const configuredSlots = uniqueNumbers(items.map((item) => item.slot));
  const maxSlot = Math.max(minimumVisibleSlots, ...configuredSlots, minimumSlot);
  return numberRange(maxSlot, minimumSlot);
}

export function availableNumericSlotOptions(
  slotOptions: number[],
  items: Array<{ slot?: string | number }> = []
): number[] {
  const used = new Set(uniqueNumbers(items.map((item) => item.slot)).map(String));
  return slotOptions.filter((slot) => !used.has(String(slot)));
}

export function matrixSearchRows(entry: MatrixEntry | undefined, query: string): MatrixRow[] {
  const needle = query.trim().toLowerCase();
  return (entry?.rows ?? []).filter((row) => !needle || rowText(row).includes(needle));
}

export function isCpmSlot(slot: unknown): boolean {
  if (slot === undefined || slot === null) return false;
  const value = String(slot).trim().toUpperCase();
  return value === "A" || value === "B";
}

function makeMda(slot: string | number, type: string): SrsimMda {
  return { slot, type };
}

function makeXiom(slot: string | number, type: string, mdaType: string): SrsimXiom {
  return { slot, type, mda: mdaType ? [makeMda(1, mdaType)] : [] };
}

function nextAvailableCardSlot(entry: MatrixEntry | undefined, components: SrsimComponent[]): number | null {
  const used = new Set(
    components
      .filter((component) => !isCpmSlot(component.slot))
      .map((component) => String(component.slot ?? ""))
  );
  return matrixCardSlotOptions(entry).find((slot) => !used.has(String(slot))) ?? null;
}

function nextAvailableCpmSlot(entry: MatrixEntry | undefined, components: SrsimComponent[]): string | null {
  const used = new Set(
    components
      .filter((component) => isCpmSlot(component.slot))
      .map((component) => String(component.slot ?? "").toUpperCase())
  );
  return componentCpmSlotOptions(entry).find((slot) => !used.has(slot)) ?? null;
}

function firstExistingNumericComponentSlot(components: SrsimComponent[]): number | null {
  const slots = uniqueNumbers(
    components
      .filter((component) => !isCpmSlot(component.slot))
      .map((component) => component.slot)
  );
  return slots[0] ?? null;
}

function cpmSlotForAction(
  row: MatrixRow,
  existingComponents: SrsimComponent[],
  entry: MatrixEntry | undefined,
  action: MatrixRowAction
): string | number | null {
  const rowSlot = firstAlphaSlot(row);

  if (action === "add") {
    if (deploymentMode(entry) !== "distributed") return null;
    const used = new Set(
      existingComponents
        .filter((component) => isCpmSlot(component.slot))
        .map((component) => String(component.slot ?? "").toUpperCase())
    );
    if (rowSlot && !used.has(rowSlot.toUpperCase())) return rowSlot.toUpperCase();
    return nextAvailableCpmSlot(entry, existingComponents);
  }

  return rowSlot ||
    firstExistingComponentSlot(existingComponents, "cpm") ||
    componentCpmSlotOptions(entry)[0] ||
    "A";
}

function cardSlotForAction(
  row: MatrixRow,
  existingComponents: SrsimComponent[],
  entry: MatrixEntry | undefined,
  action: MatrixRowAction
): number | null {
  const rowSlot = firstNumericSlot(row);

  if (action === "add") {
    const rowSlotNumber = Number(rowSlot);
    const used = new Set(
      existingComponents
        .filter((component) => !isCpmSlot(component.slot))
        .map((component) => String(component.slot ?? ""))
    );
    if (Number.isInteger(rowSlotNumber) && rowSlotNumber > 0 && !used.has(String(rowSlotNumber))) {
      return rowSlotNumber;
    }
    return nextAvailableCardSlot(entry, existingComponents);
  }

  if (rowSlot) return Number(rowSlot);
  return firstExistingNumericComponentSlot(existingComponents) ?? matrixCardSlotOptions(entry)[0] ?? null;
}

export function defaultComponentsForEntry(entry: MatrixEntry | undefined): SrsimComponent[] {
  if (!entry) return [];

  const components: SrsimComponent[] = [];
  const seen = new Set<string>();
  const seenSlots = new Set<string>();
  const addComponent = (component: SrsimComponent) => {
    const key = `${component.slot ?? ""}:${component.type ?? ""}:${JSON.stringify(component.mda ?? [])}:${JSON.stringify(component.xiom ?? [])}`;
    const slotKey = String(component.slot ?? "").trim().toUpperCase();
    if ((!component.type && !component.mda?.length && !component.xiom?.length) || seen.has(key)) return;
    if (slotKey && seenSlots.has(slotKey)) return;
    seen.add(key);
    if (slotKey) seenSlots.add(slotKey);
    components.push(component);
  };

  for (const row of entry.rows.filter((candidate) => candidate.source === "default_layout")) {
    if (deploymentMode(entry) === "standalone" || deploymentMode(entry) === "integrated_redundant") {
      const cpmType = rowCpmCards(row, entry)[0];
      const mdas = componentMdasFromRow(row);
      addComponent({
        slot: firstAlphaSlot(row) || "A",
        type: cpmType,
        ...(mdas.length ? { mda: mdas } : {})
      });
      continue;
    }
    for (const type of rowCpmCards(row, entry)) {
      addComponent({ slot: firstAlphaSlot(row) || "A", type });
    }
    for (const type of rowLineCards(row, entry)) {
      const component: SrsimComponent = {
        slot: firstNumericSlot(row) || "1",
        type
      };
      const xiom = firstValue(row, "xiom");
      const mdas = directMdasFromRow(row);
      if (xiom) {
        component.xiom = [makeXiom(1, xiom, mdas[0]?.type ?? "")];
      } else if (mdas.length) {
        component.mda = mdas;
      }
      addComponent(component);
    }
  }

  if (components.length) return components;

  const cpm = cpmOptions(entry, "")[0];
  const card = componentTypeOptions(entry, {}, "")[0];
  return [
    ...(cpm ? [{ slot: "A", type: cpm }] : []),
    ...(card ? [{ slot: 1, type: card }] : [])
  ];
}

export function componentFromMatrixRow(
  row: MatrixRow,
  existingComponents: SrsimComponent[] = [],
  entry: MatrixEntry | undefined,
  action: MatrixRowAction
): SrsimComponent | null {
  const cpmType = rowCpmCards(row, entry)[0];
  if (cpmType) {
    const slot = cpmSlotForAction(row, existingComponents, entry, action);
    const mdas = componentMdasFromRow(row);
    return slot ? { slot, type: cpmType, ...(deploymentMode(entry) !== "distributed" && mdas.length ? { mda: mdas } : {}) } : null;
  }

  const cardType = rowLineCards(row, entry)[0];
  if (!cardType) return null;

  const slot = cardSlotForAction(row, existingComponents, entry, action);
  if (slot === null) return null;

  const component: SrsimComponent = {
    slot,
    type: cardType
  };
  const xiom = firstValue(row, "xiom");
  const mdas = componentMdasFromRow(row);
  if (xiom) {
    component.xiom = [makeXiom(1, xiom, mdas[0]?.type ?? "")];
  } else if (mdas.length) {
    component.mda = mdas;
  }
  return component;
}

function firstExistingComponentSlot(components: SrsimComponent[], kind: "cpm" | "card"): string | number | undefined {
  return components.find((component) => kind === "cpm" ? isCpmSlot(component.slot) : !isCpmSlot(component.slot))?.slot;
}

export function upsertComponentBySlot(components: SrsimComponent[], component: SrsimComponent): SrsimComponent[] {
  const slotKey = String(component.slot ?? "").toUpperCase();
  const next = [...components];
  const index = next.findIndex((item) => String(item.slot ?? "").toUpperCase() === slotKey);
  if (index === -1) {
    next.push(component);
  } else {
    next[index] = component;
  }
  return next;
}

export function defaultSfmForEntry(entry: MatrixEntry | undefined): string {
  const defaults = entry?.rows.filter((row) => row.source === "default_layout") ?? [];
  const sfms = uniqueSorted(defaults.flatMap((row) => row.values.sfm ?? []));
  return sfms.length === 1 ? sfms[0] : (sfms[0] ?? "");
}

export function nextCpmSlot(components: SrsimComponent[]): string | null {
  const used = new Set(components.map((component) => String(component.slot ?? "").toUpperCase()));
  if (!used.has("A")) return "A";
  if (!used.has("B")) return "B";
  return null;
}

export function nextNumericSlot(items: Array<{ slot?: string | number }>): number {
  const used = items
    .map((item) => Number(item.slot))
    .filter((slot) => Number.isFinite(slot) && slot > 0);
  return used.length ? Math.max(...used) + 1 : 1;
}

export function matchingRowsForSummary(entry: MatrixEntry | undefined, component: SrsimComponent, sfm: string): MatrixRow[] {
  return (entry?.rows ?? []).filter((row) => rowMatchesComponent(row, entry, component, sfm));
}

export function componentCompatibleWithSfm(entry: MatrixEntry | undefined, component: SrsimComponent, sfm: string): boolean {
  if (!component.type || !sfm) return true;
  return (entry?.rows ?? []).some((row) => rowMatchesComponent(row, entry, component, sfm));
}

type DefaultField = "sfm" | "xiom" | "mda";

function selectedXiom(component: SrsimComponent): string {
  return component.xiom?.find((xiom) => xiom.type)?.type ?? "";
}

function selectedMda(component: SrsimComponent): string {
  return (
    component.mda?.find((mda) => mda.type)?.type ??
    component.xiom?.flatMap((xiom) => xiom.mda ?? []).find((mda) => mda.type)?.type ??
    ""
  );
}

function rowContains(row: MatrixRow, entry: MatrixEntry | undefined, field: string, expected: string): boolean {
  if (!expected) return true;
  const values = field === "card" ? rowLineCards(row, entry) : field === "mda" ? rowMdaValues(row) : row.values[field];
  return values === undefined || values.includes(expected);
}

function rowContainsSelectedDefault(row: MatrixRow, field: DefaultField, component: SrsimComponent, sfm: string): boolean {
  const expected = field === "sfm" ? sfm : field === "xiom" ? selectedXiom(component) : selectedMda(component);
  if (!expected) return true;
  const values = field === "mda" ? rowMdaValues(row) : (row.values[field] ?? []);
  return values.includes(expected);
}

export function defaultImpliesFields(
  entry: MatrixEntry | undefined,
  component: SrsimComponent,
  sfm: string,
  fields: DefaultField[]
): boolean {
  if (!entry || !component.type) return false;
  const omitted = new Set(fields);

  return entry.rows.some((row) => {
    if (row.source !== "default_layout") return false;
    if (!rowContains(row, entry, "slot", String(component.slot ?? ""))) return false;

    const cards = isCpmSlot(component.slot) ? rowCpmCards(row, entry) : rowLineCards(row, entry);
    if (!cards.includes(component.type ?? "")) return false;

    if (!omitted.has("sfm") && !rowContains(row, entry, "sfm", sfm)) return false;
    if (!omitted.has("xiom") && !rowContains(row, entry, "xiom", selectedXiom(component))) return false;
    if (!omitted.has("mda") && !rowContains(row, entry, "mda", selectedMda(component))) return false;

    return fields.every((field) => rowContainsSelectedDefault(row, field, component, sfm));
  });
}
