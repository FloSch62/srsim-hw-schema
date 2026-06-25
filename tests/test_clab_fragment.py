import unittest
from contextlib import redirect_stdout
from copy import deepcopy
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

import srsim_hw_schema as srsim


SAMPLE_HARDWARE_SCHEMA = {
    "$schema": "https://srl-labs.local/srsim-supported-hardware.schema.v1.json",
    "generated_at": "2026-05-20T00:00:00+00:00",
    "source": "fixture",
    "models": {
        "7750 SR-7s": {
            "default_layout": [
                {
                    "card": "cpm2-s",
                    "chassis": "SR-7s",
                    "memory": "4 GB",
                    "sfm": "sfm2-s",
                    "slot": "A",
                },
                {
                    "card": "xcm2-7s",
                    "chassis": "SR-7s",
                    "mda": "x2-s36-800g-qsfpdd-18.0t",
                    "memory": "6 GB",
                    "sfm": "sfm2-s",
                    "slot": "1",
                },
            ],
            "supported_hardware": [
                {
                    "card": "xcm-7s",
                    "chassis": "SR-7s",
                    "mda": "ms2-400gb-qsfpdd+2-100gb-qsfp28",
                    "sfm": "sfm-s",
                    "xiom": "iom-s-1.5t\niom-s-3.0t",
                }
            ],
            "supported_values": {
                "card": ["cpm2-s", "xcm2-7s", "xcm-7s"],
                "chassis": ["SR-7s"],
                "mda": [
                    "x2-s36-800g-qsfpdd-18.0t",
                    "ms2-400gb-qsfpdd+2-100gb-qsfp28",
                ],
                "sfm": ["sfm2-s", "sfm-s"],
                "slot": ["A", "1"],
                "xiom": ["iom-s-1.5t", "iom-s-3.0t"],
            },
        },
        "7750 SR-1s": {
            "default_layout": [
                {
                    "card": "cpm-1s",
                    "chassis": "SR-1s",
                    "mda": "s36-100gb-qsfp28",
                    "memory": "4 GB",
                    "slot": "A",
                },
            ],
            "supported_hardware": [
                {
                    "card": "cpm-1s",
                    "chassis": "SR-1s",
                    "mda": "s18-100gb-qsfp28\ns36-100gb-qsfp28\ns36-400gb-qsfpdd",
                },
            ],
            "supported_values": {
                "card": ["cpm-1s"],
                "chassis": ["SR-1s"],
                "mda": ["s18-100gb-qsfp28", "s36-100gb-qsfp28", "s36-400gb-qsfpdd"],
                "sfm": [],
                "slot": ["A"],
                "xiom": [],
            },
        },
        "7750 SR-2s": {
            "default_layout": [
                {
                    "card": "cpm-2s",
                    "chassis": "SR-2s",
                    "sfm": "sfm-2s",
                    "slot": "A",
                },
                {
                    "card": "xcm-2s",
                    "chassis": "SR-2s",
                    "mda": "s36-100gb-qsfp28",
                    "sfm": "sfm-2s",
                    "slot": "1",
                },
            ],
            "supported_hardware": [
                {
                    "card": "xcm-2s",
                    "chassis": "SR-2s",
                    "mda": "s36-100gb-qsfp28",
                    "sfm": "sfm-2s",
                },
            ],
            "supported_values": {
                "card": ["cpm-2s", "xcm-2s"],
                "chassis": ["SR-2s"],
                "mda": ["s36-100gb-qsfp28"],
                "sfm": ["sfm-2s"],
                "slot": ["A", "1"],
                "xiom": [],
            },
        },
        "7750 DMS-1-24D": {
            "default_layout": [
                {
                    "card": "cpm-1x/dms24-800g-qsfpdd-1",
                    "chassis": "DMS-1-24D",
                    "slot": "A",
                },
                {
                    "card": "cpm-1x/dms24-800g-qsfpdd-1",
                    "chassis": "DMS-1-24D",
                    "mda": "d24-800g-qsfpdd-1",
                    "slot": "1",
                },
            ],
            "supported_hardware": [],
            "supported_values": {
                "card": ["cpm-1x/dms24-800g-qsfpdd-1"],
                "chassis": ["DMS-1-24D"],
                "mda": ["d24-800g-qsfpdd-1"],
                "sfm": [],
                "slot": ["A", "1"],
                "xiom": [],
            },
        },
    },
}


MINIMAL_CLAB_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "definitions": {
        "env": {"type": "object"},
        "sros-card-types": {"type": "string", "enum": ["xcm-7s"]},
        "sros-cpm-types": {"type": "string", "enum": ["cpm2-s"]},
        "sros-sfm-types": {"type": "string", "enum": ["sfm-s"]},
        "sros-xiom-types": {"type": "string", "enum": ["iom-s-1.5t"]},
        "sros-mda-types": {
            "type": "string",
            "enum": ["ms2-400gb-qsfpdd+2-100gb-qsfp28"],
        },
        "sros-xiom-mda-types": {
            "type": "string",
            "enum": ["ms2-400gb-qsfpdd+2-100gb-qsfp28"],
        },
        "node-config": {
            "type": "object",
            "properties": {
                "kind": {"type": "string"},
                "type": {"type": "string"},
                "components": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "slot": {"type": "string"},
                            "type": {"description": "Set component type"},
                        },
                    },
                    "uniqueItems": True,
                    "description": "List of node components",
                    "markdownDescription": "Dependency list for Components",
                },
            },
            "allOf": [
                {
                    "if": {
                        "properties": {"kind": {"pattern": "(nokia_srsim)"}},
                        "required": ["kind"],
                    },
                    "then": {
                        "properties": {
                            "type": {"type": "string", "enum": ["sr-7s"]}
                        }
                    },
                }
            ],
        },
    },
}


class ClabFragmentTest(unittest.TestCase):
    def test_fragment_contains_srsim_definitions_and_matrix(self) -> None:
        sidecar = srsim.build_srsim_schema_module(SAMPLE_HARDWARE_SCHEMA)
        definitions = sidecar["definitions"]

        for definition in srsim.CLAB_COMPONENT_DEFINITIONS:
            self.assertIn(definition, definitions)
        self.assertIn("srsim-node", definitions)
        self.assertIn("srsim-component-sr-7s", definitions)
        self.assertEqual(sidecar["$id"], srsim.CLAB_SRSIM_SCHEMA)
        self.assertIn("sr-7s", definitions["srsim-chassis-types"]["enum"])
        self.assertIn("xcm-7s", definitions["srsim-card-types"]["enum"])
        self.assertNotIn("cpm-1s", definitions["srsim-card-types"]["enum"])
        self.assertIn("cpm2-s", definitions["srsim-cpm-types"]["enum"])
        self.assertIn("cpm-1s", definitions["srsim-cpm-types"]["enum"])
        self.assertIn(
            "cpm-1x/dms24-800g-qsfpdd-1",
            definitions["srsim-card-types"]["enum"],
        )
        self.assertIn(
            "cpm-1x/dms24-800g-qsfpdd-1",
            definitions["srsim-cpm-types"]["enum"],
        )
        self.assertIn("iom-s-1.5t", definitions["srsim-xiom-types"]["enum"])
        self.assertIn(
            "ms2-400gb-qsfpdd+2-100gb-qsfp28",
            definitions["srsim-mda-types"]["enum"],
        )

        sr7s_component = definitions["srsim-component-sr-7s"]
        encoded = srsim.dumps_json(sr7s_component)
        self.assertIn("iom-s-1.5t", encoded)
        self.assertIn("ms2-400gb-qsfpdd+2-100gb-qsfp28", encoded)

        sr1s_component = definitions["srsim-component-sr-1s"]
        sr1s_encoded = srsim.dumps_json(sr1s_component)
        self.assertIn('"s36-100gb-qsfp28"', sr1s_encoded)
        self.assertIn({"not": {"required": ["xiom"]}}, sr1s_component["allOf"])

        sr1s_node_rules = [
            rule
            for rule in definitions["srsim-node"]["allOf"]
            if rule["if"]["properties"]["type"].get("const") == "sr-1s"
        ]
        self.assertEqual(len(sr1s_node_rules), 1)
        self.assertEqual(
            sr1s_node_rules[0]["then"]["properties"]["components"]["maxItems"],
            1,
        )

    def test_component_shape_validation_rejects_wrong_chassis_modes(self) -> None:
        sr1s_errors = srsim.validate_component_list_shape(
            schema=SAMPLE_HARDWARE_SCHEMA,
            node_name="sros1",
            chassis="sr-1s",
            components=[{"slot": 1, "type": "cpm-1s"}],
        )
        sr7s_errors = srsim.validate_component_list_shape(
            schema=SAMPLE_HARDWARE_SCHEMA,
            node_name="sros1",
            chassis="sr-7s",
            components=[{"slot": 1, "type": "xcm-7s"}],
        )

        self.assertTrue(any("standalone component slot" in error for error in sr1s_errors))
        self.assertTrue(any("requires a CPM component slot" in error for error in sr7s_errors))

    def test_component_shape_validation_rejects_duplicate_component_slots(self) -> None:
        errors = srsim.validate_component_list_shape(
            schema=SAMPLE_HARDWARE_SCHEMA,
            node_name="sros1",
            chassis="sr-7s",
            components=[
                {"slot": "A", "type": "cpm2-s"},
                {"slot": 1, "type": "xcm2-7s"},
                {"slot": 1, "type": "xcm-7s"},
            ],
        )

        self.assertTrue(any("duplicate component slot 1" in error for error in errors))

    def test_topology_matching_normalizes_prefixed_chassis_names(self) -> None:
        self.assertTrue(
            srsim.record_matches_topology(
                {
                    "chassis": "7705 SAR-Mx",
                    "card": "iom-sar-1x",
                    "mda": "m2-1g-sfp+2-10g-sfp+\nm4-rs232-rj45+4-c3794-sfp",
                },
                {
                    "chassis": "sar-mx",
                    "slot": "A",
                    "card": "iom-sar-1x",
                    "mda": "m4-rs232-rj45+4-c3794-sfp",
                },
            )
        )

    def test_sidecar_groups_identical_chassis_component_definitions(self) -> None:
        schema = deepcopy(SAMPLE_HARDWARE_SCHEMA)
        duplicate = deepcopy(schema["models"]["7750 SR-7s"])
        duplicate["supported_values"]["chassis"] = ["SR-7e"]
        for table_name in ("default_layout", "supported_hardware"):
            for row in duplicate[table_name]:
                row["chassis"] = "SR-7e"
        schema["models"]["7750 SR-7e"] = duplicate

        sidecar = srsim.build_srsim_schema_module(schema)
        definitions = sidecar["definitions"]
        component_definitions = [
            name for name in definitions if name.startswith("srsim-component-")
        ]

        self.assertEqual(sidecar["x-srsim-metadata"]["chassis"], 5)
        self.assertEqual(sidecar["x-srsim-metadata"]["component_definitions"], 4)
        self.assertEqual(len(component_definitions), 4)
        shared_rules = [
            rule
            for rule in definitions["srsim-node"]["allOf"]
            if rule["if"]["properties"]["type"].get("enum") == ["sr-7e", "sr-7s"]
        ]
        self.assertEqual(len(shared_rules), 1)

    def test_apply_clab_fragment_is_idempotent(self) -> None:
        fragment = srsim.build_clab_fragment(SAMPLE_HARDWARE_SCHEMA)
        clab_schema = deepcopy(MINIMAL_CLAB_SCHEMA)
        clab_schema["definitions"]["srsim-component-old-inline"] = {"type": "object"}
        updated = srsim.apply_clab_fragment(clab_schema, fragment)
        updated_again = srsim.apply_clab_fragment(updated, fragment)
        srsim_ref = srsim.DEFAULT_SRSIM_SCHEMA_REF

        self.assertEqual(updated, updated_again)
        self.assertIn("sros-component", updated["definitions"])
        self.assertNotIn("srsim-component-old-inline", updated["definitions"])
        self.assertEqual(
            updated["definitions"]["node-config"]["properties"]["components"]["items"],
            {
                "anyOf": [
                    {"$ref": "#/definitions/sros-component"},
                    {"$ref": f"{srsim_ref}#/definitions/srsim-component"},
                ]
            },
        )

        srsim_branch = srsim.find_srsim_branch(updated)
        self.assertEqual(
            srsim_branch["then"],
            {
                "allOf": [
                    {"$ref": f"{srsim_ref}#/definitions/srsim-node"}
                ]
            },
        )
        self.assertEqual(
            updated["x-srsim-schema-ref"],
            srsim_ref,
        )
        self.assertNotIn("x-srsim-compatibility-matrix", updated)

    def test_yang_typedef_catalog_extracts_eda_types(self) -> None:
        yang = """
        module nokia-types-chassis {
          typedef power-module-type {
            type enumeration {
              enum ps-a-dc-6000 { value 9; }
              enum ixr-dc-3000 { value 12; }
            }
          }
        }
        """

        self.assertEqual(
            srsim.yang_typedef_enums(yang, "power-module-type"),
            ["ixr-dc-3000", "ps-a-dc-6000"],
        )

    def test_yang_leaf_enums_extracts_connector_breakouts(self) -> None:
        yang = """
        submodule nokia-conf-port-connector {
          grouping conf-port-connector {
            container connector {
              leaf breakout {
                type enumeration {
                  enum c1-100g { value 4; }
                  enum c1-400g { value 8; }
                }
              }
            }
          }
        }
        """

        self.assertEqual(srsim.yang_leaf_enums(yang, "breakout"), ["c1-100g", "c1-400g"])

    def test_mda_connector_profile_derives_mixed_speed_groups(self) -> None:
        breakouts = ["c1-100g", "c4-25g", "c1-400g", "c4-100g"]
        profile = srsim.mda_connector_profile(
            "ms2-400gb-qsfpdd+2-100gb-qsfp28",
            breakouts,
        )

        self.assertEqual(
            profile,
            {
                "mdaType": "ms2-400gb-qsfpdd+2-100gb-qsfp28",
                "connectors": [
                    {
                        "count": 2,
                        "defaultType": "c1-400g",
                        "types": ["c1-400g", "c4-100g"],
                    },
                    {
                        "count": 2,
                        "defaultType": "c1-100g",
                        "types": ["c1-100g", "c4-25g"],
                    },
                ],
            },
        )

    def test_yang_range_slots_expands_power_ranges(self) -> None:
        self.assertEqual(srsim.yang_range_slots("1..2"), ["1", "2"])
        self.assertEqual(srsim.yang_range_slots("1|3..4"), ["1", "3", "4"])

    def test_eda_catalog_defaults_do_not_invent_power_or_fan_inventory(self) -> None:
        defaults = srsim.eda_toponode_component_defaults()
        sr2s = defaults["sr-2s"]["components"]

        self.assertIn({"kind": "lineCard", "slot": "1", "type": "xcm-2s"}, sr2s)
        self.assertFalse(any(component.get("kind") == "connector" for component in sr2s))
        self.assertFalse(any(component.get("kind") == "powerShelf" for component in sr2s))
        self.assertFalse(any(component.get("kind") == "powerModule" for component in sr2s))
        self.assertFalse(any(component.get("kind") == "fan" for component in sr2s))
        self.assertFalse(any(component.get("type") == "FanTray" for component in sr2s))

    def test_generate_local_source_skips_implicit_remote_yang(self) -> None:
        with (
            patch.object(srsim, "load_source", return_value="<html></html>"),
            patch.object(srsim, "build_schema", return_value={"models": {}}),
            patch.object(srsim, "extend_schema_with_eda_yang") as extend,
            redirect_stdout(StringIO()),
        ):
            srsim.cmd_generate(SimpleNamespace(source="appendix.html", yang_source=None, output="-"))

        extend.assert_not_called()

    def test_generate_remote_source_uses_default_yang(self) -> None:
        schema = {"models": {}}
        with (
            patch.object(srsim, "load_source", return_value="<html></html>"),
            patch.object(srsim, "build_schema", return_value=schema),
            patch.object(srsim, "extend_schema_with_eda_yang") as extend,
            redirect_stdout(StringIO()),
        ):
            srsim.cmd_generate(SimpleNamespace(source=srsim.DEFAULT_APPENDIX_URL, yang_source=None, output="-"))

        extend.assert_called_once_with(schema, srsim.DEFAULT_YANG_SOURCE)

    def test_generate_local_source_uses_explicit_yang(self) -> None:
        schema = {"models": {}}
        with (
            patch.object(srsim, "load_source", return_value="<html></html>"),
            patch.object(srsim, "build_schema", return_value=schema),
            patch.object(srsim, "extend_schema_with_eda_yang") as extend,
            redirect_stdout(StringIO()),
        ):
            srsim.cmd_generate(SimpleNamespace(source="appendix.html", yang_source="yang", output="-"))

        extend.assert_called_once_with(schema, "yang")


if __name__ == "__main__":
    unittest.main()
