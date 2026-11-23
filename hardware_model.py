"""Physical hardware model that the SR-SIM appendix data is mapped onto.

The appendix says which part types fit together; this model adds what it cannot express:
slot counts, built-in parts, parts that share space or must not be mixed, and chassis variants.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

MODEL_VERSION = 1



@dataclass(frozen=True)
class Slot:
    """A position that accepts parts of the given kinds."""

    id: str
    accepts: tuple[str, ...]
    # How the slot appears in SR-SIM YAML: a component slot ("A", 1) or an mda/xiom slot.
    srsim: str | int | None = None
    # Restriction to specific part types, for facts the appendix cannot carry (CMA -> CPM).
    types: tuple[str, ...] = ()
    # The part built into this slot; it cannot be removed, changed or installed anywhere else.
    fixed: str = ""


@dataclass(frozen=True)
class Part:
    type: str
    kind: str
    slots: tuple[Slot, ...] = ()
    # Other slots of the parent that this part blocks (a dual-slot CMA).
    occupies: tuple[str, ...] = ()
    # SFMs the part works with, when the chassis generation limits it (FP4 vs FP5 SR-s systems).
    sfm: tuple[str, ...] = ()
    label: str = ""
    description: str = ""


@dataclass(frozen=True)
class Variant:
    """A physical product that SR-SIM runs as one chassis type. `parts` pins the CPM, line card or module
    wherever the chassis offers a choice."""

    name: str
    description: str
    parts: tuple[str, ...] = ()


@dataclass(frozen=True)
class Chassis:
    id: str
    slots: tuple[Slot, ...]
    # Line-card types of which at most one may be used in the chassis at a time.
    exclusive: tuple[tuple[str, ...], ...] = ()
    # Single-container chassis: the integrated card that SR-SIM writes as component slot A.
    integrated: str = ""
    variants: tuple[Variant, ...] = ()
    # MDA types a card takes in this chassis, where the chassis has its own physical versions of the card's
    # MDAs under the same SR-SIM names (the IXR-R6d's slim MDAs, the IXR-R6dl's wide ones).
    card_mdas: tuple[tuple[str, tuple[str, ...]], ...] = ()


@dataclass
class Model:
    parts: dict[str, Part] = field(default_factory=dict)
    chassis: dict[str, Chassis] = field(default_factory=dict)

    def add_part(self, part: Part) -> None:
        if part.type in self.parts and self.parts[part.type] != part:
            raise ValueError(f"part {part.type} defined twice with different facts")
        self.parts[part.type] = part


# -- builders -------------------------------------------------------------------------


def module_carrier(
    type_: str, kind: str, modules: int, types: tuple[str, ...] = (), sfm: tuple[str, ...] = ()
) -> Part:
    """An XCM (or integrated card) with module slots, each holding one XMA or one IOM of the given types."""
    return Part(
        type=type_,
        kind=kind,
        slots=tuple(Slot(f"module-{n}", ("xma", "iom"), srsim=n, types=types) for n in range(1, modules + 1)),
        sfm=sfm,
    )


def mda_card(type_: str, kind: str, mdas: dict[int, str | None]) -> Part:
    """A card with MDA slots, keyed by SR-SIM slot: the built-in MDA type, "" for a pluggable slot, or None for
    a slot number the card has but cannot fill."""
    return Part(
        type=type_,
        kind=kind,
        slots=tuple(
            Slot(f"mda-{n}", () if fixed is None else ("mda",), srsim=n, fixed=fixed or "") for n, fixed in mdas.items()
        ),
    )


def iom(type_: str, mdas: int) -> Part:
    return mda_card(type_, "iom", dict.fromkeys(range(1, mdas + 1), ""))


def cpm_slots(cpm_types: tuple[str, ...], count: int) -> tuple[Slot, ...]:
    return tuple(Slot(f"cpm-{letter.lower()}", ("cpm",), srsim=letter, types=cpm_types) for letter in "AB"[:count])


def cma(
    type_: str, label: str, description: str, cpm: str, cpms: int, occupies: tuple[str, ...] = ()
) -> Part:
    """Control-module adapter: SR-SIM does not know it, only the CPMs it holds (slots A and B)."""
    return Part(
        type_, "cma", cpm_slots((cpm,), cpms), occupies=occupies, label=label, description=description
    )


def xcm_slots(count: int) -> tuple[Slot, ...]:
    return tuple(Slot(f"xcm-{n}", ("xcm",), srsim=n) for n in range(1, count + 1))


def iom_slots(count: int) -> tuple[Slot, ...]:
    return tuple(Slot(f"iom-{n}", ("line-card",), srsim=n) for n in range(1, count + 1))


def iom_chassis(chassis_id: str, ioms: int, cpm: str) -> Chassis:
    """A chassis with numbered IOM/IMM slots and two CPM slots A and B."""
    return Chassis(chassis_id, slots=(*iom_slots(ioms), *cpm_slots((cpm,), 2)))


def integrated_chassis(chassis_id: str, card: str) -> Chassis:
    """A single-container chassis whose integrated card SR-SIM runs as component slot A."""
    return Chassis(
        chassis_id, slots=(Slot("integrated", ("cpm",), srsim="A", types=(card,)),), integrated=card
    )


def fixed_chassis(
    model: Model,
    chassis_id: str,
    cpms: tuple[str, ...],
    cards: dict[str, str],
    variants: tuple[Variant, ...] = (),
) -> None:
    """A fixed chassis that SR-SIM runs as CPM slot A plus line card 1, one of each given type, each card
    with one built-in MDA; `variants` name the products when SR-SIM folds several into it."""
    for card, mda in cards.items():
        model.add_part(mda_card(card, "line-card", {1: mda}))

    def one_of(types: tuple[str, ...]) -> dict[str, Any]:
        return {"fixed": types[0]} if len(types) == 1 else {"types": types}

    model.chassis[chassis_id] = Chassis(
        chassis_id,
        slots=(
            Slot("cpm-a", ("cpm",), srsim="A", **one_of(cpms)),
            Slot("card-1", ("line-card",), srsim=1, **one_of(tuple(cards))),
        ),
        variants=variants,
    )


def fixed_platform(model: Model, chassis_id: str, cpm: str, card: str, mda: str) -> None:
    """A fixed chassis that SR-SIM runs as CPM slot A plus line card 1, both built in, with one built-in MDA."""
    fixed_chassis(model, chassis_id, (cpm,), {card: mda})


# -- data -----------------------------------------------------------------------------


def sr_s_family(model: Model) -> None:
    xma_s = ("s18-100gb-qsfp28", "s36-100gb-qsfp28", "s36-100gb-qsfp28-3.6t", "s36-400gb-qsfpdd")
    iom_s = ("iom-s-1.5t", "iom-s-3.0t")
    xma2_s_small = ("x2-s36-400g-qsfp112-3.0t", "x2-s36-800g-qsfpdd-6.0t")
    xma2_s_large = ("x2-s36-800g-qsfpdd-12.0t", "x2-s36-800g-qsfpdd-18.0t")
    xma2_s = (*xma2_s_small, *xma2_s_large)
    iom2_se = ("iom2-se-3.0t", "iom2-se-6.0t")
    # An SR-7s/14s runs as FP4 (S4 mode, SFM-s) or FP5 (S5 mode, SFM2-s); each XCM and CPM fits one
    # of them. FP5 takes FP4 XMA-s and IOM-s in an XCM-s-b next to FP5 modules in an XCM2-s.
    fp4, fp5 = ("sfm-s",), ("sfm2-s",)
    model.add_part(Part("cpm-s", "cpm", sfm=fp4))
    model.add_part(Part("cpm2-s", "cpm", sfm=fp5))
    for type_ in ("cpm-2s", "cpm-2se"):
        model.add_part(Part(type_, "cpm"))
    for type_, modules in (("xcm-7s", 1), ("xcm-14s", 2)):
        model.add_part(module_carrier(type_, "xcm", modules, (*xma_s, *iom_s), fp4))
    for type_, modules in (("xcm-7s-b", 1), ("xcm-14s-b", 2)):
        model.add_part(module_carrier(type_, "xcm", modules, (*xma_s, *iom_s), fp5))
    for type_, modules in (("xcm2-7s", 1), ("xcm2-14s", 2)):
        model.add_part(module_carrier(type_, "xcm", modules, (*xma2_s, *iom2_se), fp5))
    model.add_part(module_carrier("xcm-2s", "xcm", 1, (*xma_s, *iom_s)))
    model.add_part(module_carrier("xcm-2se", "xcm", 1, (*xma2_s, *iom2_se)))
    model.add_part(module_carrier("xcmc-2se", "xcm", 1, (*xma2_s_small, *iom2_se)))
    for type_ in (*xma_s, *xma2_s_large):
        model.add_part(Part(type_, "xma"))
    # One- and two-complex XMA2-s are provisioned as an XIOM whose single MDA is set automatically.
    model.add_part(mda_card("x2-s36-400g-qsfp112-3.0t", "iom", {1: "m36-400g-qsfp112"}))
    model.add_part(mda_card("x2-s36-800g-qsfpdd-6.0t", "iom", {1: "m36-800g-qsfpdd"}))
    for type_ in iom_s:
        model.add_part(iom(type_, 2))
    for type_ in iom2_se:
        model.add_part(iom(type_, 2))

    model.add_part(cma("cma-7s", "CMA-7s Single", "One CPM-s", "cpm-s", 1))
    model.add_part(
        cma("cma-7s-d", "CMA-7s Dual", "Two CPM-s; also takes XCM slot 6", "cpm-s", 2, occupies=("xcm-6",))
    )
    model.add_part(cma("cma2-7s", "CMA2-7s", "One or two CPM2-s", "cpm2-s", 2))
    model.add_part(cma("cma-14s", "CMA-14s", "One or two CPM-s", "cpm-s", 2))
    model.add_part(cma("cma2-14s", "CMA2-14s", "One or two CPM2-s", "cpm2-s", 2))

    model.chassis["sr-7s"] = Chassis(
        "sr-7s",
        slots=(*xcm_slots(6), Slot("cpm", ("cma",), types=("cma-7s", "cma-7s-d", "cma2-7s"))),
    )
    model.chassis["sr-14s"] = Chassis(
        "sr-14s",
        slots=(*xcm_slots(6), Slot("cpm", ("cma",), types=("cma-14s", "cma2-14s"))),
    )
    model.chassis["sr-2s"] = Chassis(
        "sr-2s",
        slots=(*xcm_slots(2), *cpm_slots(("cpm-2s",), 2)),
    )
    model.chassis["sr-2se"] = Chassis(
        "sr-2se",
        slots=(*xcm_slots(2), *cpm_slots(("cpm-2se",), 2)),
        exclusive=(("xcm-2se", "xcmc-2se"),),
    )

    model.add_part(module_carrier("cpm-1s", "cpm", 1))
    model.chassis["sr-1s"] = Chassis(
        "sr-1s",
        slots=(Slot("integrated", ("cpm",), srsim="A", types=("cpm-1s",)),),
        integrated="cpm-1s",
        variants=(
            # SR-SIM simulates each XMA-s at one license level; the one- and three-complex SR-7s/14s
            # XMA-s stand in for the lower levels of the two- and four-complex SR-1s.
            Variant(
                "SR-1s Fixed 2.4T",
                "Integrated FP4 two-complex XMA-s, 36x QSFP28; 1.6T to 2.4T by license",
                ("s36-100gb-qsfp28", "s18-100gb-qsfp28"),
            ),
            Variant(
                "SR-1s Fixed 4.8T",
                "Integrated FP4 four-complex XMA-s, 36x QSFP28 or QSFP-DD; 3.6T to 4.8T by license",
                ("s36-400gb-qsfpdd", "s36-100gb-qsfp28-3.6t"),
            ),
            Variant(
                "SR-1s Modular 3.0T",
                "Integrated FP4 two-complex IOM-s-3.0T with two MDA-s/MDA2-s slots",
                ("iom-s-3.0t",),
            ),
        ),
    )


def sr_1_fp5_family(model: Model) -> None:
    model.add_part(Part("cpm-1x", "cpm"))
    model.add_part(Part("cpm-1se", "cpm"))
    for chassis_id, card, mda in (
        ("sr-1x-48d", "i48-800g-qsfpdd-1x", "m48-800g-qsfpdd-1x"),
        ("sr-1x-92s", "i80-200g-sfpdd+12-800g-qsfpdd-1x", "m80-200g-sfpdd+12-800g-qsfpdd-1x"),
        ("sr-1-48d", "i48-400g-qsfpdd-1", "m48-400g-qsfpdd-1"),
        ("sr-1-24d", "i24-800g-qsfpdd-1", "m24-800g-qsfpdd-1"),
        ("sr-1-46s", "i40-200g-sfpdd+6-800g-qsfpdd-1", "m40-200g-sfpdd+6-800g-qsfpdd-1"),
        ("sr-1-92s", "i80-200g-sfpdd+12-400g-qsfpdd-1", "m80-200g-sfpdd+12-400g-qsfpdd-1"),
    ):
        fixed_platform(model, chassis_id, "cpm-1x", card, mda)
    # Same hardware as the SR-1-24D, sold as a different product.
    fixed_platform(
        model, "dms-1-24d", "cpm-1x", "dms24-800g-qsfpdd-1", "d24-800g-qsfpdd-1"
    )
    fixed_platform(model, "sr-1se", "cpm-1se", "imm36-800g-qsfpdd", "ms36-800g-qsfpdd")


def sr_classic_family(model: Model) -> None:
    """7750 SR-1/7/12/12e and 7450 ESS-7/12: IOMs with two MDA slots, IMMs with built-in MDAs."""
    model.add_part(mda_card("cpm-1", "cpm", {1: "", 2: ""}))
    model.chassis["sr-1"] = integrated_chassis("sr-1", "cpm-1")

    model.add_part(Part("cpm5", "cpm"))
    for type_ in ("iom4-e", "iom4-e-b", "iom4-e-hs", "iom5-e"):
        model.add_part(mda_card(type_, "line-card", {1: "", 2: ""}))
    # The pac IMM takes up to two configurable MDAs; the others provision their MDAs themselves.
    model.add_part(mda_card("imm-2pac-fp3", "line-card", {1: "", 2: ""}))
    model.add_part(mda_card("imm48-1gb-sfp-c", "line-card", {1: "imm24-1gb-xp-sfp", 2: "imm24-1gb-xp-sfp"}))
    model.add_part(mda_card("imm40-10gb-sfp", "line-card", {1: "m40-10g-sfp"}))
    model.add_part(mda_card("imm4-100gb-cfp4", "line-card", {1: "m4-100g-cfp4"}))
    for chassis_id, ioms in (
        ("sr-7", 5),
        ("ess-7", 5),
        ("sr-12", 10),
        ("ess-12", 10),
        ("sr-12e", 9),
    ):
        model.chassis[chassis_id] = iom_chassis(chassis_id, ioms, "cpm5")


def sr_e_family(model: Model) -> None:
    """7750 SR-1e/2e/3e: one to three IOM-e, each with four MDA-e slots."""
    model.add_part(Part("cpm-e", "cpm"))
    model.add_part(mda_card("iom-e", "line-card", dict.fromkeys(range(1, 5), "")))
    for ioms, chassis_id in enumerate(("sr-1e", "sr-2e", "sr-3e"), start=1):
        model.chassis[chassis_id] = iom_chassis(chassis_id, ioms, "cpm-e")


def sr_a_family(model: Model) -> None:
    """7750 SR-a4/a8: one or two IOM-a, each with four MDA-a slots."""
    model.add_part(Part("cpm-a", "cpm"))
    model.add_part(mda_card("iom-a", "line-card", dict.fromkeys(range(1, 5), "")))
    model.chassis["sr-a4"] = iom_chassis("sr-a4", 1, "cpm-a")
    model.chassis["sr-a8"] = iom_chassis("sr-a8", 2, "cpm-a")


def xrs_family(model: Model) -> None:
    """7950 XRS-20/20e: ten XCM slots with two XMA slots each, and redundant CPMs."""
    cpms = ("cpm-x20", "cpm2-x20")
    for type_ in cpms:
        model.add_part(Part(type_, "cpm"))
    for type_ in ("xcm-x20", "xcm2-x20"):
        model.add_part(mda_card(type_, "xcm", {1: "", 2: ""}))
    for chassis_id in ("xrs-20", "xrs-20e"):
        model.chassis[chassis_id] = Chassis(chassis_id, slots=(*xcm_slots(10), *cpm_slots(cpms, 2)))


def sar_family(model: Model) -> None:
    """7705 SAR: single-container chassis with numbered MDA slots, mostly holding built-in MDAs."""
    isa = "isa-ms-v"
    model.add_part(mda_card("iom-sar", "cpm", {1: "m10-sfp++6-sfp", 2: isa, 3: isa}))
    model.chassis["sar-1"] = integrated_chassis("sar-1", "iom-sar")
    # SAR-Hx and SAR-Mx: one pluggable MDA slot next to the built-in ports.
    model.add_part(mda_card("iom-sar-1x", "cpm", {1: "", 2: "m4-1g-rj+6-10g-sfp++2-25g-sfp28", 3: isa, 4: isa}))
    for chassis_id in ("sar-hx", "sar-mx"):
        model.chassis[chassis_id] = integrated_chassis(chassis_id, "iom-sar-1x")
    # SAR-Hm and SAR-Hmc have no MDA slots to fill; the default layout places each integrated MDA.
    hm = {1: "i2-cellular", 2: "i6-10/100eth-tx", 3: "i2-sdi", 4: "i1-wlan", 5: isa, 6: isa}
    model.add_part(mda_card("cpm-sar-hm", "cpm", hm))
    model.chassis["sar-hm"] = integrated_chassis("sar-hm", "cpm-sar-hm")
    # The SAR-Hmc has no WLAN, so its MDA slot 4 stays empty.
    hmc: dict[int, str | None] = {1: "i2-cellular", 2: "i3-10/100eth-tx", 3: "i2-sdi", 4: None, 5: isa, 6: isa}
    model.add_part(mda_card("cpm-sar-hmc", "cpm", hmc))
    model.chassis["sar-hmc"] = integrated_chassis("sar-hmc", "cpm-sar-hmc")


def ixr_family(model: Model) -> None:
    """7250 IXR: line-card slots 1-N and CPM slots A/B, fixed platforms, and single-container systems."""
    # IXR-6 has four line-card slots and IXR-10 eight.
    model.add_part(Part("cpm-ixr", "cpm"))
    imms = {"imm36-100g-qsfp28": "m36-100g-qsfp28", "imm48-sfp+2-qsfp28": "m48-sfp+2-qsfp28"}
    for card, mda in imms.items():
        model.add_part(mda_card(card, "line-card", {1: mda}))
    for chassis_id, slots in (("ixr-6", 4), ("ixr-10", 8)):
        model.chassis[chassis_id] = iom_chassis(chassis_id, slots, "cpm-ixr")

    # IXR-R4: four MDA slots, m20-1g-csfp only in 1-3, and the integrated MDA as mda/5.
    r_mdas = ("m10-10g-sfp+", "m4-10g-sfp++1-100g-cfp2", "m6-10g-sfp++1-100g-qsfp28", "m6-10g-sfp++4-25g-sfp28")
    model.add_part(Part("cpm-ixr-r4", "cpm"))
    for type_ in (*r_mdas, "m20-1g-csfp", "a32-chds1v2"):
        model.add_part(Part(type_, "mda"))
    r4_slots = (
        *(Slot(f"mda-{n}", ("mda",), srsim=n, types=(*r_mdas, "m20-1g-csfp")) for n in (1, 2, 3)),
        Slot("mda-4", ("mda",), srsim=4, types=r_mdas),
        Slot("mda-5", ("mda",), srsim=5, fixed="m10-1g-sfp+2-10g-sfp+"),
    )
    model.add_part(Part("iom-ixr-r4", "line-card", r4_slots))
    model.chassis["ixr-r4"] = Chassis(
        "ixr-r4", slots=(Slot("card-1", ("line-card",), srsim=1, fixed="iom-ixr-r4"), *cpm_slots(("cpm-ixr-r4",), 2))
    )

    # IXR-R6: one CPIOM per CPM slot, six MDA slots, m20-1g-csfp only in 3-4 and a32-chds1v2 only in 5-6.
    r6_slots = (
        *(Slot(f"mda-{n}", ("mda",), srsim=n, types=r_mdas) for n in (1, 2)),
        *(Slot(f"mda-{n}", ("mda",), srsim=n, types=(*r_mdas, "m20-1g-csfp")) for n in (3, 4)),
        *(Slot(f"mda-{n}", ("mda",), srsim=n, types=(*r_mdas, "a32-chds1v2")) for n in (5, 6)),
    )
    model.add_part(Part("cpiom-ixr-r6", "cpm", r6_slots))
    model.chassis["ixr-r6"] = Chassis(
        "ixr-r6", slots=cpm_slots(("cpiom-ixr-r6",), 2), integrated="cpiom-ixr-r6"
    )

    # The IXR-R6d and IXR-R6dl share the CPM and the IOM with six MDA slots. The R6d takes slim MDAs, the
    # R6dl wide ones: physically different even under the same name, and the 46-port SFP+ and 80-port cSFP
    # MDAs exist only wide.
    model.add_part(Part("cpm-ixr-r6d", "cpm"))
    model.add_part(iom_ixr_r6d := mda_card("iom-ixr-r6d", "line-card", dict.fromkeys(range(1, 7), "")))
    slim = (
        "m1-400g-qsfpdd+1-100g-qsfp28",
        "m10-50g-sfp56",
        "m18-25g-sfp28",
        "m2-100g-qsfp28+16-10g-sfp+",
        "m2-cfp2",
        "m20-10g-sfp+",
        "m32-1g-csfp",
        "m5-100g-qsfp28",
    )
    wide = (*slim, "m46-10g-sfp+", "m80-1g-csfp")
    for chassis_id, mdas in (("ixr-r6d", slim), ("ixr-r6dl", wide)):
        model.chassis[chassis_id] = Chassis(
            chassis_id,
            slots=(Slot("card-1", ("line-card",), srsim=1, fixed=iom_ixr_r6d.type), *cpm_slots(("cpm-ixr-r6d",), 2)),
            card_mdas=((iom_ixr_r6d.type, mdas),),
        )

    for cpm in ("cpm-ixr-x", "cpm-ixr-s", "cpm-ixr-e", "cpm-ixr-e-gnss"):
        model.add_part(Part(cpm, "cpm"))
    fixed_chassis(model, "ixr-x3", ("cpm-ixr-x",), {"imm36-qsfpdd": "m36-qsfpdd"})
    fixed_chassis(model, "ixr-s", ("cpm-ixr-s",), {"imm48-sfp++6-qsfp28": "m48-sfp++6-qsfp28"})
    # SR-SIM runs the IXR-X1 and IXR-Xs as one chassis type, and the four IXR-e models as another; the IMM
    # (and the GNSS CPM) tells the products apart.
    x1, xs = "imm32-qsfp28+4-qsfpdd", "imm6-qsfpdd+48-sfp56"
    fixed_chassis(
        model,
        "ixr-x",
        ("cpm-ixr-x",),
        {x1: "m32-qsfp28+4-qsfpdd", xs: "m6-qsfpdd+48-sfp56"},
        variants=(
            Variant("IXR-X1", "32x 100G QSFP28 + 4x 400G QSFP-DD", (x1,)),
            Variant("IXR-Xs", "48x 50G SFP56 + 6x 400G QSFP-DD", (xs,)),
        ),
    )
    big, small = "imm24-sfp++8-sfp28+2-qsfp28", "imm14-10g-sfp++4-1g-tx"
    big_ports, small_ports = "24x 10G SFP+ + 8x 25G SFP28 + 2x 100G QSFP28", "14x 10G SFP+ + 4x 1G RJ-45"
    fixed_chassis(
        model,
        "ixr-e",
        ("cpm-ixr-e", "cpm-ixr-e-gnss"),
        {big: "m24-sfp++8-sfp28+2-qsfp28", small: "m14-10g-sfp++4-1g-tx"},
        variants=(
            Variant("IXR-e Big", big_ports, ("cpm-ixr-e", big)),
            Variant("IXR-e Big GNSS", f"{big_ports}; GNSS receiver", ("cpm-ixr-e-gnss", big)),
            Variant("IXR-e Small", small_ports, ("cpm-ixr-e", small)),
            Variant("IXR-e Small GNSS", f"{small_ports}; GNSS receiver", ("cpm-ixr-e-gnss", small)),
        ),
    )

    # Single-container systems: the CPM carries the ports as one built-in MDA.
    for chassis_id, card, mda in (
        ("ixr-ec", "cpm-ixr-ec", "m4-1g-tx+20-1g-sfp+6-10g-sfp+"),
        ("ixr-e2", "cpm-ixr-e2", "m2-qsfpdd+2-qsfp28+24-sfp28"),
        ("ixr-e2c", "cpm-ixr-e2c", "m12-sfp28+2-qsfp28"),
        ("ixr-e2n", "cpm-ixr-e2n", "m4-sfp+4-sfp+"),
        ("ixr-e2sc", "cpm-ixr-e2sc", "m16-sfp++4-sfp28"),
        ("ixr-e3c", "cpm-ixr-e3c", "m4-qsfp28+16-sfp28+8-sfp56"),
        ("ixr-e3x", "cpm-ixr-e3x", "m16-sfp112+15-sfp56+6-qsfpdd"),
    ):
        model.add_part(mda_card(card, "cpm", {1: mda}))
        model.chassis[chassis_id] = integrated_chassis(chassis_id, card)
    # IXR-e2n-s: SR-SIM runs it as either type in slot A, both with the same built-in MDA.
    for card in ("imm4-sfp+4-sfp+-s", "cpm-ixr-e2n-s"):
        model.add_part(mda_card(card, "cpm", {1: "m4-sfp+4-sfp+-s"}))
    model.chassis["ixr-e2n-s"] = Chassis(
        "ixr-e2n-s",
        slots=(Slot("integrated", ("cpm",), srsim="A", types=("imm4-sfp+4-sfp+-s", "cpm-ixr-e2n-s")),),
        integrated="imm4-sfp+4-sfp+-s",
    )


def build_model() -> Model:
    model = Model()
    sr_s_family(model)
    sr_1_fp5_family(model)
    sr_classic_family(model)
    sr_e_family(model)
    sr_a_family(model)
    xrs_family(model)
    sar_family(model)
    ixr_family(model)
    check_model(model)
    return model


def check_model(model: Model) -> None:
    """Fail on references that point nowhere, so a typo cannot silently weaken a rule."""
    for part in model.parts.values():
        for slot in part.slots:
            for type_ in slot.types:
                if type_ not in model.parts:
                    raise ValueError(f"{part.type}.{slot.id} names unknown part {type_}")
    for chassis in model.chassis.values():
        slot_ids = {slot.id for slot in chassis.slots}
        for slot in chassis.slots:
            if slot.fixed and slot.fixed not in model.parts:
                raise ValueError(f"{chassis.id}.{slot.id} has unknown built-in part {slot.fixed}")
            for type_ in slot.types:
                part = model.parts.get(type_)
                if part is None:
                    raise ValueError(f"{chassis.id}.{slot.id} names unknown part {type_}")
                missing = set(part.occupies) - slot_ids
                if missing:
                    raise ValueError(f"{type_} occupies {sorted(missing)}, which {chassis.id} does not have")
        for group in chassis.exclusive:
            for type_ in group:
                if type_ not in model.parts:
                    raise ValueError(f"{chassis.id} exclusive group names unknown part {type_}")
        if chassis.integrated and chassis.integrated not in model.parts:
            raise ValueError(f"{chassis.id} integrated card {chassis.integrated} is not a part")


# -- export ---------------------------------------------------------------------------


def _slot_json(slot: Slot) -> dict[str, Any]:
    data: dict[str, Any] = {"id": slot.id, "accepts": list(slot.accepts)}
    if slot.srsim is not None:
        data["srsim"] = slot.srsim
    if slot.types:
        data["types"] = list(slot.types)
    if slot.fixed:
        data["fixed"] = slot.fixed
    return data


def model_json(model: Model) -> dict[str, Any]:
    parts = {}
    for type_, part in sorted(model.parts.items()):
        data: dict[str, Any] = {"kind": part.kind}
        if part.slots:
            data["slots"] = [_slot_json(slot) for slot in part.slots]
        if part.occupies:
            data["occupies"] = list(part.occupies)
        if part.sfm:
            data["sfm"] = list(part.sfm)
        if part.label:
            data["label"] = part.label
        if part.description:
            data["description"] = part.description
        parts[type_] = data
    chassis = {}
    for chassis_id, item in sorted(model.chassis.items()):
        data = {"slots": [_slot_json(slot) for slot in item.slots]}
        if item.exclusive:
            data["exclusive"] = [list(group) for group in item.exclusive]
        if item.integrated:
            data["integrated"] = item.integrated
        if item.card_mdas:
            data["card_mdas"] = {card: list(mdas) for card, mdas in item.card_mdas}
        if item.variants:
            data["variants"] = [
                {"name": v.name, "description": v.description, "parts": list(v.parts)}
                for v in item.variants
            ]
        chassis[chassis_id] = data
    return {"version": MODEL_VERSION, "parts": parts, "chassis": chassis}


# -- validation -----------------------------------------------------------------------


@dataclass(frozen=True)
class Issue:
    code: str
    path: str
    message: str


def _items(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _slot(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _placement_issue(owner: str, slots: tuple[Slot, ...], slot: Slot, type_: str, path: str) -> Issue | None:
    """A part of type_ in slot of owner (a chassis or card with these slots) that cannot be there."""
    if not type_:
        return None
    if slot.fixed:
        if type_ == slot.fixed:
            return None
        return Issue("fixed", path, f"slot {slot.srsim} of {owner} has the built-in {slot.fixed}, not {type_}")
    homes = [str(other.srsim) for other in slots if other.fixed == type_]
    if homes:
        return Issue("built-in", path, f"{type_} is built into slot {', '.join(homes)} of {owner}, not slot {slot.srsim}")
    if slot.types and type_ not in slot.types:
        fits = [str(other.srsim) for other in slots if type_ in other.types]
        if fits:
            return Issue("slot-type", path, f"{type_} fits slot {', '.join(fits)} of {owner}, not slot {slot.srsim}")
        return Issue("slot-type", path, f"slot {slot.srsim} of {owner} takes {', '.join(slot.types)}, not {type_}")
    return None


def _nested_issues(part: Part, items: list[dict[str, Any]], path: str, code: str, what: str) -> list[Issue]:
    """Items placed in the slots of part: each needs an existing slot that can hold its type."""
    slots = {str(slot.srsim): slot for slot in part.slots if slot.accepts}
    empty = {str(slot.srsim) for slot in part.slots if not slot.accepts}
    issues: list[Issue] = []
    for item in items:
        slot_text = _slot(item.get("slot"))
        if not slot_text:
            continue
        slot = slots.get(slot_text)
        item_path = f"{path}[{slot_text}]"
        if slot_text in empty:
            issues.append(Issue("empty-slot", item_path, f"slot {slot_text} of {part.type} takes no {what}"))
            continue
        if slot is None:
            plural = "s" if len(slots) > 1 else ""
            issues.append(Issue(code, item_path, f"{part.type} has {what} slot{plural} {', '.join(sorted(slots))}, not {slot_text}"))
            continue
        issue = _placement_issue(part.type, part.slots, slot, str(item.get("type") or ""), item_path)
        if issue:
            issues.append(issue)
    return issues


def _module_issues(model: Model, part: Part, component: dict[str, Any], path: str) -> list[Issue]:
    """Modules or MDAs on a card, and MDAs on the IOMs in its module slots."""
    issues: list[Issue] = []
    what = "module" if any("iom" in slot.accepts for slot in part.slots) else "MDA"
    for key in ("mda", "xiom"):
        issues.extend(_nested_issues(part, _items(component.get(key)), f"{path}.{key}", "module-slot", what))
    direct = {_slot(item.get("slot")) for item in _items(component.get("mda"))}
    for slot in sorted(direct & {_slot(item.get("slot")) for item in _items(component.get("xiom"))} - {""}):
        issues.append(Issue("module-taken", f"{path}.xiom[{slot}]", f"module slot {slot} holds either an XMA or an IOM, not both"))
    for xiom in _items(component.get("xiom")):
        iom_part = model.parts.get(str(xiom.get("type", "")))
        if iom_part and iom_part.kind == "iom":
            mda_path = f"{path}.xiom[{_slot(xiom.get('slot'))}].mda"
            issues.extend(_nested_issues(iom_part, _items(xiom.get("mda")), mda_path, "mda-slot", "MDA"))
    return issues


def _chassis_mda_issues(chassis: Chassis, card_type: str, component: dict[str, Any], path: str) -> list[Issue]:
    """MDAs that this chassis's own version of the card cannot take (e.g. a wide MDA in an IXR-R6d)."""
    allowed = dict(chassis.card_mdas).get(card_type)
    if allowed is None:
        return []
    return [
        Issue("chassis-mda", f"{path}.mda[{_slot(item.get('slot'))}]", f"the {chassis.id} has no {item.get('type')} for its {card_type}")
        for item in _items(component.get("mda"))
        if item.get("type") and item.get("type") not in allowed
    ]


def display_name(part: Part) -> str:
    """The part's name, e.g. "CMA-7s Dual" for cma-7s-d; the provisioning string when it has none."""
    return part.label or part.type


def _carrier_fit(carrier: Part, cpms: list[dict[str, Any]], used: set[str]) -> str:
    """"fits", "occupied" (the CPMs fit, but the carrier would block a used slot) or "mismatch"."""
    letters = {str(slot.srsim): slot for slot in carrier.slots}
    for cpm in cpms:
        slot = letters.get(_slot(cpm.get("slot")).upper())
        type_ = str(cpm.get("type") or "")
        if slot is None or (type_ and type_ not in slot.types):
            return "mismatch"
    return "occupied" if used & set(carrier.occupies) else "fits"


def _cpm_issues(model: Model, chassis: Chassis, cpms: list[dict[str, Any]], used: dict[str, str]) -> list[Issue]:
    carrier_slot = next((slot for slot in chassis.slots if "cma" in slot.accepts), None)
    if carrier_slot is None:
        cpm_slots = {str(slot.srsim): slot for slot in chassis.slots if "cpm" in slot.accepts}
        issues = []
        for cpm in cpms:
            slot = _slot(cpm.get("slot")).upper()
            if slot not in cpm_slots:
                issues.append(
                    Issue("no-such-slot", slot, f"{chassis.id} has CPM slots {', '.join(sorted(cpm_slots))}, not {slot}")
                )
                continue
            issue = _placement_issue(chassis.id, chassis.slots, cpm_slots[slot], str(cpm.get("type") or ""), slot)
            if issue:
                issues.append(issue)
        return issues

    carriers = [model.parts[type_] for type_ in carrier_slot.types]
    fit = {carrier.type: _carrier_fit(carrier, cpms, set(used)) for carrier in carriers}
    if "fits" in fit.values():
        return []
    blocked = [carrier for carrier in carriers if fit[carrier.type] == "occupied"]
    if blocked:
        carrier = blocked[0]
        taken = ", ".join(used[slot_id] for slot_id in carrier.occupies if slot_id in used)
        return [
            Issue(
                "occupied",
                taken,
                f"these CPMs need the {display_name(carrier)}, which also takes line-card slot {taken}",
            )
        ]
    options = "; ".join(display_name(carrier) for carrier in carriers)
    return [Issue("cpm-carrier", ",".join(_slot(c.get("slot")) for c in cpms), f"no CPM adapter fits these CPMs ({options})")]


def _sfm_issues(model: Model, items: list[dict[str, Any]], sfm: str) -> list[Issue]:
    issues = []
    for item in items:
        part = model.parts.get(str(item.get("type") or ""))
        if sfm and part and part.sfm and sfm not in part.sfm:
            issues.append(Issue("sfm", _slot(item.get("slot")), f"{part.type} works only with {', '.join(part.sfm)}, not {sfm}"))
    return issues


def hardware_issues(model: Model, chassis_id: str, components: list[Any], sfm: str = "") -> list[Issue]:
    """Problems that make a component list impossible in hardware; [] for unmodelled chassis."""
    chassis = model.chassis.get(chassis_id.strip().lower())
    if chassis is None:
        return []
    items = _items(components)

    if chassis.integrated:
        part = model.parts[chassis.integrated]
        slot = next(slot for slot in chassis.slots if slot.srsim == "A")
        issues = []
        for component in items:
            issue = _placement_issue(chassis.id, chassis.slots, slot, str(component.get("type") or ""), "A")
            issues.extend([issue] if issue else [])
            issues.extend(_module_issues(model, part, component, "A"))
        return issues

    issues: list[Issue] = []
    line_slots = {str(slot.srsim): slot for slot in chassis.slots if slot.srsim is not None and "cpm" not in slot.accepts}
    cpms: list[dict[str, Any]] = []
    cards: list[dict[str, Any]] = []
    for item in items:
        (cpms if re.fullmatch(r"[A-Za-z]", _slot(item.get("slot"))) else cards).append(item)
    used: dict[str, str] = {}
    line_types: set[str] = set()
    for card in cards:
        slot_text = _slot(card.get("slot"))
        slot = line_slots.get(slot_text)
        if slot is None:
            plural = "s" if len(line_slots) > 1 else ""
            issues.append(
                Issue(
                    "no-such-slot",
                    slot_text,
                    f"{chassis.id} has line-card slot{plural} {', '.join(line_slots)}, not {slot_text or '(none)'}",
                )
            )
            continue
        used[slot.id] = slot_text
        type_ = str(card.get("type") or "")
        issue = _placement_issue(chassis.id, chassis.slots, slot, type_, slot_text)
        if issue:
            issues.append(issue)
            continue
        # A built-in card is there even when the component leaves its type out.
        part = model.parts.get(type_ or slot.fixed)
        if part is None:
            continue
        line_types.add(part.type)
        if part.kind not in slot.accepts:
            issues.append(Issue("slot-kind", slot_text, f"slot {slot_text} takes {'/'.join(slot.accepts)}, not {part.type}"))
            continue
        issues.extend(_module_issues(model, part, card, slot_text))
        issues.extend(_chassis_mda_issues(chassis, part.type, card, slot_text))

    issues.extend(_cpm_issues(model, chassis, cpms, used))
    issues.extend(_sfm_issues(model, items, sfm))
    for group in chassis.exclusive:
        mixed = sorted(line_types & set(group))
        if len(mixed) > 1:
            issues.append(Issue("mixed-types", "", f"{' and '.join(mixed)} cannot be installed in the same chassis"))
    return issues


def line_card_slots(model: Model, chassis_id: str) -> list[int]:
    """SR-SIM component slots for line cards; [] when the chassis is not modelled or integrated."""
    chassis = model.chassis.get(chassis_id)
    if chassis is None or chassis.integrated:
        return []
    return [slot.srsim for slot in chassis.slots if isinstance(slot.srsim, int)]


def iom_mda_slots(model: Model) -> list[int]:
    return sorted({slot.srsim for part in model.parts.values() if part.kind == "iom" for slot in part.slots})


def integrated_card(model: Model, chassis_id: str) -> str:
    chassis = model.chassis.get(chassis_id)
    return chassis.integrated if chassis else ""


def card_slots(model: Model, card_type: str) -> list[int]:
    """SR-SIM mda/xiom slots of a component card; [] when the model does not know the card."""
    part = model.parts.get(card_type)
    if part is None or part.kind == "cma":
        return []
    return [slot.srsim for slot in part.slots if isinstance(slot.srsim, int) and slot.accepts]


def mda_slots_for(model: Model, card_type: str, mda_type: str) -> list[int]:
    """The slots of a known card that can hold mda_type (built-in parts only fit their own slot)."""
    part = model.parts.get(card_type)
    if part is None or part.kind == "cma":
        return []
    return [
        slot.srsim
        for slot in part.slots
        if isinstance(slot.srsim, int) and slot.accepts and _placement_issue(part.type, part.slots, slot, mda_type, "") is None
    ]
