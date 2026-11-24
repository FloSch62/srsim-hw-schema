import FactCheckIcon from "@mui/icons-material/FactCheck";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";

import { validateEdaYaml } from "../edaValidation";
import { validateTopologyYaml } from "../validation";
import type { EdaYangCatalog, HardwareSchema, OutputMode } from "../types";
import { IssueCounts, issueSources } from "./IssueCounts";
import { YamlTextArea } from "./YamlTextArea";

interface ValidatorPanelProps {
  generatedYaml: string;
  mode: OutputMode;
  hardwareSchema: HardwareSchema;
  edaCatalog: EdaYangCatalog;
}

export function ValidatorPanel({ generatedYaml, mode, hardwareSchema, edaCatalog }: ValidatorPanelProps) {
  const [yamlText, setYamlText] = useState(generatedYaml);
  useEffect(() => {
    setYamlText(generatedYaml);
  }, [mode]);
  const report = useMemo(
    () => mode === "eda" ? validateEdaYaml(yamlText, hardwareSchema, edaCatalog) : validateTopologyYaml(yamlText, hardwareSchema),
    [mode, yamlText, hardwareSchema, edaCatalog]
  );

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: "100%" }}>
      <Stack spacing={1.5} sx={{ height: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Box>
            <Typography variant="h6">Validate YAML</Typography>
            <Typography variant="body2" color="text.secondary">
              {mode === "eda" ? "Paste an EDA TopoNode and check CRD shape plus hardware support." : "Paste a topology and check it against the schema, SR-SIM and the hardware."}
            </Typography>
          </Box>
          <Button size="small" startIcon={<FactCheckIcon />} onClick={() => setYamlText(generatedYaml)}>
            Use generated
          </Button>
        </Box>

        <Alert severity={report.valid ? "success" : "error"}>
          {report.valid ? (mode === "eda" ? "Pasted EDA TopoNode validates." : "Pasted topology validates.") : `${report.issues.length} validation issue${report.issues.length === 1 ? "" : "s"}.`}
        </Alert>

        <IssueCounts report={report} />

        <YamlTextArea
          ariaLabel={mode === "eda" ? "EDA YAML to validate" : "clab YAML to validate"}
          maxRows={16}
          minRows={11}
          onChange={setYamlText}
          placeholder={mode === "eda" ? "Paste EDA YAML" : "Paste clab.yml"}
          value={yamlText}
        />

        <Box sx={{ flex: 1, minHeight: 120, overflow: "auto", pr: 0.5 }}>
          {report.issues.length ? (
            <Stack spacing={1}>
              {report.issues.slice(0, 18).map((issue, index) => (
                <Alert key={index} severity={issue.source === "yaml" ? "warning" : "error"} variant="outlined">
                  <Typography variant="caption" sx={{ textTransform: "uppercase", fontWeight: 700 }}>
                    {issueSources[issue.source].label}
                  </Typography>
                  <Typography variant="body2">
                    {issue.path ? `${issue.path}: ` : ""}
                    {issue.message}
                  </Typography>
                </Alert>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No issues found.
            </Typography>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}
