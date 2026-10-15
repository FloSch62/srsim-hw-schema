# SR-SIM Hardware Schema

Generate a local JSON schema from the Nokia SR-SIM appendix tables and query
whether a chassis/card/SFM/XIOM/MDA tuple appears in the documented support
matrix.

## Generate

```sh
uv run srsim-hw-schema generate \
  --source https://documentation.nokia.com/sr/26-7/7x50-shared/srsim-installation-setup/appendices.html \
  --output srsim-supported-hardware.json
```

`--source` can also point at a saved local HTML file.

## Check

```sh
uv run srsim-hw-schema check \
  --schema srsim-supported-hardware.json \
  --model "7750 SR-7s" \
  --chassis SR-7s \
  --sfm sfm-s \
  --card xcm-7s \
  --xiom iom-s-1.5t \
  --mda ms2-400gb-qsfpdd+2-100gb-qsfp28
```

Add `--strict` to fail when the matching row requires a field you did not
provide. For example, checking the SR-7s `xcm-7s` XIOM MDA tuple without
`--sfm sfm-s` exits with status `2` and reports the missing `sfm` field.

## Validate A Containerlab Topology

```sh
uv run srsim-hw-schema validate-topology \
  --schema srsim-supported-hardware.json \
  ../srsim.clab.yml
```

Topology validation checks `topology.nodes.*` entries with
`kind: nokia_srsim` and validates their `components` list against the schema.
It is strict by default so missing required fields, such as `sfm` for an
`xcm-7s` XIOM tuple, are reported. Use `--no-strict` to only check explicit
values that are present in the YAML.

The generated JSON keeps both the raw normalized rows and per-model aggregate
values so it can be consumed by other tools.

## Run The Web Configurator

Published app: https://flosch62.github.io/srsim-hw-schema/

```sh
npm install
npm run dev
```

Open the Vite URL to configure SR-SIM chassis, CPM/card/SFM/XIOM/MDA
components, generate a Containerlab topology snippet, and paste a `clab.yml`
for browser-side validation.

Default SR-SIM values are still shown in the dropdowns, but generated YAML
omits them until you change away from the default. The card type of
integrated chassis that Containerlab derives from the node type (for example
`sr-1s` or `ixr-e2c`) is never written, because Containerlab rejects it.
Component and nested
MDA/XIOM slots are selected from schema-compatible dropdowns instead of
free-text fields, and matrix rows can be added back into the hardware editor.

The app is static and builds with relative asset paths for future GitHub Pages
hosting:

```sh
npm run build
```

Pushes to `main` run `.github/workflows/pages.yml`, which tests the frontend,
builds the static Vite site, and deploys `dist/` to GitHub Pages.

The browser bundle imports `srsim-supported-hardware.json` directly from the
repository root. After updating the Containerlab schemas, refresh the frontend
schema snapshots with:

```sh
npm run sync:data
```

Without a local Containerlab checkout, rebuild the snapshots from upstream
`main` instead:

```sh
curl -fsSL -o src/data/clab.schema.json \
  https://raw.githubusercontent.com/srl-labs/containerlab/main/schemas/clab.schema.json
uv run srsim-hw-schema update-clab-schema \
  --schema src/data/clab.schema.json \
  --hardware-schema srsim-supported-hardware.json
```

## Generate A Containerlab Schema Fragment

```sh
uv run srsim-hw-schema generate-clab-fragment \
  --schema srsim-supported-hardware.json \
  --srsim-schema-output srsim-hw.schema.json \
  --output clab-srsim.schema.fragment.json
```

The fragment contains the SR-SIM sidecar reference and generation metadata. By
default that reference points at the raw GitHub URL used by SchemaStore:
`https://raw.githubusercontent.com/srl-labs/containerlab/main/schemas/srsim-hw.schema.json`.
The sidecar schema contains the generated `definitions.srsim-*` entries and the
full chassis/card/SFM/XIOM/MDA compatibility rules as JSON Schema, so
schema-aware editors can validate incompatible tuples when they can resolve the
sidecar.

By default, generated enums are strict. Use `--allow-unknown-values` only when
you want the schema to keep known values as hints while allowing arbitrary
strings.

## Update Containerlab's Schema

```sh
uv run srsim-hw-schema update-clab-schema \
  --schema ../containerlab/schemas/clab.schema.json \
  --hardware-schema srsim-supported-hardware.json
```

Use `--output updated.clab.schema.json` to write a copy, `--dry-run` to print
what would change, and `--check` in CI to fail when the target schema is stale.
By default, the updater writes `srsim-hw.schema.json` next to the schema and
stores raw GitHub `$ref` links in `clab.schema.json`. Use `--srsim-schema-ref`
to embed a different sidecar URL or local relative reference.
The updater preserves the existing SR OS component schema as
`definitions.sros-component` alongside other component schemas such as
`srl-component`, writes the generated SR-SIM definitions to the sidecar schema,
and rewires the `nokia_srsim` branch and its kind-specific config to use them.

## Generate EDA YANG Catalog

```sh
uv run srsim-hw-schema generate-eda-catalog --output eda-yang-catalog.json
```

The catalog command extracts relevant 26.7 YANG typedef enums from Nokia's
`latest_sros_26.7` models, including card, CPM, MDA, XIOM, SFM, power shelf,
and power module type names. It also extracts the YANG power inventory paths and
slot ranges from `nokia-conf-chassis.yang` as generic inventory metadata. These
generic ranges are not treated as per-chassis power compatibility. Power
selectors and EDA validation use chassis-specific power profiles when the
generated schema contains them; otherwise, the web app offers YANG-derived
suggestions but allows free-form power inventory values. The generated appendix
schema embeds the same EDA YANG extension, and the web app ships a standalone copy under
`src/data/eda-yang-catalog.json` for older schemas.
