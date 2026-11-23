import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";

import type { ValidationIssue, ValidationReport } from "../types";

type IssueSource = ValidationIssue["source"];

/** Badge label and the question each issue source answers. */
export const issueSources: Record<IssueSource, { label: string; question: string }> = {
  yaml: { label: "YAML", question: "Is this YAML at all?" },
  schema: { label: "schema", question: "Does it pass the containerlab JSON schema, as an editor would check it?" },
  srsim: { label: "SR-SIM", question: "Will containerlab and SR-SIM run it?" },
  hardware: { label: "hardware", question: "Does this hardware exist?" }
};

/** One badge per issue source with its issue count. */
export function IssueCounts({ report }: { report: ValidationReport }) {
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {(Object.keys(issueSources) as IssueSource[]).map((source) => {
        const count = report.issues.filter((issue) => issue.source === source).length;
        return (
          <Tooltip key={source} title={issueSources[source].question}>
            <Chip size="small" color={count ? "error" : "default"} label={`${count} ${issueSources[source].label}`} />
          </Tooltip>
        );
      })}
    </Stack>
  );
}
