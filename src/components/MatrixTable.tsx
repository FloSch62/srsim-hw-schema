import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";

import { componentFromMatrixRow, matrixSearchRows } from "../matrix";
import { productHelp } from "../productNames";
import type { MatrixRowAction } from "../matrix";
import type { MatrixEntry, MatrixRow, SrsimComponent } from "../types";

interface MatrixTableProps {
  entry: MatrixEntry | undefined;
  components: SrsimComponent[];
  onApplyRow?: (row: MatrixRow, action: MatrixRowAction) => void;
}

function ValueChips({ values }: { values: string[] | undefined }) {
  if (!values?.length) {
    return <Typography variant="body2" color="text.disabled">-</Typography>;
  }
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
      {values.map((value) => {
        const chip = <Chip key={value} size="small" variant="outlined" label={value} />;
        const help = productHelp(value);
        return help ? (
          <Tooltip key={value} title={help} disableInteractive enterDelay={300}>
            {chip}
          </Tooltip>
        ) : chip;
      })}
    </Box>
  );
}

export function MatrixTable({ entry, components, onApplyRow }: MatrixTableProps) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => matrixSearchRows(entry, query), [entry, query]);

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 1.5 }}>
        <Box>
          <Typography variant="h6">Matrix rows</Typography>
          <Typography variant="body2" color="text.secondary">
            {entry ? `${entry.chassis}: ${rows.length} visible rows` : "No chassis selected"}
          </Typography>
        </Box>
        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search rows"
          sx={{ minWidth: { xs: 160, sm: 260 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }
          }}
        />
      </Box>

      <TableContainer className="matrix-table-container" sx={{ maxHeight: 420 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Source</TableCell>
              <TableCell>Model</TableCell>
              <TableCell>Slot</TableCell>
              <TableCell>Card</TableCell>
              <TableCell>SFM</TableCell>
              <TableCell>XIOM</TableCell>
              <TableCell>MDA</TableCell>
              <TableCell>Memory</TableCell>
              <TableCell align="right">Hardware</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => {
              const addable = Boolean(componentFromMatrixRow(row, components, entry, "add"));
              const replaceable = Boolean(componentFromMatrixRow(row, components, entry, "replace"));
              return (
                <TableRow key={`${row.model}-${row.source}-${index}`} hover>
                  <TableCell>
                    <Chip
                      size="small"
                      color={row.source === "default_layout" ? "primary" : "default"}
                      variant={row.source === "default_layout" ? "filled" : "outlined"}
                      label={row.source === "default_layout" ? "default" : "supported"}
                    />
                  </TableCell>
                  <TableCell>{row.model}</TableCell>
                  <TableCell><ValueChips values={row.values.slot} /></TableCell>
                  <TableCell><ValueChips values={row.values.card} /></TableCell>
                  <TableCell><ValueChips values={row.values.sfm} /></TableCell>
                  <TableCell><ValueChips values={row.values.xiom} /></TableCell>
                  <TableCell><ValueChips values={row.values.mda} /></TableCell>
                  <TableCell><ValueChips values={row.values.memory} /></TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: "inline-flex", gap: 0.5 }}>
                      <Tooltip title="Add" placement="left" disableInteractive enterDelay={500}>
                        <span>
                          <IconButton
                            size="small"
                            color="primary"
                            disabled={!onApplyRow || !addable}
                            onClick={() => onApplyRow?.(row, "add")}
                            aria-label="Add row as new component"
                          >
                            <AddIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Replace" placement="left" disableInteractive enterDelay={500}>
                        <span>
                          <IconButton
                            size="small"
                            color="secondary"
                            disabled={!onApplyRow || !replaceable}
                            onClick={() => onApplyRow?.(row, "replace")}
                            aria-label="Replace existing component with row"
                          >
                            <SwapHorizIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
