export type MatrixSource = "default_layout" | "supported_hardware";

export type RawHardwareRecord = Record<string, string>;

export interface HardwareModelEntry {
  default_layout?: RawHardwareRecord[];
  supported_hardware?: RawHardwareRecord[];
  supported_values?: Record<string, string[]>;
}

export interface HardwareSchema {
  "$schema"?: string;
  generated_at?: string;
  source?: string;
  eda?: EdaYangCatalog;
  models: Record<string, HardwareModelEntry>;
}

export interface MatrixRow {
  model: string;
  source: MatrixSource;
  values: Record<string, string[]>;
}

export interface MatrixEntry {
  chassis: string;
  models: string[];
  rows: MatrixRow[];
}

export interface SrsimMda {
  slot?: string | number;
  type?: string;
}

export interface SrsimXiom {
  slot?: string | number;
  type?: string;
  mda?: SrsimMda[];
}

export interface SrsimComponent {
  slot?: string | number;
  type?: string;
  mda?: SrsimMda[];
  xiom?: SrsimXiom[];
}

export type OutputMode = "clab" | "eda";

export interface SrsimConfig {
  labName: string;
  nodeName: string;
  chassis: string;
  sfm: string;
  components: SrsimComponent[];
  edaNamespace: string;
  edaNodeProfile: string;
  edaVersion: string;
  edaComponents: EdaTopoNodeComponent[];
}

export type EdaTopoNodeComponentKind =
  | "controlCard"
  | "lineCard"
  | "fabric"
  | "mda"
  | "connector"
  | "xiom"
  | "powerShelf"
  | "powerModule";

export interface EdaTopoNodeComponent {
  kind: EdaTopoNodeComponentKind;
  slot: string;
  type: string;
}

export interface EdaConnectorDefault {
  kind: "connector";
  count: number;
  type: string;
}

export type EdaCatalogComponentDefault = EdaTopoNodeComponent | EdaConnectorDefault;

export interface EdaTopoNodeComponentDefaults {
  components: EdaCatalogComponentDefault[];
}

export interface EdaConnectorGroup {
  count: number;
  defaultType: string;
  types: string[];
}

export interface EdaMdaConnectorProfile {
  mdaType: string;
  connectors: EdaConnectorGroup[];
}

export interface EdaPowerProfileEntry {
  slot: string;
  types: string[];
}

export interface EdaPowerProfile {
  source?: string;
  source_note?: string;
  powerShelf?: EdaPowerProfileEntry[];
  powerModule?: EdaPowerProfileEntry[];
}

export interface EdaYangInventoryEntry {
  path?: string;
  parent_kind?: EdaTopoNodeComponentKind;
  parent_slot_range?: string;
  slot_leaf?: string;
  slot_range?: string;
  slots?: string[];
  type_leaf?: string;
}

export interface EdaYangCatalog {
  "$schema"?: string;
  source?: string;
  state_only_inventory?: string[];
  inventory_schema?: {
    powerShelf?: EdaYangInventoryEntry;
    powerModule?: EdaYangInventoryEntry;
    powerShelfPowerModule?: EdaYangInventoryEntry;
    [key: string]: EdaYangInventoryEntry | undefined;
  };
  toponode_component_kinds: EdaTopoNodeComponentKind[];
  toponode_component_defaults?: Record<string, EdaTopoNodeComponentDefaults>;
  toponode_connector_profiles?: Record<string, EdaMdaConnectorProfile>;
  toponode_power_profiles?: Record<string, EdaPowerProfile>;
  typedefs: {
    card?: string[];
    connector_breakout?: string[];
    control_card?: string[];
    fabric?: string[];
    mda?: string[];
    power_module?: string[];
    power_shelf?: string[];
    xiom?: string[];
    xiom_mda?: string[];
    [key: string]: string[] | undefined;
  };
}

export interface ValidationIssue {
  source: "yaml" | "schema" | "hardware";
  message: string;
  path?: string;
}

export interface ValidationReport {
  valid: boolean;
  parsed?: unknown;
  issues: ValidationIssue[];
}
