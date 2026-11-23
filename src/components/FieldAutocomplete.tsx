import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import ListSubheader from "@mui/material/ListSubheader";
import TextField from "@mui/material/TextField";
import type { ReactNode } from "react";

import { groupOptions, productHelp } from "../productNames";

interface FieldAutocompleteProps {
  label: string;
  value: string;
  options: string[];
  optionLabels?: Record<string, string>;
  optionAdornment?: (option: string) => ReactNode;
  onChange: (value: string) => void;
  disabled?: boolean;
  helperText?: string;
  allowFreeText?: boolean;
  /** Secondary text per option; defaults to the vetted Nokia product help text. */
  optionDescription?: (option: string) => string;
  /** Group key per option; headers are shown only when the list spans 2+ groups. */
  groupBy?: (option: string) => string;
  /** Display order of group keys; unknown keys go last. */
  groupOrder?: string[];
}

export function FieldAutocomplete({
  label,
  value,
  options,
  optionLabels = {},
  optionAdornment,
  onChange,
  disabled,
  helperText,
  allowFreeText = true,
  optionDescription = productHelp,
  groupBy,
  groupOrder
}: FieldAutocompleteProps) {
  const grouping = groupOptions(options, groupBy, groupOrder);
  const optionLabel = (option: string) => optionLabels[option] ?? option;

  return (
    <Autocomplete
      freeSolo={allowFreeText}
      autoSelect
      disabled={disabled}
      options={grouping.options}
      // groupBy must not toggle with the option list: a closing popup still renders
      // its previous options, which would no longer match the grouped/ungrouped shape.
      groupBy={groupBy}
      renderGroup={(params) => (
        <li key={params.key}>
          {grouping.grouped ? (
            <ListSubheader
              component="div"
              sx={{
                borderTop: 1,
                borderColor: "divider",
                color: "text.secondary",
                fontSize: "0.75rem",
                fontWeight: 600,
                letterSpacing: "0.04em",
                lineHeight: "28px",
                top: -8
              }}
            >
              {params.group}
            </ListSubheader>
          ) : null}
          <Box component="ul" sx={{ p: 0, pb: grouping.grouped ? 1 : 0 }}>{params.children}</Box>
        </li>
      )}
      value={value || null}
      inputValue={allowFreeText ? value : undefined}
      getOptionLabel={(option) => typeof option === "string" ? optionLabel(option) : ""}
      onChange={(_, next) => onChange(typeof next === "string" ? next : "")}
      onInputChange={allowFreeText ? (_, next) => onChange(next) : undefined}
      renderOption={(props, option) => {
        const description = optionDescription(option);
        return (
          <Box
            {...props}
            key={option}
            component="li"
            sx={{ alignItems: "center", display: "flex", width: "100%" }}
          >
            <Box component="span" sx={{ alignItems: "center", display: "flex", gap: 1, minWidth: 0, width: "100%" }}>
              <OptionText label={optionLabel(option)} description={description} />
              {optionAdornment ? (
                <Box component="span" sx={{ display: "inline-flex", flex: "0 0 auto", ml: "auto" }}>
                  {optionAdornment(option)}
                </Box>
              ) : null}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          size="small"
          helperText={helperText}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {value && optionAdornment ? optionAdornment(value) : null}
                {params.InputProps.endAdornment}
              </>
            )
          }}
        />
      )}
    />
  );
}

/** Option label with the product help text as a smaller second line. */
export function OptionText({ label, description }: { label: string; description?: string }) {
  return (
    <Box component="span" sx={{ display: "flex", flex: "1 1 auto", flexDirection: "column", minWidth: 0 }}>
      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </Box>
      {description ? (
        <Box
          component="span"
          sx={{ color: "text.secondary", fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {description}
        </Box>
      ) : null}
    </Box>
  );
}
