import json
import unittest
from pathlib import Path

import hardware_model
import srsim_hw_schema as srsim

ROOT = Path(__file__).resolve().parents[1]
MODEL = hardware_model.build_model()
# Appendix pairings that the hardware rules out: CPM2-s runs only in an FP5 (SFM2-s) system, and
# FP2 cards fail at the fabric speed SFM6 needs.
APPENDIX_ERRORS = {("cpm2-s", "sfm-s"), ("imm48-1gb-sfp-c", "m-sfm6-7/12")}


def placeable_cpms(chassis: hardware_model.Chassis) -> set[str]:
    types: set[str] = set()
    for slot in chassis.slots:
        if "cpm" in slot.accepts:
            types.update(slot.types or (slot.fixed,))
        if "cma" in slot.accepts:
            types.update(t for cma in slot.types for cpm_slot in MODEL.parts[cma].slots for t in cpm_slot.types)
    return types


def placeable(card: hardware_model.Part, type_: str) -> bool:
    """Some slot of the card takes parts of this kind and can hold this type; unknown types are MDAs."""
    kind = MODEL.parts[type_].kind if type_ in MODEL.parts else "mda"
    fitting = hardware_model.mda_slots_for(MODEL, card.type, type_)
    return any(kind in slot.accepts and slot.srsim in fitting for slot in card.slots)


class HardwareModelTest(unittest.TestCase):
    def test_shared_cases(self) -> None:
        for case in json.loads((ROOT / "tests/hardware-cases.json").read_text()):
            with self.subTest(case["name"]):
                issues = hardware_model.hardware_issues(MODEL, case["chassis"], case["components"], case.get("sfm", ""))
                self.assertEqual([{"code": i.code, "path": i.path} for i in issues], case["issues"])

    def test_every_appendix_part_maps_onto_the_model(self) -> None:
        # A type the model cannot place is a gap in the model, not something to work around.
        matrix = srsim.build_clab_matrix(json.loads((ROOT / "srsim-supported-hardware.json").read_text()))
        for chassis_id, chassis in MODEL.chassis.items():
            entry = matrix["chassis"][chassis_id]
            cpms, cards = srsim.chassis_card_classes(entry)
            compatibility = srsim.card_compatibility(entry)
            line_kinds = {kind for slot in chassis.slots if isinstance(slot.srsim, int) for kind in slot.accepts}
            with self.subTest(chassis_id):
                self.assertLessEqual(set(cpms), placeable_cpms(chassis))
                for card in cards:
                    self.assertIn(MODEL.parts[card].kind, line_kinds, card)
                for slot in chassis.slots:
                    if slot.fixed:
                        self.assertIn(slot.fixed, {*cpms, *cards}, slot.id)
                for card, offered in compatibility.items():
                    part = MODEL.parts[card]
                    if part.sfm:
                        wrong = {sfm for sfm in offered["sfm"] if (card, sfm) in APPENDIX_ERRORS}
                        self.assertLessEqual(set(offered["sfm"]) - wrong, set(part.sfm), f"{card}: SFM")
                    for module in offered["direct_mda"]:
                        self.assertTrue(placeable(part, module), f"{card}: {module}")
                    for xiom, mdas in offered["xiom_mda"].items():
                        self.assertTrue(placeable(part, xiom), f"{card}: {xiom}")
                        for mda in mdas:
                            self.assertTrue(placeable(MODEL.parts[xiom], mda), f"{xiom}: {mda}")
                    # Built-in parts must be ones the appendix offers for that card.
                    for slot in part.slots:
                        if slot.fixed:
                            self.assertIn(slot.fixed, offered["direct_mda"], f"{card}.{slot.id}")
                offered_types = {*cpms, *cards}
                for offered in compatibility.values():
                    offered_types.update(offered["direct_mda"], offered["xiom"], offered["sfm"])
                for variant in chassis.variants:
                    self.assertLessEqual({*variant.parts, *variant.sfm}, offered_types, variant.name)
                for card, mdas in chassis.card_mdas:
                    self.assertEqual(set(mdas), set(compatibility[card]["direct_mda"]), f"{card} MDAs")

    def test_model_references_resolve(self) -> None:
        bad = hardware_model.Model(parts=dict(MODEL.parts), chassis=dict(MODEL.chassis))
        bad.parts["cma-x"] = hardware_model.cma("cma-x", "", "", "cpm-s", 1, occupies=("xcm-9",))
        bad.chassis["sr-7s"] = hardware_model.Chassis(
            "sr-7s", slots=(hardware_model.Slot("cpm", ("cma",), types=("cma-x",)),)
        )
        with self.assertRaisesRegex(ValueError, "xcm-9"):
            hardware_model.check_model(bad)

    def test_exported_json_is_current(self) -> None:
        exported = json.loads((ROOT / "src/data/hardware-model.json").read_text())
        self.assertEqual(exported, json.loads(srsim.dumps_json(hardware_model.model_json(MODEL))))


if __name__ == "__main__":
    unittest.main()
