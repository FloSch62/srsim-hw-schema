import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import type { OutputMode, ValidationReport } from "../types";
import { IssueCounts } from "./IssueCounts";
import { YamlTextArea } from "./YamlTextArea";

interface YamlPreviewProps {
  yaml: string;
  edaYaml: string;
  mode: OutputMode;
  report: ValidationReport;
  includeDefaults: boolean;
  onIncludeDefaultsChange: (includeDefaults: boolean) => void;
}

export function YamlPreview({ yaml, edaYaml, mode, report, includeDefaults, onIncludeDefaultsChange }: YamlPreviewProps) {
  const [copyLabel, setCopyLabel] = useState("Copy");
  const shownYaml = mode === "eda" ? edaYaml : yaml;

  const copyYaml = async () => {
    try {
      await navigator.clipboard.writeText(shownYaml);
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy"), 1200);
    } catch {
      setCopyLabel("Unavailable");
      window.setTimeout(() => setCopyLabel("Copy"), 1600);
    }
  };


  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: "100%" }}>
      <Stack spacing={1.5} sx={{ height: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Box>
            <Typography variant="h6">
              {mode === "eda" ? "EDA TopoNode" : "Generated clab.yml"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {mode === "eda" ? "Full TopoNode resource from the EDA component model." : "Updated from the selected components."}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {mode === "clab" ? (
              <Button
                size="small"
                variant={includeDefaults ? "contained" : "outlined"}
                onClick={() => onIncludeDefaultsChange(!includeDefaults)}
              >
                {includeDefaults ? "Defaults included" : "Include defaults"}
              </Button>
            ) : null}
            <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyYaml}>
              {copyLabel}
            </Button>
          </Stack>
        </Box>

        <Alert
          severity={report.valid ? "success" : "error"}
          icon={report.valid ? <CheckCircleOutlineIcon fontSize="inherit" /> : <ErrorOutlineIcon fontSize="inherit" />}
        >
          {report.valid
            ? (mode === "eda" ? "Generated EDA TopoNode validates." : "Generated topology validates.")
            : (mode === "eda" ? "Generated EDA TopoNode has validation issues." : "Generated topology has validation issues.")}
        </Alert>

        <IssueCounts report={report} />

        {report.issues.length ? (
          <Box sx={{ maxHeight: 150, overflow: "auto" }}>
            <Stack spacing={0.75}>
              {report.issues.slice(0, 6).map((issue, index) => (
                <Typography key={index} variant="body2" color="error.main">
                  {issue.path ? `${issue.path}: ` : ""}
                  {issue.message}
                </Typography>
              ))}
            </Stack>
          </Box>
        ) : null}

        <YamlTextArea
          ariaLabel={mode === "eda" ? "Generated EDA TopoNode YAML" : "Generated clab YAML"}
          maxRows={28}
          minRows={18}
          readOnly
          value={shownYaml}
        />
      </Stack>
    </Paper>
  );
}
