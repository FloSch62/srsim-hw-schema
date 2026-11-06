import YAML from "yaml";

import type { SrsimComponent, SrsimConfig, SrsimMda, SrsimXiom } from "./types";

type ContainerlabConfig = Pick<SrsimConfig, "labName" | "nodeName" | "chassis" | "sfm" | "components">;

export interface TopologyYamlOptions {
  shouldWriteComponentSlot?: (component: SrsimComponent) => boolean;
  shouldWriteComponentType?: (component: SrsimComponent) => boolean;
  writeSfm?: boolean;
  shouldWriteDirectMda?: (component: SrsimComponent, mda: SrsimMda) => boolean;
  shouldWriteXiom?: (component: SrsimComponent, xiom: SrsimXiom) => boolean;
  shouldWriteXiomMda?: (component: SrsimComponent, xiom: SrsimXiom, mda: SrsimMda) => boolean;
}

function normalizedSlot(slot: string | number | undefined): string | number | undefined {
  if (slot === undefined || slot === "") return undefined;
  if (typeof slot === "number") return slot;
  return /^\d+$/.test(slot) ? Number(slot) : slot;
}

function compactMda(mda: SrsimMda): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const slot = normalizedSlot(mda.slot);
  if (slot !== undefined) out.slot = slot;
  if (mda.type) out.type = mda.type;
  return Object.keys(out).length ? out : null;
}

function compactXiom(component: SrsimComponent, xiom: SrsimXiom, options: TopologyYamlOptions): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const slot = normalizedSlot(xiom.slot);
  if (slot !== undefined) out.slot = slot;
  if (xiom.type) out.type = xiom.type;

  const mdas = (xiom.mda ?? [])
    .filter((mda) => options.shouldWriteXiomMda?.(component, xiom, mda) ?? true)
    .map(compactMda)
    .filter((item): item is Record<string, unknown> => item !== null);
  if (mdas.length) out.mda = mdas;
  return Object.keys(out).length ? out : null;
}

function compactComponent(component: SrsimComponent, options: TopologyYamlOptions): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const slot = normalizedSlot(component.slot);
  if (slot !== undefined && (options.shouldWriteComponentSlot?.(component) ?? true)) out.slot = slot;
  if (component.type && (options.shouldWriteComponentType?.(component) ?? true)) out.type = component.type;

  const mdas = (component.mda ?? [])
    .filter((mda) => options.shouldWriteDirectMda?.(component, mda) ?? true)
    .map(compactMda)
    .filter((item): item is Record<string, unknown> => item !== null);
  if (mdas.length) out.mda = mdas;

  const xioms = (component.xiom ?? [])
    .filter((xiom) => options.shouldWriteXiom?.(component, xiom) ?? true)
    .map((xiom) => compactXiom(component, xiom, options))
    .filter((item): item is Record<string, unknown> => item !== null);
  if (xioms.length) out.xiom = xioms;

  return Object.keys(out).length ? out : null;
}

function componentOrder(left: SrsimComponent, right: SrsimComponent): number {
  const leftSlot = normalizedSlot(left.slot);
  const rightSlot = normalizedSlot(right.slot);
  const leftCpm = typeof leftSlot === "string";
  const rightCpm = typeof rightSlot === "string";
  if (leftCpm !== rightCpm) return leftCpm ? -1 : 1;
  return String(leftSlot ?? "").localeCompare(String(rightSlot ?? ""), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

export function buildTopologyObject(config: ContainerlabConfig, options: TopologyYamlOptions = {}): Record<string, unknown> {
  const components = [...config.components]
    .sort(componentOrder)
    .map((component) => compactComponent(component, options))
    .filter((item): item is Record<string, unknown> => item !== null);
  const writeSfm = Boolean(config.sfm) && (options.writeSfm ?? true);

  return {
    name: config.labName || "srsim-lab",
    topology: {
      nodes: {
        [config.nodeName || "sros1"]: {
          kind: "nokia_srsim",
          type: config.chassis || "select-chassis",
          ...(writeSfm ? { sfm: config.sfm } : {}),
          components
        }
      }
    }
  };
}

export function buildTopologyYaml(config: ContainerlabConfig, options: TopologyYamlOptions = {}): string {
  return YAML.stringify(buildTopologyObject(config, options), {
    lineWidth: 0,
    singleQuote: false
  });
}
