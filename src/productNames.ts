import productNameRows from "./data/product-enhancements.json";

interface ProductNameRow {
  schema_string: string;
  nokia_name: string | null;
  help_text_2: string | null;
  forwarding_generation: "FP3" | "FP4" | "FP5" | null;
  product_family: string | null;
}

const productNames = new Map<string, ProductNameRow>(
  (productNameRows as ProductNameRow[]).map((row) => [row.schema_string, row])
);

/** "<Nokia name>: <help text>" for a schema value, or "" when no vetted text exists. */
export function productHelp(value: string): string {
  const row = productNames.get(value) ?? productNames.get(value.toLowerCase());
  if (!row) return "";
  const name = row.nokia_name && row.nokia_name !== value ? row.nokia_name : "";
  return [name, row.help_text_2 ?? ""].filter(Boolean).join(": ");
}

/** Group order for chassis dropdowns. */
export const chassisGroupOrder = [
  "7750 SR-s",
  "7750 SR-x",
  "7750 SR",
  "7750 SR-e",
  "7750 SR-a",
  "7450 ESS",
  "7705 SAR",
  "7250 IXR",
  "7950 XRS",
  "Other"
];

/** Product family of a chassis from the product data, e.g. "7750 SR-s"; "Other" when it has none. */
export function chassisGroup(value: string): string {
  return (productNames.get(value) ?? productNames.get(value.toLowerCase()))?.product_family ?? "Other";
}

const generationLabels = { FP5: "FP5 (E5)", FP4: "FP4 (E4)", FP3: "FP3" } as const;

/** Group order for module dropdowns, newest forwarding generation first. */
export const generationGroupOrder = [...Object.values(generationLabels), "Other"];

/** Forwarding generation group from the product data; E4/E5 MDAs count as FP4/FP5. */
export function generationGroup(value: string): string {
  const row = productNames.get(value) ?? productNames.get(value.toLowerCase());
  return row?.forwarding_generation ? generationLabels[row.forwarding_generation] : "Other";
}

/** Stable-sort options by group order and return whether grouping is worth showing. */
export function groupOptions(
  options: string[],
  groupBy: ((option: string) => string) | undefined,
  groupOrder: string[] = []
): { options: string[]; grouped: boolean } {
  if (!groupBy) return { options, grouped: false };
  const rank = (option: string) => {
    const index = groupOrder.indexOf(groupBy(option));
    return index < 0 ? groupOrder.length : index;
  };
  const sorted = options
    .map((option, index) => ({ option, index, rank: rank(option) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ option }) => option);
  return { options: sorted, grouped: new Set(options.map(groupBy)).size > 1 };
}
