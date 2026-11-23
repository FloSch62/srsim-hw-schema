"""Physical hardware model that the SR-SIM appendix data is mapped onto.

The appendix says which part types fit together; this model adds what it cannot express:
slot counts, parts that share space or must not be mixed, and chassis variants.
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


@dataclass(frozen=True)
class Part:
    type: str
    kind: str
    slots: tuple[Slot, ...] = ()
    # Other slots of the parent that this part blocks (a dual-slot CMA).
    occupies: tuple[str, ...] = ()
    label: str = ""


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


@dataclass
class Model:
    parts: dict[str, Part] = field(default_factory=dict)
    chassis: dict[str, Chassis] = field(default_factory=dict)

    def add_part(self, part: Part) -> None:
        if part.type in self.parts and self.parts[part.type] != part:
            raise ValueError(f"part {part.type} defined twice with different facts")
        self.parts[part.type] = part


# -- builders -------------------------------------------------------------------------


def module_carrier(type_: str, kind: str, modules: int) -> Part:
    """An XCM (or integrated card) with module slots, each holding one XMA or one IOM."""
    return Part(
        type=type_,
        kind=kind,
        slots=tuple(Slot(f"module-{n}", ("xma", "iom"), srsim=n) for n in range(1, modules + 1)),
    )


def iom(type_: str, mdas: int) -> Part:
    return Part(
        type=type_,
        kind="iom",
        slots=tuple(Slot(f"mda-{n}", ("mda",), srsim=n) for n in range(1, mdas + 1)),
    )


def cpm_slots(cpm_types: tuple[str, ...], count: int) -> tuple[Slot, ...]:
    return tuple(Slot(f"cpm-{letter.lower()}", ("cpm",), srsim=letter, types=cpm_types) for letter in "AB"[:count])


def cma(type_: str, label: str, cpm: str, cpms: int, occupies: tuple[str, ...] = ()) -> Part:
    """Control-module adapter: SR-SIM does not know it, only the CPMs it holds (slots A and B)."""
    return Part(type_, "cma", cpm_slots((cpm,), cpms), occupies=occupies, label=label)


def xcm_slots(count: int) -> tuple[Slot, ...]:
    return tuple(Slot(f"xcm-{n}", ("xcm",), srsim=n) for n in range(1, count + 1))


# -- data -----------------------------------------------------------------------------


def sr_s_family(model: Model) -> None:
    for type_ in ("cpm-s", "cpm2-s", "cpm-2s", "cpm-2se"):
        model.add_part(Part(type_, "cpm"))
    for type_ in ("xcm-7s", "xcm-7s-b", "xcm2-7s"):
        model.add_part(module_carrier(type_, "xcm", 1))
    for type_ in ("xcm-14s", "xcm-14s-b", "xcm2-14s"):
        model.add_part(module_carrier(type_, "xcm", 2))
    model.add_part(module_carrier("xcm-2s", "xcm", 1))
    for type_ in ("xcm-2se", "xcmc-2se"):
        model.add_part(module_carrier(type_, "xcm", 1))
    for type_ in (
        "s18-100gb-qsfp28",
        "s36-100gb-qsfp28",
        "s36-100gb-qsfp28-3.6t",
        "s36-400gb-qsfpdd",
        "x2-s36-400g-qsfp112-3.0t",
        "x2-s36-800g-qsfpdd-6.0t",
        "x2-s36-800g-qsfpdd-12.0t",
        "x2-s36-800g-qsfpdd-18.0t",
    ):
        model.add_part(Part(type_, "xma"))
    for type_ in ("iom-s-1.5t", "iom-s-3.0t"):
        model.add_part(iom(type_, 2))
    for type_ in ("iom2-se-3.0t", "iom2-se-6.0t"):
        model.add_part(iom(type_, 2))

    model.add_part(cma("cma-7s", "CMA-7s (one CPM-s)", "cpm-s", 1))
    model.add_part(cma("cma-7s-d", "CMA-7s dual (two CPM-s)", "cpm-s", 2, occupies=("xcm-6",)))
    model.add_part(cma("cma2-7s", "CMA2-7s (one or two CPM2-s)", "cpm2-s", 2))
    model.add_part(cma("cma-14s", "CMA-14s (one or two CPM-s)", "cpm-s", 2))
    model.add_part(cma("cma2-14s", "CMA2-14s (one or two CPM2-s)", "cpm2-s", 2))

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


def build_model() -> Model:
    model = Model()
    sr_s_family(model)
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
    return data


def model_json(model: Model) -> dict[str, Any]:
    parts = {}
    for type_, part in sorted(model.parts.items()):
        data: dict[str, Any] = {"kind": part.kind}
        if part.slots:
            data["slots"] = [_slot_json(slot) for slot in part.slots]
        if part.occupies:
            data["occupies"] = list(part.occupies)
        if part.label:
            data["label"] = part.label
        parts[type_] = data
    chassis = {}
    for chassis_id, item in sorted(model.chassis.items()):
        data = {"slots": [_slot_json(slot) for slot in item.slots]}
        if item.exclusive:
            data["exclusive"] = [list(group) for group in item.exclusive]
        if item.integrated:
            data["integrated"] = item.integrated
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


def _module_issues(model: Model, part: Part, component: dict[str, Any], path: str) -> list[Issue]:
    """Modules on an XCM or integrated card, and MDAs on the IOMs in them."""
    issues: list[Issue] = []
    module_slots = {str(slot.srsim) for slot in part.slots}
    for key in ("mda", "xiom"):
        for item in _items(component.get(key)):
            slot = _slot(item.get("slot"))
            if slot and slot not in module_slots:
                issues.append(
                    Issue(
                        "module-slot",
                        f"{path}.{key}[{slot}]",
                        f"{part.type} has module slot{'s' if len(module_slots) > 1 else ''} "
                        f"{', '.join(sorted(module_slots))}, not {slot}",
                    )
                )
    direct = {_slot(item.get("slot")) for item in _items(component.get("mda"))}
    for slot in sorted(direct & {_slot(item.get("slot")) for item in _items(component.get("xiom"))} - {""}):
        issues.append(Issue("module-taken", f"{path}.xiom[{slot}]", f"module slot {slot} holds either an XMA or an IOM, not both"))
    for xiom in _items(component.get("xiom")):
        iom_part = model.parts.get(str(xiom.get("type", "")))
        if not iom_part or iom_part.kind != "iom":
            continue
        mda_slots = {str(slot.srsim) for slot in iom_part.slots}
        for mda in _items(xiom.get("mda")):
            slot = _slot(mda.get("slot"))
            if slot and slot not in mda_slots:
                issues.append(
                    Issue(
                        "mda-slot",
                        f"{path}.xiom[{_slot(xiom.get('slot'))}].mda[{slot}]",
                        f"{iom_part.type} has MDA slots {', '.join(sorted(mda_slots))}, not {slot}",
                    )
                )
    return issues


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
                f"these CPMs need the {carrier.label or carrier.type}, which also takes line-card slot {taken}",
            )
        ]
    options = "; ".join(carrier.label or carrier.type for carrier in carriers)
    return [Issue("cpm-carrier", ",".join(_slot(c.get("slot")) for c in cpms), f"no CPM adapter fits these CPMs ({options})")]


def hardware_issues(model: Model, chassis_id: str, components: list[Any]) -> list[Issue]:
    """Problems that make a component list impossible in hardware; [] for unmodelled chassis."""
    chassis = model.chassis.get(chassis_id.strip().lower())
    if chassis is None:
        return []
    items = _items(components)

    if chassis.integrated:
        part = model.parts[chassis.integrated]
        return [issue for component in items for issue in _module_issues(model, part, component, "A")]

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
            issues.append(
                Issue(
                    "no-such-slot",
                    slot_text,
                    f"{chassis.id} has line-card slots 1 to {len(line_slots)}, not {slot_text or '(none)'}",
                )
            )
            continue
        used[slot.id] = slot_text
        part = model.parts.get(str(card.get("type") or ""))
        if part is None:
            continue
        line_types.add(part.type)
        if part.kind not in slot.accepts:
            issues.append(Issue("slot-kind", slot_text, f"slot {slot_text} takes {'/'.join(slot.accepts)}, not {part.type}"))
            continue
        issues.extend(_module_issues(model, part, card, slot_text))

    issues.extend(_cpm_issues(model, chassis, cpms, used))
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


def module_slot_count(model: Model, card_type: str) -> int | None:
    """Module slots of an XCM or integrated card; None when the model does not know the card."""
    part = model.parts.get(card_type)
    if part is None or part.kind not in {"xcm", "cpm"} or not part.slots:
        return None
    return len(part.slots)
