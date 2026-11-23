// An XCM line card holds modules in its module slots: either an XMA (forwarding
// complex and ports on one board) or an IOM carrying MDAs. SR OS provisions XMA-s
// and four/six-complex XMA2-s as `card > mda`, but one/two-complex XMA2-s as
// `card > xiom > mda` with an automatic virtual MDA. These helpers hide that split:
// the editor works with modules, the YAML keeps the SR OS hierarchy.
import { cardSlots, integratedCard, iomMdaSlots, isXcm, isXiomXma, moduleSlots, partKind } from "./hardwareModel";
import { directMdaOptions, xiomMdaOptions, xiomOptions } from "./matrix";
import type { ChassisVariant } from "./hardwareModel";
import type { MatrixEntry, SrsimComponent, SrsimMda } from "./types";

export type XcmModuleKind = "xma" | "iom";

export interface XcmModule {
  slot: number;
  kind: XcmModuleKind;
  type: string;
  /** MDAs on an IOM; always empty for an XMA. */
  mda: SrsimMda[];
}

function cardOnly(component: SrsimComponent): SrsimComponent {
  return { slot: component.slot, type: component.type };
}

/** The card type, or the integrated card of a single-container chassis when the component leaves it out. */
function moduleCard(entry: MatrixEntry | undefined, component: SrsimComponent): string {
  return component.type || integratedCard(entry?.chassis);
}

/** Whether the card takes XMAs or IOMs in module slots: XCMs, and the SR-1s integrated card. */
export function hasXcmModules(entry: MatrixEntry | undefined, component: SrsimComponent): boolean {
  const card = moduleCard(entry, component);
  return isXcm(card) || moduleSlots(card).length > 0;
}

/** XMAs the card accepts, whichever SR OS hierarchy each one uses. */
export function xcmXmaOptions(entry: MatrixEntry | undefined, component: SrsimComponent, sfm: string): string[] {
  const card = cardOnly(component);
  const viaXiom = xiomOptions(entry, card, sfm).filter(isXiomXma);
  return [...new Set([...directMdaOptions(entry, card, sfm), ...viaXiom])].sort();
}

/** IOMs the card accepts; XMAs provisioned as XIOM are not IOMs. */
export function xcmIomOptions(entry: MatrixEntry | undefined, component: SrsimComponent, sfm: string): string[] {
  return xiomOptions(entry, cardOnly(component), sfm).filter((type) => !isXiomXma(type));
}

/** The module a newly selected variant starts with; undefined when the variant fixes no module. */
export function variantModule(variant: ChassisVariant): XcmModule | undefined {
  const type = variant.parts.find((part) => ["xma", "iom"].includes(partKind(part)));
  if (!type) return undefined;
  const kind = iomMdaSlots(type).length && !isXiomXma(type) ? "iom" : "xma";
  return { slot: 1, kind, type, mda: [] };
}

export function xcmModuleSlotOptions(entry: MatrixEntry | undefined, component: SrsimComponent): number[] {
  return cardSlots(moduleCard(entry, component));
}

/** Modules of an XCM component, sorted by slot. */
export function xcmModulesFromComponent(component: SrsimComponent): XcmModule[] {
  const modules: XcmModule[] = [
    ...(component.mda ?? []).map((mda) => ({ slot: Number(mda.slot), kind: "xma" as const, type: mda.type ?? "", mda: [] })),
    ...(component.xiom ?? []).map((xiom) =>
      isXiomXma(xiom.type)
        ? { slot: Number(xiom.slot), kind: "xma" as const, type: xiom.type ?? "", mda: [] }
        : { slot: Number(xiom.slot), kind: "iom" as const, type: xiom.type ?? "", mda: xiom.mda ?? [] }
    )
  ];
  return modules.sort((a, b) => a.slot - b.slot);
}

/** The component with its `mda`/`xiom` lists rebuilt from modules in the SR OS hierarchy. */
export function componentWithXcmModules(
  entry: MatrixEntry | undefined,
  component: SrsimComponent,
  modules: XcmModule[],
  sfm: string
): SrsimComponent {
  const card = cardOnly(component);
  const direct = new Set(directMdaOptions(entry, card, sfm));
  const mda: SrsimMda[] = [];
  const xiom: NonNullable<SrsimComponent["xiom"]> = [];
  for (const module of [...modules].sort((a, b) => a.slot - b.slot)) {
    if (module.kind === "xma" && direct.has(module.type)) {
      mda.push({ slot: module.slot, type: module.type });
    } else if (module.kind === "xma") {
      // SR OS sets the virtual MDA itself; it is written out so the YAML matches the hardware table.
      const virtualMda = xiomMdaOptions(entry, card, { slot: module.slot, type: module.type }, sfm)[0];
      xiom.push({ slot: module.slot, type: module.type, mda: virtualMda ? [{ slot: 1, type: virtualMda }] : [] });
    } else {
      xiom.push({ slot: module.slot, type: module.type, mda: module.mda });
    }
  }
  return {
    ...card,
    ...(mda.length ? { mda } : {}),
    ...(xiom.length ? { xiom } : {})
  };
}
