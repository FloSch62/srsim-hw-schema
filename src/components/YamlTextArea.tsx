import Box from "@mui/material/Box";
import TextareaAutosize from "@mui/material/TextareaAutosize";
import { alpha, useTheme } from "@mui/material/styles";
import hljs from "highlight.js/lib/core";
import yamlLanguage from "highlight.js/lib/languages/yaml";
import { useEffect, useMemo, useRef } from "react";
import type { ChangeEvent, UIEvent } from "react";

hljs.registerLanguage("yaml", yamlLanguage);

interface YamlTextAreaProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  minRows: number;
  maxRows: number;
  ariaLabel: string;
}

export function YamlTextArea({
  value,
  onChange,
  readOnly = false,
  placeholder,
  minRows,
  maxRows,
  ariaLabel
}: YamlTextAreaProps) {
  const theme = useTheme();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const highlightedYaml = useMemo(() => hljs.highlight(value || "\n", { language: "yaml", ignoreIllegals: true }).value, [value]);

  const syncScroll = () => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;
    if (!textarea || !highlight) return;
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  };

  useEffect(() => {
    syncScroll();
  }, [value]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(event.target.value);
  };

  const handleScroll = (_event: UIEvent<HTMLTextAreaElement>) => {
    syncScroll();
  };

  return (
    <Box
      className="yaml-text-area"
      sx={{
        "--yaml-text": theme.palette.text.primary,
        "--yaml-placeholder": theme.palette.text.disabled,
        "--yaml-selection-bg": alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.32 : 0.2),
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        boxSizing: "border-box",
        overflow: "hidden",
        position: "relative",
        transition: theme.transitions.create(["border-color", "box-shadow"], { duration: theme.transitions.duration.shorter }),
        width: "100%",
        "&:hover": {
          borderColor: "text.primary"
        },
        "&:focus-within": {
          borderColor: "primary.main",
          boxShadow: `0 0 0 1px ${theme.palette.primary.main}`
        }
      }}
    >
      <Box
        ref={highlightRef}
        aria-hidden="true"
        className="yaml-text-area__highlight"
        component="pre"
      >
        <code dangerouslySetInnerHTML={{ __html: highlightedYaml }} />
      </Box>
      <TextareaAutosize
        ref={textareaRef}
        aria-label={ariaLabel}
        className="yaml-text-area__input"
        maxRows={maxRows}
        minRows={minRows}
        onChange={readOnly ? undefined : handleChange}
        onScroll={handleScroll}
        placeholder={placeholder}
        readOnly={readOnly}
        spellCheck={false}
        value={value}
      />
    </Box>
  );
}
