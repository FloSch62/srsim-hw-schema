import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import type { SelectChangeEvent } from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMemo } from "react";

import {
  edaConnectorBreakoutLabel,
  edaConnectorBreakoutMode,
  edaComponentSort,
  edaConnectorCompatibility,
  edaConnectorParentSlot,
  edaHasPowerProfileForChassis,
  edaPowerSlotsForChassis,
  edaPowerTypesForChassis
} from "../edaComponents";
import {
  availableNumericSlotOptions,
  componentCardSlotOptions,
  componentCpmSlotOptions,
  componentTypeOptions,
  cpmOptions,
  defaultComponentsForEntry,
  defaultImpliesFields,
  defaultSfmForEntry,
  directMdaSlotOptions,
  directMdaOptions,
  type DeploymentMode,
  deploymentMode,
  getEntry,
  isCpmSlot,
  nextCpmSlot,
  nextNumericSlot,
  schemaNumericSlotOptions,
  sfmOptions,
  xiomMdaSlotOptions,
  xiomMdaOptions,
  xiomOptions
} from "../matrix";
import { slotRules } from "../schemaSlots";
import type {
  EdaTopoNodeComponent,
  EdaYangCatalog,
  MatrixEntry,
  OutputMode,
  SrsimComponent,
  SrsimConfig,
  SrsimMda,
  SrsimXiom
} from "../types";

import { FieldAutocomplete } from "./FieldAutocomplete";

interface ComponentEditorProps {
  matrix: MatrixEntry[];
  config: SrsimConfig;
  mode: OutputMode;
  edaCatalog: EdaYangCatalog;
  onChange: (config: SrsimConfig) => void;
}

interface IndexedComponent {
  component: SrsimComponent;
  index: number;
}

type SlotOption = string | number;
const nestedComponentGridColumns = { xs: "1fr", sm: "120px minmax(0, 1fr) auto" } as const;
const nestedSlotCount = 2;

function deploymentModeLabel(mode: DeploymentMode): string {
  if (mode === "distributed") return "Distributed";
  if (mode === "integrated_redundant") return "Redundant integrated";
  return "Integrated";
}

function withoutEmptyNested(component: SrsimComponent): SrsimComponent {
  return {
    ...component,
    mda: component.mda?.length ? component.mda : undefined,
    xiom: component.xiom?.length ? component.xiom : undefined
  };
}

export function ComponentEditor({ matrix, config, mode, edaCatalog, onChange }: ComponentEditorProps) {
  const selectedEntry = getEntry(matrix, config.chassis);
  const selectedDeploymentMode = deploymentMode(selectedEntry);
  const distributed = selectedDeploymentMode === "distributed";
  const chassisOptions = useMemo(() => matrix.map((entry) => entry.chassis), [matrix]);
  const chassisDeploymentLabels = useMemo(
    () => Object.fromEntries(matrix.map((entry) => [entry.chassis, deploymentModeLabel(deploymentMode(entry))])),
    [matrix]
  );
  const sharedSfmOptions = sfmOptions(selectedEntry, []);
  const defaultSfm = defaultSfmForEntry(selectedEntry);

  const indexed = config.components.map((component, index) => ({ component, index }));
  const cpms = indexed.filter(({ component }) => isCpmSlot(component.slot));
  const cards = indexed.filter(({ component }) => !isCpmSlot(component.slot));
  const cpmSlotOptions = componentCpmSlotOptions(selectedEntry, slotRules.componentStringSlots);
  const cardSlotOptions = componentCardSlotOptions(
    selectedEntry,
    cards.map(({ component }) => component),
    slotRules.componentIntegerMinimum
  );
  const usedCpmSlots = new Set(cpms.map(({ component }) => String(component.slot ?? "").toUpperCase()));
  const usedCardSlots = new Set(cards.map(({ component }) => String(component.slot ?? "")));
  const availableCpmSlots = cpmSlotOptions.filter((slot) => !usedCpmSlots.has(String(slot).toUpperCase()));
  const availableCardSlots = cardSlotOptions.filter((slot) => !usedCardSlots.has(String(slot)));
  const integratedComponent = config.components[0] ?? { mda: [] };
  const xiomSlotOptions = schemaNumericSlotOptions([], nestedSlotCount, slotRules.xiomIntegerMinimum);

  const updateConfig = (updates: Partial<SrsimConfig>) => onChange({ ...config, ...updates });

  const directMdaSlotsFor = (component: SrsimComponent, mdaType = "") =>
    directMdaSlotOptions(selectedEntry, component, config.sfm, nestedSlotCount, slotRules.mdaIntegerMinimum, mdaType);

  const xiomMdaSlotsFor = (component: SrsimComponent, xiom: SrsimXiom, mdaType = "") =>
    xiomMdaSlotOptions(selectedEntry, component, xiom, config.sfm, nestedSlotCount, slotRules.mdaIntegerMinimum, mdaType);

  const nextDirectMdaFor = (component: SrsimComponent): SrsimMda | null => {
    const mdas = component.mda ?? [];
    for (const type of directMdaOptions(selectedEntry, component, config.sfm)) {
      const slot = availableNumericSlotOptions(directMdaSlotsFor(component, type), mdas)[0];
      if (slot) return { slot, type };
    }
    return null;
  };

  const nextXiomMdaFor = (component: SrsimComponent, xiom: SrsimXiom): SrsimMda | null => {
    const mdas = xiom.mda ?? [];
    for (const type of xiomMdaOptions(selectedEntry, component, xiom, config.sfm)) {
      const slot = availableNumericSlotOptions(xiomMdaSlotsFor(component, xiom, type), mdas)[0];
      if (slot) return { slot, type };
    }
    return null;
  };

  const setChassis = (chassis: string) => {
    const entry = getEntry(matrix, chassis);
    const components = defaultComponentsForEntry(entry);
    updateConfig({
      chassis,
      components,
      sfm: defaultSfmForEntry(entry),
      edaComponents: []
    });
  };

  const normalizeComponent = (component: SrsimComponent, sfm: string): SrsimComponent => {
    if (distributed && isCpmSlot(component.slot)) {
      const options = cpmOptions(selectedEntry, sfm);
      return {
        slot: component.slot,
        type: component.type && options.includes(component.type) ? component.type : (options[0] ?? "")
      };
    }

    const typeOptions = distributed
      ? componentTypeOptions(selectedEntry, { slot: component.slot }, sfm)
      : cpmOptions(selectedEntry, sfm);
    const type = component.type && typeOptions.includes(component.type)
      ? component.type
      : (typeOptions[0] ?? (distributed ? "" : component.type ?? ""));
    const next: SrsimComponent = { slot: component.slot, type };
    const base = { slot: component.slot, type };

    const directOptions = directMdaOptions(selectedEntry, base, sfm);
    const directMdas = (component.mda ?? []).filter((mda) => mda.type && directOptions.includes(mda.type));
    if (directMdas.length) next.mda = directMdas;

    const validXioms = (component.xiom ?? []).flatMap((xiom) => {
      const options = xiomOptions(selectedEntry, base, sfm);
      if (!xiom.type || !options.includes(xiom.type)) return [];
      const xiomBase = { slot: xiom.slot, type: xiom.type };
      const mdaOptions = xiomMdaOptions(selectedEntry, base, xiomBase, sfm);
      const mdas = (xiom.mda ?? []).filter((mda) => mda.type && mdaOptions.includes(mda.type));
      return [withoutEmptyNested({ ...xiom, mda: mdas }) as SrsimXiom];
    });
    if (validXioms.length) next.xiom = validXioms;

    return withoutEmptyNested(next);
  };

  const normalizeComponents = (components: SrsimComponent[], sfm: string) =>
    components
      .map((component) => normalizeComponent(component, sfm))
      .filter((item) => item.mda?.length || item.xiom?.length || item.type);

  const setComponents = (components: SrsimComponent[]) => {
    let nextSfm = config.sfm;
    let cleanComponents = normalizeComponents(components, nextSfm);
    const compatibleSfms = sfmOptions(selectedEntry, cleanComponents);
    if (compatibleSfms.length && !compatibleSfms.includes(nextSfm)) {
      nextSfm = compatibleSfms.includes(defaultSfm) ? defaultSfm : compatibleSfms[0];
      cleanComponents = normalizeComponents(components, nextSfm);
    }
    updateConfig({
      components: cleanComponents,
      sfm: nextSfm
    });
  };

  const setIntegratedComponent = (component: SrsimComponent) => {
    setComponents([withoutEmptyNested(component)].filter((item) => item.mda?.length || item.type));
  };

  const applySfm = (sfm: string) => {
    const nextSfm = sfm || defaultSfm || sharedSfmOptions[0] || "";
    updateConfig({
      sfm: nextSfm,
      components: normalizeComponents(config.components, nextSfm)
    });
  };

  const updateComponent = (index: number, updates: Partial<SrsimComponent>) => {
    const next = [...config.components];
    next[index] = withoutEmptyNested({ ...next[index], ...updates });
    setComponents(next);
  };

  const removeComponent = (index: number) => {
    setComponents(config.components.filter((_, idx) => idx !== index));
  };

  const addCpm = () => {
    const slot = availableCpmSlots[0] ?? nextCpmSlot(config.components);
    if (!slot) return;
    setComponents([...config.components, { slot, type: cpmOptions(selectedEntry, config.sfm)[0] ?? "" }]);
  };

  const addCard = () => {
    const slot = availableCardSlots[0] ?? nextNumericSlot(cards.map(({ component }) => component));
    const type = componentTypeOptions(selectedEntry, { slot }, config.sfm)[0] ?? "";
    setComponents([...config.components, { slot, type }]);
  };

  const resetDefaults = () => {
    const components = defaultComponentsForEntry(selectedEntry);
    updateConfig({
      components,
      sfm: defaultSfm,
      edaComponents: []
    });
  };

  const addMda = (componentIndex: number) => {
    const component = config.components[componentIndex];
    const mdas = component.mda ?? [];
    const nextMda = nextDirectMdaFor(component);
    if (!nextMda) return;
    updateComponent(componentIndex, {
      mda: [...mdas, nextMda]
    });
  };

  const addIntegratedMda = () => {
    const mdas = integratedComponent.mda ?? [];
    const nextMda = nextDirectMdaFor(integratedComponent);
    if (!nextMda) return;
    setIntegratedComponent({
      ...integratedComponent,
      mda: [...mdas, nextMda]
    });
  };

  const updateIntegratedMda = (mdaIndex: number, updates: Partial<SrsimMda>) => {
    const mdas = [...(integratedComponent.mda ?? [])];
    mdas[mdaIndex] = { ...mdas[mdaIndex], ...updates };
    setIntegratedComponent({ ...integratedComponent, mda: mdas });
  };

  const removeIntegratedMda = (mdaIndex: number) => {
    setIntegratedComponent({
      ...integratedComponent,
      mda: (integratedComponent.mda ?? []).filter((_, idx) => idx !== mdaIndex)
    });
  };

  const updateMda = (componentIndex: number, mdaIndex: number, updates: Partial<SrsimMda>) => {
    const component = config.components[componentIndex];
    const mdas = [...(component.mda ?? [])];
    mdas[mdaIndex] = { ...mdas[mdaIndex], ...updates };
    updateComponent(componentIndex, { mda: mdas });
  };

  const removeMda = (componentIndex: number, mdaIndex: number) => {
    const component = config.components[componentIndex];
    updateComponent(componentIndex, { mda: (component.mda ?? []).filter((_, idx) => idx !== mdaIndex) });
  };

  const addXiom = (componentIndex: number) => {
    const component = config.components[componentIndex];
    const xioms = component.xiom ?? [];
    const slot = availableNumericSlotOptions(xiomSlotOptions, xioms)[0];
    if (!slot) return;
    updateComponent(componentIndex, {
      xiom: [
        ...xioms,
        {
          slot,
          type: xiomOptions(selectedEntry, component, config.sfm)[0] ?? "",
          mda: []
        }
      ]
    });
  };

  const updateXiom = (componentIndex: number, xiomIndex: number, updates: Partial<SrsimXiom>) => {
    const component = config.components[componentIndex];
    const xioms = [...(component.xiom ?? [])];
    xioms[xiomIndex] = { ...xioms[xiomIndex], ...updates };
    updateComponent(componentIndex, { xiom: xioms });
  };

  const removeXiom = (componentIndex: number, xiomIndex: number) => {
    const component = config.components[componentIndex];
    updateComponent(componentIndex, { xiom: (component.xiom ?? []).filter((_, idx) => idx !== xiomIndex) });
  };

  const addXiomMda = (componentIndex: number, xiomIndex: number) => {
    const component = config.components[componentIndex];
    const xioms = [...(component.xiom ?? [])];
    const xiom = xioms[xiomIndex];
    const mdas = xiom.mda ?? [];
    const nextMda = nextXiomMdaFor(component, xiom);
    if (!nextMda) return;
    xioms[xiomIndex] = {
      ...xiom,
      mda: [...mdas, nextMda]
    };
    updateComponent(componentIndex, { xiom: xioms });
  };

  const updateXiomMda = (
    componentIndex: number,
    xiomIndex: number,
    mdaIndex: number,
    updates: Partial<SrsimMda>
  ) => {
    const component = config.components[componentIndex];
    const xioms = [...(component.xiom ?? [])];
    const xiom = xioms[xiomIndex];
    const mdas = [...(xiom.mda ?? [])];
    mdas[mdaIndex] = { ...mdas[mdaIndex], ...updates };
    xioms[xiomIndex] = { ...xiom, mda: mdas };
    updateComponent(componentIndex, { xiom: xioms });
  };

  const removeXiomMda = (componentIndex: number, xiomIndex: number, mdaIndex: number) => {
    const component = config.components[componentIndex];
    const xioms = [...(component.xiom ?? [])];
    const xiom = xioms[xiomIndex];
    xioms[xiomIndex] = { ...xiom, mda: (xiom.mda ?? []).filter((_, idx) => idx !== mdaIndex) };
    updateComponent(componentIndex, { xiom: xioms });
  };

  const setEdaComponents = (components: EdaTopoNodeComponent[]) => {
    updateConfig({
      edaComponents: components
        .filter((component) => component.kind && component.type)
        .sort(edaComponentSort)
    });
  };

  const addPowerComponent = (kind: "powerShelf" | "powerModule") => {
    const allSlotOptions = edaPowerSlotsForChassis(edaCatalog, config.chassis, kind);
    const shelfSlots = config.edaComponents
      .filter((component) => component.kind === "powerShelf")
      .map((component) => component.slot);
    const slotOptions = kind === "powerModule" && shelfSlots.length
      ? [
          ...allSlotOptions.filter((slot) => shelfSlots.some((shelfSlot) => slot.startsWith(`${shelfSlot}-`))),
          ...allSlotOptions.filter((slot) => !shelfSlots.some((shelfSlot) => slot.startsWith(`${shelfSlot}-`)))
        ]
      : allSlotOptions;
    const typeOptions = edaPowerTypesForChassis(edaCatalog, config.chassis, kind);
    const usedSlots = new Set(config.edaComponents.filter((component) => component.kind === kind).map((component) => component.slot));
    const slot = slotOptions.find((candidate) => !usedSlots.has(candidate)) ?? slotOptions[0] ?? "";
    const component: EdaTopoNodeComponent = {
      kind,
      slot,
      type: typeOptions[0] ?? ""
    };
    setEdaComponents([...config.edaComponents, component]);
  };

  const updateEdaComponent = (index: number, updates: Partial<EdaTopoNodeComponent>) => {
    const next = [...config.edaComponents];
    next[index] = { ...next[index], ...updates };
    setEdaComponents(next);
  };

  const updatePowerComponent = (index: number, updates: Partial<EdaTopoNodeComponent>) => {
    updateEdaComponent(index, updates);
  };

  const removePowerComponent = (index: number) => {
    setEdaComponents(config.edaComponents.filter((_, idx) => idx !== index));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography variant="h6">Hardware</Typography>
              <Chip size="small" variant="outlined" label={deploymentModeLabel(selectedDeploymentMode)} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {selectedEntry?.models.join(", ") || "No chassis selected"}
            </Typography>
          </Box>
          <Tooltip title="Reset components from the documented default layout">
            <IconButton onClick={resetDefaults} size="small">
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
          <TextField
            label="Lab name"
            size="small"
            value={config.labName}
            onChange={(event) => updateConfig({ labName: event.target.value })}
          />
          <TextField
            label="Node name"
            size="small"
            value={config.nodeName}
            onChange={(event) => updateConfig({ nodeName: event.target.value })}
          />
        </Box>

        <FieldAutocomplete
          label="Chassis type"
          value={config.chassis}
          options={chassisOptions}
          optionAdornment={(chassis) => (
            <Chip
              size="small"
              variant="outlined"
              label={chassisDeploymentLabels[chassis] ?? deploymentModeLabel(selectedDeploymentMode)}
              sx={{ flex: "0 0 auto", pointerEvents: "none" }}
            />
          )}
          onChange={setChassis}
          allowFreeText={false}
        />
        <FormControl size="small" fullWidth>
          <InputLabel id="sfm-select-label">SFM</InputLabel>
          <Select
            labelId="sfm-select-label"
            label="SFM"
            value={config.sfm || defaultSfm}
            onChange={(event) => applySfm(event.target.value)}
          >
            {defaultSfm ? <MenuItem value={defaultSfm}>Default ({defaultSfm})</MenuItem> : null}
            {sharedSfmOptions
              .filter((sfm) => sfm !== defaultSfm)
              .map((sfm) => (
                <MenuItem key={sfm} value={sfm}>
                  {sfm}
                </MenuItem>
              ))}
          </Select>
          <FormHelperText>
            {sharedSfmOptions.length ? "Default is used for compatibility and omitted from YAML." : "This chassis has no SFM constraint"}
          </FormHelperText>
        </FormControl>

        {!distributed ? (
          <IntegratedComponentSection
            component={integratedComponent}
            mdaOptions={directMdaOptions(selectedEntry, integratedComponent, config.sfm)}
            mdaSlotOptions={directMdaSlotsFor(integratedComponent)}
            slotOptionsByMda={(integratedComponent.mda ?? []).map((mda) => directMdaSlotsFor(integratedComponent, mda.type))}
            addMdaDisabled={!nextDirectMdaFor(integratedComponent)}
            mdaDefaultSlots={(integratedComponent.mda ?? []).map((mda) =>
              defaultImpliesFields(selectedEntry, { ...integratedComponent, mda: [mda] }, config.sfm, ["mda"]) ? [mda.slot ?? 1] : []
            )}
            mdaDefaultTypes={(integratedComponent.mda ?? []).map((mda) =>
              directMdaOptions(selectedEntry, integratedComponent, config.sfm).filter((type) =>
                defaultImpliesFields(selectedEntry, { ...integratedComponent, mda: [{ ...mda, type }] }, config.sfm, ["mda"])
              )
            )}
            onAddMda={addIntegratedMda}
            onUpdateMda={updateIntegratedMda}
            onRemoveMda={removeIntegratedMda}
          />
        ) : (
          <>
            <ComponentSection
              title="Control modules"
              items={cpms}
              addLabel="Add CPM"
              addDisabled={!availableCpmSlots.length || !cpmOptions(selectedEntry, config.sfm).length}
              onAdd={addCpm}
              renderItem={({ component, index }) => (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <ComponentHeader
                label="CPM"
                component={component}
                onRemove={() => removeComponent(index)}
              />
              <Box sx={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 1.5, mt: 1.5 }}>
                <SlotSelect
                  label="Slot"
                  value={component.slot}
                  options={cpmSlotOptions}
                  defaultOptions={cpmSlotOptions.filter((slot) =>
                    defaultImpliesFields(selectedEntry, { ...component, slot }, config.sfm, [])
                  )}
                  onChange={(slot) => updateComponent(index, { slot })}
                />
                <FieldAutocomplete
                  label="Type"
                  value={component.type ?? ""}
                  options={cpmOptions(selectedEntry, config.sfm)}
                  defaultOptions={cpmOptions(selectedEntry, config.sfm).filter((type) =>
                    defaultImpliesFields(selectedEntry, { ...component, type }, config.sfm, [])
                  )}
                  onChange={(type) => updateComponent(index, { type })}
                  allowFreeText={false}
                />
              </Box>
            </Paper>
              )}
            />

            <ComponentSection
              title="Line cards"
              items={cards}
              addLabel="Add card"
              addDisabled={!availableCardSlots.length || !componentTypeOptions(selectedEntry, {}, config.sfm).length}
              onAdd={addCard}
              renderItem={({ component, index }) => (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <ComponentHeader
                label="Line card"
                component={component}
                onRemove={() => removeComponent(index)}
              />
              <Box sx={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 1.5, mt: 1.5 }}>
                <SlotSelect
                  label="Slot"
                  value={component.slot}
                  options={cardSlotOptions}
                  defaultOptions={cardSlotOptions.filter((slot) =>
                    defaultImpliesFields(selectedEntry, { ...component, slot }, config.sfm, [])
                  )}
                  onChange={(slot) => updateComponent(index, { slot })}
                />
                <FieldAutocomplete
                  label="Type"
                  value={component.type ?? ""}
                  options={componentTypeOptions(selectedEntry, { slot: component.slot }, config.sfm)}
                  defaultOptions={componentTypeOptions(selectedEntry, { slot: component.slot }, config.sfm).filter((type) =>
                    defaultImpliesFields(selectedEntry, { ...component, type }, config.sfm, [])
                  )}
                  onChange={(type) => updateComponent(index, { type })}
                  allowFreeText={false}
                />
              </Box>

              <NestedMdaSection
                title="Direct MDAs"
                mdas={component.mda ?? []}
                options={directMdaOptions(selectedEntry, component, config.sfm)}
                slotOptions={directMdaSlotsFor(component)}
                slotOptionsByMda={(component.mda ?? []).map((mda) => directMdaSlotsFor(component, mda.type))}
                addDisabled={!nextDirectMdaFor(component)}
                defaultSlots={(component.mda ?? []).map((mda) =>
                  defaultImpliesFields(selectedEntry, { ...component, mda: [mda] }, config.sfm, ["mda"]) ? [mda.slot ?? 1] : []
                )}
                defaultTypes={(component.mda ?? []).map((mda) =>
                  directMdaOptions(selectedEntry, component, config.sfm).filter((type) =>
                    defaultImpliesFields(selectedEntry, { ...component, mda: [{ ...mda, type }] }, config.sfm, ["mda"])
                  )
                )}
                onAdd={() => addMda(index)}
                onUpdate={(mdaIndex, updates) => updateMda(index, mdaIndex, updates)}
                onRemove={(mdaIndex) => removeMda(index, mdaIndex)}
              />

              <NestedXiomSection
                xioms={component.xiom ?? []}
                xiomOptions={xiomOptions(selectedEntry, component, config.sfm)}
                mdaOptionsByXiom={(component.xiom ?? []).map((xiom) => xiomMdaOptions(selectedEntry, component, xiom, config.sfm))}
                mdaSlotOptionsByXiom={(component.xiom ?? []).map((xiom) => xiomMdaSlotsFor(component, xiom))}
                mdaSlotOptionsByXiomMda={(component.xiom ?? []).map((xiom) =>
                  (xiom.mda ?? []).map((mda) => xiomMdaSlotsFor(component, xiom, mda.type))
                )}
                canAddMdaByXiom={(component.xiom ?? []).map((xiom) => Boolean(nextXiomMdaFor(component, xiom)))}
                xiomSlotOptions={xiomSlotOptions}
                xiomDefaultSlots={(component.xiom ?? []).map((xiom) =>
                  defaultImpliesFields(selectedEntry, { ...component, xiom: [xiom] }, config.sfm, ["xiom", "mda"]) ? [1] : []
                )}
                xiomDefaultTypes={(component.xiom ?? []).map((xiom) =>
                  xiomOptions(selectedEntry, component, config.sfm).filter((type) =>
                    defaultImpliesFields(selectedEntry, { ...component, xiom: [{ ...xiom, type }] }, config.sfm, ["xiom", "mda"])
                  )
                )}
                mdaDefaultSlots={(component.xiom ?? []).map((xiom) =>
                  (xiom.mda ?? []).map((mda) =>
                    defaultImpliesFields(selectedEntry, { ...component, xiom: [{ ...xiom, mda: [mda] }] }, config.sfm, ["mda"]) ? [mda.slot ?? 1] : []
                  )
                )}
                mdaDefaultTypes={(component.xiom ?? []).map((xiom) =>
                  (xiom.mda ?? []).map((mda) =>
                    xiomMdaOptions(selectedEntry, component, xiom, config.sfm).filter((type) =>
                      defaultImpliesFields(
                        selectedEntry,
                        { ...component, xiom: [{ ...xiom, mda: [{ ...mda, type }] }] },
                        config.sfm,
                        ["mda"]
                      )
                    )
                  )
                )}
                onAdd={() => addXiom(index)}
                onUpdate={(xiomIndex, updates) => updateXiom(index, xiomIndex, updates)}
                onRemove={(xiomIndex) => removeXiom(index, xiomIndex)}
                onAddMda={(xiomIndex) => addXiomMda(index, xiomIndex)}
                onUpdateMda={(xiomIndex, mdaIndex, updates) => updateXiomMda(index, xiomIndex, mdaIndex, updates)}
                onRemoveMda={(xiomIndex, mdaIndex) => removeXiomMda(index, xiomIndex, mdaIndex)}
              />
            </Paper>
              )}
            />
          </>
        )}

        {mode === "eda" ? (
          <EdaInventorySection
            config={config}
            catalog={edaCatalog}
            onUpdateConfig={updateConfig}
            onUpdateEdaComponent={updateEdaComponent}
            onAddPowerComponent={addPowerComponent}
            onUpdatePowerComponent={updatePowerComponent}
            onRemovePowerComponent={removePowerComponent}
          />
        ) : null}
      </Stack>
    </Paper>
  );
}

function ComponentHeader({
  label,
  component,
  onRemove
}: {
  label: string;
  component: SrsimComponent;
  onRemove: () => void;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
        <Chip label={String(component.slot ?? "?")} size="small" />
        <Typography variant="subtitle2" noWrap>
          {label}
        </Typography>
        {component.type ? (
          <Typography variant="body2" color="text.secondary" noWrap>
            {component.type}
          </Typography>
        ) : null}
      </Stack>
      <Tooltip title="Remove component">
        <IconButton size="small" color="error" onClick={onRemove}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function EdaInventorySection({
  config,
  catalog,
  onUpdateConfig,
  onUpdateEdaComponent,
  onAddPowerComponent,
  onUpdatePowerComponent,
  onRemovePowerComponent
}: {
  config: SrsimConfig;
  catalog: EdaYangCatalog;
  onUpdateConfig: (updates: Partial<SrsimConfig>) => void;
  onUpdateEdaComponent: (index: number, updates: Partial<EdaTopoNodeComponent>) => void;
  onAddPowerComponent: (kind: "powerShelf" | "powerModule") => void;
  onUpdatePowerComponent: (index: number, updates: Partial<EdaTopoNodeComponent>) => void;
  onRemovePowerComponent: (index: number) => void;
}) {
  const powerShelves = config.edaComponents
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => component.kind === "powerShelf");
  const powerModules = config.edaComponents
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => component.kind === "powerModule");
  const powerShelfSlotOptions = edaPowerSlotsForChassis(catalog, config.chassis, "powerShelf");
  const powerModuleSlotOptions = edaPowerSlotsForChassis(catalog, config.chassis, "powerModule");
  const powerShelfTypeOptions = edaPowerTypesForChassis(catalog, config.chassis, "powerShelf");
  const powerModuleTypeOptions = edaPowerTypesForChassis(catalog, config.chassis, "powerModule");
  const strictPowerProfile = edaHasPowerProfileForChassis(catalog, config.chassis);
  const allowFreePowerText = !strictPowerProfile;
  const usedPowerShelfSlots = new Set(powerShelves.map(({ component }) => component.slot));
  const usedPowerModuleSlots = new Set(powerModules.map(({ component }) => component.slot));

  return (
    <Stack spacing={1.25}>
      <Divider />
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="subtitle1">EDA inventory</Typography>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" }, gap: 1.5 }}>
        <TextField
          label="Namespace"
          size="small"
          value={config.edaNamespace}
          onChange={(event) => onUpdateConfig({ edaNamespace: event.target.value })}
        />
        <TextField
          label="Node profile"
          size="small"
          value={config.edaNodeProfile}
          onChange={(event) => onUpdateConfig({ edaNodeProfile: event.target.value })}
        />
        <TextField
          label="Version"
          size="small"
          value={config.edaVersion}
          onChange={(event) => onUpdateConfig({ edaVersion: event.target.value })}
        />
      </Box>

      <EdaConnectorSection
        config={config}
        catalog={catalog}
        onUpdate={onUpdateEdaComponent}
      />

      <EdaPowerSection
        title="Power shelves"
        addLabel="Add shelf"
        rows={powerShelves}
        slotOptions={powerShelfSlotOptions}
        typeOptions={powerShelfTypeOptions}
        allowFreeText={allowFreePowerText}
        addDisabled={!allowFreePowerText && !powerShelfSlotOptions.some((slot) => !usedPowerShelfSlots.has(slot))}
        onAdd={() => onAddPowerComponent("powerShelf")}
        onUpdate={onUpdatePowerComponent}
        onRemove={onRemovePowerComponent}
      />

      <EdaPowerSection
        title="Power modules"
        addLabel="Add module"
        rows={powerModules}
        slotOptions={powerModuleSlotOptions}
        typeOptions={powerModuleTypeOptions}
        allowFreeText={allowFreePowerText}
        addDisabled={!allowFreePowerText && !powerModuleSlotOptions.some((slot) => !usedPowerModuleSlots.has(slot))}
        onAdd={() => onAddPowerComponent("powerModule")}
        onUpdate={onUpdatePowerComponent}
        onRemove={onRemovePowerComponent}
      />
    </Stack>
  );
}

function EdaConnectorSection({
  config,
  catalog,
  onUpdate
}: {
  config: SrsimConfig;
  catalog: EdaYangCatalog;
  onUpdate: (index: number, updates: Partial<EdaTopoNodeComponent>) => void;
}) {
  const mdaRows = config.edaComponents
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => component.kind === "mda")
    .sort((left, right) => edaComponentSort(left.component, right.component));
  const connectorRows = config.edaComponents
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => component.kind === "connector")
    .sort((left, right) => edaComponentSort(left.component, right.component));

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Connector breakout planner</Typography>
      {connectorRows.length ? mdaRows.map(({ component: mda }) => {
        const rows = connectorRows.filter(({ component }) => edaConnectorParentSlot(component.slot) === mda.slot);
        if (!rows.length) return null;
        const splitCount = rows.filter(({ component }) => edaConnectorBreakoutMode(component.type).channels > 1).length;
        return (
          <Accordion
            key={mda.slot}
            defaultExpanded={splitCount > 0}
            disableGutters
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              boxShadow: "none",
              "&:before": { display: "none" },
              "&.Mui-expanded": { my: 0 }
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 48, "& .MuiAccordionSummary-content": { minWidth: 0 } }}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ minWidth: 0 }}>
                <Chip label={mda.slot} size="small" />
                <Typography variant="subtitle2" noWrap>
                  {mda.type}
                </Typography>
                <Chip label={`${rows.length} connectors`} size="small" variant="outlined" />
                {splitCount ? <Chip label={`${splitCount} split`} size="small" color="secondary" /> : null}
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Stack spacing={1}>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "110px minmax(210px, 1fr) 150px minmax(180px, 1fr)" },
                  gap: 1
                }}
              >
                {rows.map(({ component, index }) => {
                  const compatibility = edaConnectorCompatibility(catalog, config.edaComponents, component.slot);
                  const value = compatibility.options.includes(component.type) ? component.type : "";
                  const mode = edaConnectorBreakoutMode(value || component.type);
                  const split = mode.channels > 1;
                  return (
                    <Box key={component.slot} sx={{ display: "contents" }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                        <Chip label={component.slot} size="small" color={split ? "secondary" : "default"} />
                      </Stack>
                      <FormControl size="small" fullWidth disabled={!compatibility.options.length}>
                        <InputLabel id={`connector-${component.slot}-label`}>Breakout</InputLabel>
                        <Select
                          labelId={`connector-${component.slot}-label`}
                          label="Breakout"
                          value={value}
                          onChange={(event) => onUpdate(index, { type: event.target.value })}
                        >
                          {compatibility.options.map((option) => (
                            <MenuItem key={option} value={option}>
                              {edaConnectorBreakoutLabel(option)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Chip
                        label={mode.impact}
                        size="small"
                        variant={split ? "filled" : "outlined"}
                        color={split ? "secondary" : "default"}
                        sx={{ justifySelf: { md: "start" } }}
                      />
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        noWrap
                        sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {split ? `${mode.channels} logical ports` : `single ${mode.speed || "port"}`}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
              </Stack>
            </AccordionDetails>
          </Accordion>
        );
      }) : (
        <Typography variant="body2" color="text.secondary">
          No entries configured.
        </Typography>
      )}
    </Stack>
  );
}

function EdaPowerSection({
  title,
  addLabel,
  rows,
  slotOptions,
  typeOptions,
  allowFreeText,
  addDisabled,
  onAdd,
  onUpdate,
  onRemove
}: {
  title: string;
  addLabel: string;
  rows: Array<{ component: EdaTopoNodeComponent; index: number }>;
  slotOptions: string[];
  typeOptions: string[];
  allowFreeText: boolean;
  addDisabled: boolean;
  onAdd: () => void;
  onUpdate: (index: number, updates: Partial<EdaTopoNodeComponent>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Stack spacing={1}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={onAdd} disabled={addDisabled}>
          {addLabel}
        </Button>
      </Box>
      {rows.length ? rows.map(({ component, index }) => (
        <Box
          key={`${component.kind}-${index}`}
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "116px minmax(0, 1fr) auto" },
            gap: 1,
            alignItems: "center"
          }}
        >
          {allowFreeText ? (
            <TextField
              label="Slot"
              size="small"
              value={component.slot}
              onChange={(event) => onUpdate(index, { slot: event.target.value })}
            />
          ) : (
            <SlotSelect
              label="Slot"
              value={component.slot}
              options={slotOptions}
              onChange={(slot) => onUpdate(index, { slot: String(slot) })}
            />
          )}
          <FieldAutocomplete
            label="Type"
            value={component.type}
            options={typeOptions}
            onChange={(type) => onUpdate(index, { type })}
            allowFreeText={allowFreeText || !typeOptions.length}
          />
          <Tooltip title={`Remove ${title.toLowerCase()}`}>
            <IconButton size="small" color="error" onClick={() => onRemove(index)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )) : (
        <Typography variant="body2" color="text.secondary">
          No entries configured.
        </Typography>
      )}
    </Stack>
  );
}

function IntegratedComponentSection({
  component,
  mdaOptions: mdaTypeOptions,
  mdaSlotOptions,
  slotOptionsByMda,
  addMdaDisabled,
  mdaDefaultSlots,
  mdaDefaultTypes,
  onAddMda,
  onUpdateMda,
  onRemoveMda
}: {
  component: SrsimComponent;
  mdaOptions: string[];
  mdaSlotOptions: number[];
  slotOptionsByMda?: number[][];
  addMdaDisabled?: boolean;
  mdaDefaultSlots?: SlotOption[][];
  mdaDefaultTypes?: string[][];
  onAddMda: () => void;
  onUpdateMda: (index: number, updates: Partial<SrsimMda>) => void;
  onRemoveMda: (index: number) => void;
}) {
  return (
    <Stack spacing={1.25}>
      <Divider />
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="subtitle1">Integrated component</Typography>
      </Box>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Chip label={String(component.slot ?? "A")} size="small" />
          <Typography variant="subtitle2" noWrap>
            CPM
          </Typography>
          {component.type ? (
            <Typography variant="body2" color="text.secondary" noWrap>
              {component.type}
            </Typography>
          ) : null}
        </Stack>
        <NestedMdaSection
          title="MDAs"
          mdas={component.mda ?? []}
          options={mdaTypeOptions}
          slotOptions={mdaSlotOptions}
          slotOptionsByMda={slotOptionsByMda}
          addDisabled={addMdaDisabled}
          defaultSlots={mdaDefaultSlots}
          defaultTypes={mdaDefaultTypes}
          onAdd={onAddMda}
          onUpdate={onUpdateMda}
          onRemove={onRemoveMda}
        />
      </Paper>
    </Stack>
  );
}

function ComponentSection({
  title,
  items,
  addLabel,
  addDisabled,
  onAdd,
  renderItem
}: {
  title: string;
  items: IndexedComponent[];
  addLabel: string;
  addDisabled?: boolean;
  onAdd: () => void;
  renderItem: (item: IndexedComponent) => React.ReactNode;
}) {
  return (
    <Stack spacing={1.25}>
      <Divider />
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="subtitle1">{title}</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={onAdd} disabled={addDisabled}>
          {addLabel}
        </Button>
      </Box>
      {items.length ? (
        <Stack spacing={1.25}>{items.map((item) => <Box key={item.index}>{renderItem(item)}</Box>)}</Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No entries configured.
        </Typography>
      )}
    </Stack>
  );
}

function withCurrentSlotOption(options: SlotOption[], value: SlotOption | undefined): SlotOption[] {
  if (value === undefined || value === "") return options;
  return options.some((option) => String(option) === String(value)) ? options : [...options, value];
}

function slotFromSelectValue(value: string, options: SlotOption[]): SlotOption {
  const option = options.find((candidate) => String(candidate) === value);
  if (option !== undefined) return option;
  return /^\d+$/.test(value) ? Number(value) : value.toUpperCase();
}

function SlotSelect({
  label,
  value,
  options,
  defaultOptions = [],
  onChange
}: {
  label: string;
  value?: SlotOption;
  options: SlotOption[];
  defaultOptions?: SlotOption[];
  onChange: (slot: SlotOption) => void;
}) {
  const visibleOptions = withCurrentSlotOption(options, value);
  const defaultSet = new Set(defaultOptions.map((option) => String(option)));
  const optionLabel = (option: SlotOption) => defaultSet.has(String(option)) ? `${String(option)} (default)` : String(option);
  const selectedLabel = (selected: unknown) => {
    const text = String(selected);
    return defaultSet.has(text) ? `${text} default` : text;
  };

  return (
    <FormControl size="small" fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select
        label={label}
        value={value === undefined || value === "" ? "" : String(value)}
        renderValue={selectedLabel}
        onChange={(event: SelectChangeEvent) => onChange(slotFromSelectValue(event.target.value, visibleOptions))}
      >
        {visibleOptions.map((option) => (
          <MenuItem key={String(option)} value={String(option)}>
            {optionLabel(option)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function NestedMdaSection({
  title,
  mdas,
  options,
  slotOptions,
  slotOptionsByMda,
  addDisabled,
  defaultSlots,
  defaultTypes,
  onAdd,
  onUpdate,
  onRemove
}: {
  title: string;
  mdas: SrsimMda[];
  options: string[];
  slotOptions: number[];
  slotOptionsByMda?: number[][];
  addDisabled?: boolean;
  defaultSlots?: SlotOption[][];
  defaultTypes?: string[][];
  onAdd: () => void;
  onUpdate: (index: number, updates: Partial<SrsimMda>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={onAdd} disabled={addDisabled}>
          Add
        </Button>
      </Box>
      {mdas.map((mda, index) => (
        <Box
          key={index}
          sx={{
            display: "grid",
            gridTemplateColumns: nestedComponentGridColumns,
            gap: 1,
            alignItems: "center"
          }}
        >
          <SlotSelect
            label="Slot"
            value={mda.slot}
            options={slotOptionsByMda?.[index] ?? slotOptions}
            defaultOptions={defaultSlots?.[index] ?? []}
            onChange={(slot) => onUpdate(index, { slot })}
          />
          <FieldAutocomplete
            label="Type"
            value={mda.type ?? ""}
            options={options}
            defaultOptions={defaultTypes?.[index] ?? []}
            onChange={(type) => onUpdate(index, { type })}
            allowFreeText={false}
          />
          <IconButton size="small" color="error" onClick={() => onRemove(index)} sx={{ justifySelf: { xs: "end", sm: "auto" } }}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
    </Stack>
  );
}

function NestedXiomSection({
  xioms,
  xiomOptions: xiomTypeOptions,
  mdaOptionsByXiom,
  mdaSlotOptionsByXiom,
  mdaSlotOptionsByXiomMda,
  canAddMdaByXiom,
  xiomSlotOptions,
  xiomDefaultSlots,
  xiomDefaultTypes,
  mdaDefaultSlots,
  mdaDefaultTypes,
  onAdd,
  onUpdate,
  onRemove,
  onAddMda,
  onUpdateMda,
  onRemoveMda
}: {
  xioms: SrsimXiom[];
  xiomOptions: string[];
  mdaOptionsByXiom: string[][];
  mdaSlotOptionsByXiom: number[][];
  mdaSlotOptionsByXiomMda: number[][][];
  canAddMdaByXiom: boolean[];
  xiomSlotOptions: number[];
  xiomDefaultSlots?: SlotOption[][];
  xiomDefaultTypes?: string[][];
  mdaDefaultSlots?: SlotOption[][][];
  mdaDefaultTypes?: string[][][];
  onAdd: () => void;
  onUpdate: (index: number, updates: Partial<SrsimXiom>) => void;
  onRemove: (index: number) => void;
  onAddMda: (xiomIndex: number) => void;
  onUpdateMda: (xiomIndex: number, mdaIndex: number, updates: Partial<SrsimMda>) => void;
  onRemoveMda: (xiomIndex: number, mdaIndex: number) => void;
}) {
  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="subtitle2">XIOMs</Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={onAdd}
          disabled={!xiomTypeOptions.length || !availableNumericSlotOptions(xiomSlotOptions, xioms).length}
        >
          Add XIOM
        </Button>
      </Box>
      {xioms.map((xiom, xiomIndex) => (
        <Paper key={xiomIndex} variant="outlined" sx={{ p: 1.25, bgcolor: "action.hover" }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: nestedComponentGridColumns,
              gap: 1,
              alignItems: "center"
            }}
          >
            <SlotSelect
              label="Slot"
              value={xiom.slot}
              options={xiomSlotOptions}
              defaultOptions={xiomDefaultSlots?.[xiomIndex] ?? []}
              onChange={(slot) => onUpdate(xiomIndex, { slot })}
            />
            <FieldAutocomplete
              label="XIOM type"
              value={xiom.type ?? ""}
              options={xiomTypeOptions}
              defaultOptions={xiomDefaultTypes?.[xiomIndex] ?? []}
              onChange={(type) => onUpdate(xiomIndex, { type })}
              allowFreeText={false}
            />
            <IconButton size="small" color="error" onClick={() => onRemove(xiomIndex)} sx={{ justifySelf: { xs: "end", sm: "auto" } }}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>
          <NestedMdaSection
            title="XIOM MDAs"
            mdas={xiom.mda ?? []}
            options={mdaOptionsByXiom[xiomIndex] ?? []}
            slotOptions={mdaSlotOptionsByXiom[xiomIndex] ?? []}
            slotOptionsByMda={mdaSlotOptionsByXiomMda[xiomIndex] ?? []}
            addDisabled={!canAddMdaByXiom[xiomIndex]}
            defaultSlots={mdaDefaultSlots?.[xiomIndex]}
            defaultTypes={mdaDefaultTypes?.[xiomIndex]}
            onAdd={() => onAddMda(xiomIndex)}
            onUpdate={(mdaIndex, updates) => onUpdateMda(xiomIndex, mdaIndex, updates)}
            onRemove={(mdaIndex) => onRemoveMda(xiomIndex, mdaIndex)}
          />
        </Paper>
      ))}
    </Stack>
  );
}
