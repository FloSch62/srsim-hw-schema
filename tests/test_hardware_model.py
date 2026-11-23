import json
import unittest
from pathlib import Path

import hardware_model
import srsim_hw_schema as srsim

ROOT = Path(__file__).resolve().parents[1]
MODEL = hardware_model.build_model()


def placeable_cpms(chassis: hardware_model.Chassis) -> set[str]:
    types: set[str] = set()
    for slot in chassis.slots:
        if "cpm" in slot.accepts:
            types.update(slot.types)
        if "cma" in slot.accepts:
            types.update(t for cma in slot.types for cpm_slot in MODEL.parts[cma].slots for t in cpm_slot.types)
    return types


class HardwareModelTest(unittest.TestCase):
    def test_shared_cases(self) -> None:
        for case in json.loads((ROOT / "tests/hardware-cases.json").read_text()):
            with self.subTest(case["name"]):
                issues = hardware_model.hardware_issues(MODEL, case["chassis"], case["components"])
                self.assertEqual([{"code": i.code, "path": i.path} for i in issues], case["issues"])

    def test_every_appendix_part_maps_onto_the_model(self) -> None:
        # A type the model cannot place is a gap in the model, not something to work around.
        matrix = srsim.build_clab_matrix(json.loads((ROOT / "srsim-supported-hardware.json").read_text()))
        for chassis_id, chassis in MODEL.chassis.items():
            entry = matrix["chassis"][chassis_id]
            cpms, cards = srsim.chassis_card_classes(entry)
            with self.subTest(chassis_id):
                self.assertLessEqual(set(cpms), placeable_cpms(chassis))
                for card in cards:
                    self.assertEqual(MODEL.parts[card].kind, "xcm", card)
                for card, compatibility in srsim.card_compatibility(entry).items():
                    for module in (*compatibility["direct_mda"], *compatibility["xiom"]):
                        self.assertIn(MODEL.parts[module].kind, {"xma", "iom"}, f"{card}: {module}")
                offered_types = {*cpms, *cards}
                for offered in srsim.card_compatibility(entry).values():
                    offered_types.update(offered["direct_mda"], offered["xiom"])
                for variant in chassis.variants:
                    self.assertLessEqual(set(variant.parts), offered_types, variant.name)

    def test_model_references_resolve(self) -> None:
        bad = hardware_model.Model(parts=dict(MODEL.parts), chassis=dict(MODEL.chassis))
        bad.parts["cma-x"] = hardware_model.cma("cma-x", "", "cpm-s", 1, occupies=("xcm-9",))
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
