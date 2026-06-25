import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";

import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CssBaseline from "@mui/material/CssBaseline";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { PaletteMode } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";

import hardwareSchemaData from "../srsim-supported-hardware.json";
import edaCatalogData from "./data/eda-yang-catalog.json";
import { ComponentEditor } from "./components/ComponentEditor";
import { MatrixTable } from "./components/MatrixTable";
import { ValidatorPanel } from "./components/ValidatorPanel";
import { YamlPreview } from "./components/YamlPreview";
import { buildEdaTopoNodeYaml, defaultEdaVersion, normalizeEdaConfig } from "./edaComponents";
import { validateEdaYaml } from "./edaValidation";
import {
  buildMatrix,
  componentCompatibleWithSfm,
  componentFromMatrixRow,
  defaultComponentsForEntry,
  defaultImpliesFields,
  fixedDistributedCpmTypeIsImplied,
  deploymentMode,
  defaultSfmForEntry,
  firstValue,
  getEntry,
  upsertComponentBySlot
} from "./matrix";
import { buildTopologyYaml } from "./topologyYaml";
import type { MatrixRowAction } from "./matrix";
import type { EdaYangCatalog, HardwareSchema, MatrixRow, OutputMode, SrsimConfig } from "./types";
import { validateTopologyYaml } from "./validation";

import "./styles.css";

const hardwareSchema = hardwareSchemaData as HardwareSchema;
const edaCatalog = (hardwareSchema.eda ?? edaCatalogData) as EdaYangCatalog;
const colorModeKey = "srsim-hw-schema-color-mode";
const appendixDocsUrl = hardwareSchema.source ||
  "https://documentation.nokia.com/sr/26-3/7x50-shared/srsim-installation-setup/appendices.html";

function createAppTheme(mode: PaletteMode) {
  const isDark = mode === "dark";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: isDark ? "#7ab8ff" : "#124191"
      },
      secondary: {
        main: isDark ? "#58d5c9" : "#0f766e"
      },
      background: {
        default: isDark ? "#1f2937" : "#f6f8fb",
        paper: isDark ? "#111827" : "#ffffff"
      },
      divider: isDark ? "#374151" : "#d9e1ec"
    },
    shape: {
      borderRadius: 8
    },
    typography: {
      h1: { letterSpacing: 0 },
      h2: { letterSpacing: 0 },
      h3: { letterSpacing: 0 },
      h4: { letterSpacing: 0 },
      h5: { letterSpacing: 0 },
      h6: { letterSpacing: 0 }
    },
    components: {
      MuiButton: {
        defaultProps: {
          disableElevation: true
        },
        styleOverrides: {
          root: {
            textTransform: "none"
          }
        }
      },
      MuiChip: {
        styleOverrides: {
          root: {
            maxWidth: "100%"
          },
          label: {
            overflow: "hidden",
            textOverflow: "ellipsis"
          }
        }
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none"
          }
        }
      }
    }
  });
}

function initialColorMode(): PaletteMode {
  if (typeof window === "undefined") return "light";
  try {
    const storedMode = window.localStorage.getItem(colorModeKey);
    if (storedMode === "dark" || storedMode === "light") return storedMode;
  } catch {
    // Ignore storage access failures and fall back to the system preference.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialConfig(matrix: ReturnType<typeof buildMatrix>): SrsimConfig {
  const preferred = matrix.find((entry) => entry.chassis === "sr-7s") ?? matrix[0];
  const components = defaultComponentsForEntry(preferred);
  return normalizeEdaConfig({
    labName: "srsim-lab",
    nodeName: "sros1",
    chassis: preferred?.chassis ?? "",
    sfm: defaultSfmForEntry(preferred),
    components,
    edaNamespace: "eda",
    edaNodeProfile: "",
    edaVersion: defaultEdaVersion,
    edaComponents: []
  }, edaCatalog);
}

function NokiaLogo() {
  return (
    <Box component="span" className="nokia-logo" role="img" aria-label="Nokia">
      <svg aria-hidden="true" viewBox="0 0 576 129.7931976" focusable="false">
        <path d="M398.1639404,3.9472001l-0.000061,121.8988037h19.0888977L417.2527466,3.9472001H398.1639404z M194.2207794,1.8649011c-37.1884613-0.0001605-66.0428162,25.9216156-66.0428162,63.0316963 c0,38.78125,28.8543549,63.0323334,66.0428162,63.0317001c37.1885376-0.0006332,66.1020355-24.2504501,66.0428009-63.0317001 C260.2098694,29.7362213,231.409317,1.8650616,194.2207794,1.8649011z M241.2088776,64.8965988 c0,27.4725647-21.0372772,45.6786041-46.9880524,45.6786041s-46.9880676-18.2060394-46.9880676-45.6786041 c0-26.974247,21.0372772-45.6786003,46.9880676-45.6786003S241.2088776,37.9223518,241.2088776,64.8965988z M0,0.000011 v125.845993h19.4820881l0.0000095-83.1665039l101.2399597,87.1137009v-26.0914993L0,0.000011z M274.6208801,64.8965759 l70.8470154,60.9494705h28.4053955l-70.9522095-60.9494705l70.952179-60.9494209H345.467865L274.6208801,64.8965759z M576,125.8460007h-20.9987183l-15.3583984-26.9943161h-69.5536499l-15.3582153,26.9943161h-20.9987488l25.4322205-44.9925461 h70.4919434l-35.1487427-62.5270119L504.8661804,0l-0.0000305,0.0001221L504.8662109,0L576,125.8460007z" />
      </svg>
    </Box>
  );
}

export function App() {
  const [colorMode, setColorMode] = useState<PaletteMode>(initialColorMode);
  const theme = useMemo(() => createAppTheme(colorMode), [colorMode]);
  const matrix = useMemo(() => buildMatrix(hardwareSchema), []);
  const [config, setConfig] = useState<SrsimConfig>(() => initialConfig(matrix));
  const [outputMode, setOutputMode] = useState<OutputMode>("clab");
  const [includeDefaultsInYaml, setIncludeDefaultsInYaml] = useState(false);
  const selectedEntry = getEntry(matrix, config.chassis);
  const selectedDeploymentMode = deploymentMode(selectedEntry);
  const yamlOptions = useMemo(
    () => ({
      shouldWriteComponentSlot: (component: SrsimConfig["components"][number]) =>
        includeDefaultsInYaml || selectedDeploymentMode === "distributed" ||
        !defaultImpliesFields(selectedEntry, component, config.sfm, []),
      shouldWriteComponentType: (component: SrsimConfig["components"][number]) =>
        includeDefaultsInYaml ||
        (selectedDeploymentMode === "distributed" && !fixedDistributedCpmTypeIsImplied(selectedEntry, component)) ||
        !defaultImpliesFields(selectedEntry, component, config.sfm, []),
      shouldWriteSfm: (component: SrsimConfig["components"][number]) =>
        selectedDeploymentMode === "distributed" && Boolean(component.slot),
      shouldWriteDirectMda: (component: SrsimConfig["components"][number], mda: { slot?: string | number; type?: string }) =>
        includeDefaultsInYaml || selectedDeploymentMode !== "distributed" ||
        !defaultImpliesFields(selectedEntry, { ...component, mda: [mda] }, config.sfm, ["mda"]),
      shouldWriteXiom: (component: SrsimConfig["components"][number], xiom: { slot?: string | number; type?: string }) =>
        includeDefaultsInYaml ||
        !defaultImpliesFields(selectedEntry, { ...component, xiom: [xiom] }, config.sfm, ["xiom", "mda"]),
      shouldWriteXiomMda: (
        component: SrsimConfig["components"][number],
        xiom: { slot?: string | number; type?: string },
        mda: { slot?: string | number; type?: string }
      ) => includeDefaultsInYaml ||
        !defaultImpliesFields(selectedEntry, { ...component, xiom: [{ ...xiom, mda: [mda] }] }, config.sfm, ["mda"])
    }),
    [config.sfm, includeDefaultsInYaml, selectedDeploymentMode, selectedEntry]
  );
  const yaml = useMemo(() => buildTopologyYaml(config, yamlOptions), [config, yamlOptions]);
  const edaYaml = useMemo(() => buildEdaTopoNodeYaml(config, selectedEntry), [config, selectedEntry]);
  const generatedReport = useMemo(() => validateTopologyYaml(yaml, hardwareSchema), [yaml]);
  const edaReport = useMemo(() => validateEdaYaml(edaYaml, hardwareSchema, edaCatalog), [edaYaml]);
  const previewReport = outputMode === "eda" ? edaReport : generatedReport;
  const previewYaml = outputMode === "eda" ? edaYaml : yaml;
  const commitConfig = (nextConfig: SrsimConfig) => {
    setConfig((previous) => normalizeEdaConfig(nextConfig, edaCatalog, previous));
  };

  const applyMatrixRow = (row: MatrixRow, action: MatrixRowAction) => {
    const nextSfm = firstValue(row, "sfm") || config.sfm;
    const compatibleComponents = nextSfm === config.sfm
      ? config.components
      : config.components.filter((component) => componentCompatibleWithSfm(selectedEntry, component, nextSfm));
    const component = componentFromMatrixRow(row, compatibleComponents, selectedEntry, action);
    if (!component) return;
    commitConfig({
      ...config,
      sfm: nextSfm,
      components: upsertComponentBySlot(compatibleComponents, component)
    });
  };

  const totalCards = selectedEntry
    ? new Set(selectedEntry.rows.flatMap((row) => row.values.card ?? [])).size
    : 0;
  const totalMdas = selectedEntry
    ? new Set(selectedEntry.rows.flatMap((row) => row.values.mda ?? [])).size
    : 0;

  useEffect(() => {
    document.documentElement.dataset.theme = colorMode;
    try {
      window.localStorage.setItem(colorModeKey, colorMode);
    } catch {
      // Theme persistence is best effort; the UI still follows the current state.
    }
  }, [colorMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box className="app" data-theme={colorMode}>
        <Box component="header" className="app-header">
          <Box className="app-header-brand">
            <NokiaLogo />
            <Typography variant="h5" component="h1" className="app-title">
              SR-SIM Hardware Configurator
            </Typography>
          </Box>
          <Box className="app-header-actions">
            <ToggleButtonGroup
              exclusive
              size="small"
              value={outputMode}
              onChange={(_, value: OutputMode | null) => value && setOutputMode(value)}
            >
              <ToggleButton value="clab">clab.yml</ToggleButton>
              <ToggleButton value="eda">EDA</ToggleButton>
            </ToggleButtonGroup>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" justifyContent="flex-end">
              <Chip
                className="summary-chip"
                size="small"
                color="primary"
                label="SR OS 26.3"
                component="a"
                href={appendixDocsUrl}
                target="_blank"
                rel="noreferrer"
                clickable
              />
              <Chip className="summary-chip" size="small" label={`${matrix.length} chassis`} />
              <Chip className="summary-chip" size="small" label={`${totalCards} cards`} />
              <Chip className="summary-chip" size="small" label={`${totalMdas} MDAs`} />
            </Stack>
            <Tooltip title={colorMode === "dark" ? "Use light mode" : "Use dark mode"}>
              <IconButton
                className="theme-toggle"
                color="inherit"
                size="small"
                onClick={() => setColorMode((mode) => (mode === "dark" ? "light" : "dark"))}
                aria-label={colorMode === "dark" ? "Use light mode" : "Use dark mode"}
              >
                {colorMode === "dark"
                  ? <DarkModeOutlinedIcon fontSize="small" />
                  : <LightModeOutlinedIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Box component="main" className="workbench">
          <ComponentEditor
            matrix={matrix}
            config={config}
            mode={outputMode}
            edaCatalog={edaCatalog}
            onChange={commitConfig}
          />
          <YamlPreview
            yaml={yaml}
            edaYaml={edaYaml}
            mode={outputMode}
            report={previewReport}
            includeDefaults={includeDefaultsInYaml}
            onIncludeDefaultsChange={setIncludeDefaultsInYaml}
          />
          <ValidatorPanel
            generatedYaml={previewYaml}
            mode={outputMode}
            hardwareSchema={hardwareSchema}
            edaCatalog={edaCatalog}
          />
        </Box>

        <Box className="matrix-band">
          <MatrixTable entry={selectedEntry} components={config.components} onApplyRow={applyMatrixRow} />
        </Box>
      </Box>
    </ThemeProvider>
  );
}
