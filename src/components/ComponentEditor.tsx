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
import type { ReactNode } from "react";

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
  componentCardSlotCount,
  componentCardSlotOptions,
  componentCpmSlotOptions,
  componentTypeOptions,
  cpmOptions,
  defaultComponentsForEntry,
  defaultSfmForEntry,
  directMdaSlotOptions,
  directMdaOptions,
  type DeploymentMode,
  deploymentMode,
  freeXcmModuleSlots,
  getEntry,
  isCpmSlot,
  nextCpmSlot,
  nextNumericSlot,
  onlyChoice,
  slotCountLabel,
  sfmOptions,
  xiomMdaSlotOptions,
  withReplacedModules,
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

import {
  builtInMdas,
  chassisVariants,
  cpmCarriers,
  fittingCarrier,
  pinnedOptions,
  variantOf,
  variantSlotType
} from "../hardwareModel";
import type { ChassisVariant, CpmCarrier } from "../hardwareModel";
import { chassisGroup, chassisGroupOrder, generationGroup, generationGroupOrder, productHelp } from "../productNames";
import {
  componentWithXcmModules,
  hasXcmModules,
  variantModule,
  xcmIomOptions,
  xcmModuleSlotOptions,
  xcmModulesFromComponent,
  xcmXmaOptions
} from "../xcmModules";
import type { XcmModule, XcmModuleKind } from "../xcmModules";
import { FieldAutocomplete, OptionText } from "./FieldAutocomplete";

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

/** A chassis dropdown entry: a chassis type, or one physical product of it. */
interface ChassisChoice {
  key: string;
  chassis: string;
  variant?: ChassisVariant;
}
const nestedComponentGridColumns = { xs: "1fr", sm: "120px minmax(0, 1fr) auto" } as const;
const nestedSlotCount = 2;

// Labels describe how SR-SIM runs the chassis (Nokia's integrated vs. distributed model),
// not the hardware: fixed FP5 platforms such as the SR-1x still need several containers.
function deploymentModeLabel(mode: DeploymentMode): string {
  if (mode === "distributed") return "Multi-container";
  if (mode === "integrated_redundant") return "Single container (redundant)";
  return "Single container";
}

function deploymentModeDescription(mode: DeploymentMode): string {
  if (mode === "distributed") return "SR-SIM runs one container per CPM and per line card.";
  if (mode === "integrated_redundant") return "SR-SIM runs one combined container, or two for CPM redundancy.";
  return "SR-SIM runs the whole router in one container.";
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
  // One chassis entry per physical product: SR-SIM runs some products as one chassis type.
  const chassisChoices = useMemo(
    () =>
      matrix.flatMap((entry): ChassisChoice[] => {
        const variants = chassisVariants(entry.chassis);
        return variants.length
          ? variants.map((variant) => ({ key: `${entry.chassis}:${variant.name}`, chassis: entry.chassis, variant }))
          : [{ key: entry.chassis, chassis: entry.chassis }];
      }),
    [matrix]
  );
  const chassisChoice = (key: string) => chassisChoices.find((choice) => choice.key === key);
  const chassisDeploymentLabels = useMemo(
    () => Object.fromEntries(matrix.map((entry) => [entry.chassis, deploymentModeLabel(deploymentMode(entry))])),
    [matrix]
  );
  const integratedComponent = config.components[0] ?? { mda: [] };
  const variants = chassisVariants(config.chassis);
  // The product is fixed hardware: once chosen it stays, even when its module is removed.
  // Unchosen, it follows the installed parts, else it is the variant without limits, else the first.
  const selectedVariant =
    variants.find((variant) => variant.name === config.hardwareVariant) ??
    variantOf(config.chassis, config.components) ??
    variants.find((variant) => !variant.parts.length && !variant.sfm?.length) ??
    variants[0];
  const variantFitsSfm = (sfm: string) => !selectedVariant?.sfm?.length || selectedVariant.sfm.includes(sfm);
  const sharedSfmOptions = sfmOptions(selectedEntry, []).filter(variantFitsSfm);
  const entryDefaultSfm = defaultSfmForEntry(selectedEntry);
  const defaultSfm = variantFitsSfm(entryDefaultSfm) ? entryDefaultSfm : "";
  const sfmAvailable = Boolean(defaultSfm || sharedSfmOptions.length);

  const indexed = config.components.map((component, index) => ({ component, index }));
  const cpms = indexed.filter(({ component }) => isCpmSlot(component.slot));
  const cards = indexed.filter(({ component }) => !isCpmSlot(component.slot));

  // The CMA decides which CPM types fit, how many, and whether it takes a line-card slot.
  const carriers = distributed ? cpmCarriers(config.chassis) : [];
  const usedCardSlotNumbers = new Set(cards.map(({ component }) => Number(component.slot)));
  const carrierBlockedReason = (carrier: CpmCarrier, sfm: string): string => {
    if (!carrier.cpmTypes.some((type) => cpmOptions(selectedEntry, sfm).includes(type))) {
      return `needs ${carrier.cpmTypes.join("/")}, which ${sfm || "this SFM"} does not support`;
    }
    const taken = carrier.blocksLineSlots.filter((slot) => usedCardSlotNumbers.has(slot));
    return taken.length ? `line-card slot ${taken.join(", ")} is in use` : "";
  };
  const carrierFor = (sfm: string, chosen = config.cma): CpmCarrier | undefined => {
    const usable = (carrier?: CpmCarrier) => (carrier && !carrierBlockedReason(carrier, sfm) ? carrier : undefined);
    return (
      usable(carriers.find((carrier) => carrier.type === chosen)) ??
      usable(fittingCarrier(config.chassis, config.components)) ??
      carriers.find((carrier) => !carrierBlockedReason(carrier, sfm))
    );
  };
  const selectedCarrier = carrierFor(config.sfm);
  const carrierCpmOptions = (sfm: string, carrier = carrierFor(sfm)) =>
    pinnedOptions(
      selectedVariant,
      cpmOptions(selectedEntry, sfm).filter((type) => !carrier || carrier.cpmTypes.includes(type))
    );

  const cpmSlotOptions = selectedCarrier
    ? selectedCarrier.cpmSlots
    : componentCpmSlotOptions(selectedEntry, slotRules.componentStringSlots);
  const cardSlotOptions = componentCardSlotOptions(
    selectedEntry,
    cards.map(({ component }) => component),
    slotRules.componentIntegerMinimum
  ).filter((slot) => !selectedCarrier?.blocksLineSlots.includes(slot));
  const usedCpmSlots = new Set(cpms.map(({ component }) => String(component.slot ?? "").toUpperCase()));
  const usedCardSlots = new Set(cards.map(({ component }) => String(component.slot ?? "")));
  const availableCpmSlots = cpmSlotOptions.filter((slot) => !usedCpmSlots.has(String(slot).toUpperCase()));
  const availableCardSlots = cardSlotOptions.filter((slot) => !usedCardSlots.has(String(slot)));

  const updateConfig = (updates: Partial<SrsimConfig>) => onChange({ ...config, ...updates });

  const directMdaSlotsFor = (component: SrsimComponent, mdaType = "") =>
    freeXcmModuleSlots(
      component.type,
      directMdaSlotOptions(selectedEntry, component, config.sfm, nestedSlotCount, slotRules.mdaIntegerMinimum, mdaType),
      component.xiom
    );

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

  const setChassis = (key: string) => {
    const choice = chassisChoice(key);
    if (!choice) return;
    const { chassis, variant } = choice;
    const entry = getEntry(matrix, chassis);
    const entrySfm = defaultSfmForEntry(entry);
    const components = defaultComponentsForEntry(entry).map((component) => {
      if (!variant) return component;
      const pinned = variantSlotType(chassis, component.slot, variant);
      if (pinned && pinned !== component.type) {
        // Only the default card's built-in MDA is implied; a pinned one is written out.
        const mda = isCpmSlot(component.slot) ? [] : builtInMdas(pinned);
        return { slot: component.slot, type: pinned, ...(mda.length ? { mda } : {}) };
      }
      const module = variantModule(variant);
      return module && hasXcmModules(entry, component) ? componentWithXcmModules(entry, component, [module], entrySfm) : component;
    });
    updateConfig({
      chassis,
      components,
      sfm: variant?.sfm?.length && !variant.sfm.includes(entrySfm) ? variant.sfm[0] : entrySfm,
      cma: undefined,
      hardwareVariant: variant?.name,
      edaComponents: []
    });
  };

  const normalizeComponent = (component: SrsimComponent, sfm: string, carrier = carrierFor(sfm)): SrsimComponent => {
    if (distributed && isCpmSlot(component.slot)) {
      const options = carrierCpmOptions(sfm, carrier);
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

  const normalizeComponents = (components: SrsimComponent[], sfm: string, carrier = carrierFor(sfm)) =>
    components
      .filter((component) => !carrier || !isCpmSlot(component.slot) || carrier.cpmSlots.includes(String(component.slot).toUpperCase()))
      .map((component) => normalizeComponent(component, sfm, carrier))
      .filter((item) => item.mda?.length || item.xiom?.length || item.type);

  const setComponents = (components: SrsimComponent[], extra: Partial<SrsimConfig> = {}) => {
    let nextSfm = config.sfm;
    let cleanComponents = normalizeComponents(components, nextSfm);
    const compatibleSfms = sfmOptions(selectedEntry, cleanComponents);
    if (compatibleSfms.length && !compatibleSfms.includes(nextSfm)) {
      nextSfm = compatibleSfms.includes(defaultSfm) ? defaultSfm : compatibleSfms[0];
      cleanComponents = normalizeComponents(components, nextSfm);
    }
    updateConfig({
      ...extra,
      components: cleanComponents,
      sfm: nextSfm
    });
  };

  const setIntegratedComponent = (component: SrsimComponent, extra: Partial<SrsimConfig> = {}) => {
    setComponents([withoutEmptyNested(component)].filter((item) => item.mda?.length || item.type), extra);
  };

  const applyCarrier = (type: string) => {
    const carrier = carriers.find((candidate) => candidate.type === type);
    if (!carrier) return;
    const components = normalizeComponents(config.components, config.sfm, carrier);
    const hasCpm = components.some((component) => isCpmSlot(component.slot));
    updateConfig({
      cma: type,
      components: hasCpm ? components : [{ slot: "A", type: carrierCpmOptions(config.sfm, carrier)[0] ?? "" }, ...components]
    });
  };

  const applySfm = (sfm: string, extra: Partial<SrsimConfig> = {}) => {
    const nextSfm = sfm || defaultSfm || sharedSfmOptions[0] || "";
    const components = normalizeComponents(config.components, nextSfm).map((after) => {
      const before = config.components.find((component) => String(component.slot) === String(after.slot));
      return before ? withReplacedModules(selectedEntry, before, after, nextSfm) : after;
    });
    updateConfig({ sfm: nextSfm, components, ...extra });
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
    setComponents([...config.components, { slot, type: carrierCpmOptions(config.sfm)[0] ?? "" }]);
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
      cma: undefined,
      hardwareVariant: undefined,
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

  const setModules = (componentIndex: number, modules: XcmModule[]) => {
    const next = [...config.components];
    next[componentIndex] = componentWithXcmModules(selectedEntry, next[componentIndex], modules, config.sfm);
    setComponents(next);
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
              <Tooltip title={deploymentModeDescription(selectedDeploymentMode)}>
                <Chip size="small" variant="outlined" label={deploymentModeLabel(selectedDeploymentMode)} />
              </Tooltip>
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
          value={selectedVariant ? `${config.chassis}:${selectedVariant.name}` : config.chassis}
          options={chassisChoices.map((choice) => choice.key)}
          optionLabels={Object.fromEntries(
            chassisChoices.flatMap((choice) =>
              choice.variant ? [[choice.key, choice.variant.name]] : []
            )
          )}
          optionDescription={(key) => {
            const choice = chassisChoice(key);
            return choice?.variant ? choice.variant.description : productHelp(choice?.chassis ?? key);
          }}
          groupBy={(key) => chassisGroup(chassisChoice(key)?.chassis ?? key)}
          groupOrder={chassisGroupOrder}
          optionAdornment={(key) => (
            <Chip
              size="small"
              variant="outlined"
              label={chassisDeploymentLabels[chassisChoice(key)?.chassis ?? key] ?? deploymentModeLabel(selectedDeploymentMode)}
              sx={{ flex: "0 0 auto", pointerEvents: "none" }}
            />
          )}
          onChange={setChassis}
          allowFreeText={false}
        />
        <FormControl
          size="small"
          fullWidth
          disabled={!sfmAvailable || onlyChoice([defaultSfm, ...sharedSfmOptions].filter(Boolean), config.sfm || defaultSfm)}
        >
          <InputLabel id="sfm-select-label" shrink={sfmAvailable ? undefined : true}>SFM</InputLabel>
          <Select
            labelId="sfm-select-label"
            label="SFM"
            notched={sfmAvailable ? undefined : true}
            displayEmpty={!sfmAvailable}
            value={sfmAvailable ? config.sfm || defaultSfm : ""}
            renderValue={(sfm) => (sfmAvailable ? sfm : "N/A")}
            onChange={(event) => applySfm(event.target.value)}
          >
            {defaultSfm ? (
              <MenuItem value={defaultSfm}>
                <OptionText label={defaultSfm} description={productHelp(defaultSfm)} />
              </MenuItem>
            ) : null}
            {sharedSfmOptions
              .filter((sfm) => sfm !== defaultSfm)
              .map((sfm) => (
                <MenuItem key={sfm} value={sfm}>
                  <OptionText label={sfm} description={productHelp(sfm)} />
                </MenuItem>
              ))}
          </Select>
          {sfmAvailable ? <FormHelperText>Set once on the node and applies to the whole chassis.</FormHelperText> : null}
        </FormControl>

        {!distributed ? (
          <IntegratedComponentSection
            component={integratedComponent}
            mdaOptions={directMdaOptions(selectedEntry, integratedComponent, config.sfm)}
            mdaSlotOptions={directMdaSlotsFor(integratedComponent)}
            slotOptionsByMda={(integratedComponent.mda ?? []).map((mda) => directMdaSlotsFor(integratedComponent, mda.type))}
            addMdaDisabled={!nextDirectMdaFor(integratedComponent)}
            onAddMda={addIntegratedMda}
            onUpdateMda={updateIntegratedMda}
            onRemoveMda={removeIntegratedMda}
            modules={
              hasXcmModules(selectedEntry, integratedComponent) ? (
                <XcmModuleSection
                  entry={selectedEntry}
                  component={integratedComponent}
                  sfm={config.sfm}
                  mdaSlotsFor={(iom, mdaType) => xiomMdaSlotsFor(integratedComponent, iom, mdaType)}
                  nextMdaFor={(iom) => nextXiomMdaFor(integratedComponent, iom)}
                  onChange={(modules) =>
                    setIntegratedComponent(componentWithXcmModules(selectedEntry, integratedComponent, modules, config.sfm))
                  }
                  variant={selectedVariant}
                />
              ) : undefined
            }
          />
        ) : (
          <>
            {carriers.length ? (
              <Stack spacing={1.25}>
                <Divider />
                <Typography variant="subtitle1">Control modules</Typography>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="cma-select-label">CMA</InputLabel>
                    <Select
                      labelId="cma-select-label"
                      label="CMA"
                      value={selectedCarrier?.type ?? ""}
                      renderValue={(type) => carriers.find((carrier) => carrier.type === type)?.label ?? type}
                      onChange={(event) => applyCarrier(event.target.value)}
                    >
                      {carriers.map((carrier) => {
                        const reason = carrierBlockedReason(carrier, config.sfm);
                        return (
                          <MenuItem key={carrier.type} value={carrier.type} disabled={Boolean(reason)}>
                            <Box sx={{ display: "flex", flexDirection: "column" }}>
                              {carrier.label}
                              <Typography variant="caption" color="text.secondary">
                                {reason || carrier.description}
                              </Typography>
                            </Box>
                          </MenuItem>
                        );
                      })}
                    </Select>
                  </FormControl>
                  <Stack spacing={1} sx={{ mt: 1.5 }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                      <Typography variant="subtitle2">CPMs</Typography>
                      <Button
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={addCpm}
                        disabled={!availableCpmSlots.length || !carrierCpmOptions(config.sfm).length}
                      >
                        Add
                      </Button>
                    </Box>
                    {cpms.map(({ component, index }) => (
                      <Box
                        key={index}
                        sx={{ display: "grid", gridTemplateColumns: nestedComponentGridColumns, gap: 1, alignItems: "center" }}
                      >
                        <SlotSelect
                          label="Slot"
                          value={component.slot}
                          options={cpmSlotOptions}
                          onChange={(slot) => updateComponent(index, { slot })}
                        />
                        <FieldAutocomplete
                          label="Type"
                          value={component.type ?? ""}
                          options={carrierCpmOptions(config.sfm)}
                          onChange={(type) => updateComponent(index, { type })}
                          allowFreeText={false}
                        />
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => removeComponent(index)}
                          sx={{ justifySelf: { xs: "end", sm: "auto" } }}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                  </Stack>
                </Paper>
              </Stack>
            ) : (
            <ComponentSection
              title="Control modules"
              count={{ used: cpms.length, max: cpmSlotOptions.length }}
              items={cpms}
              addLabel="Add CPM"
              addDisabled={!availableCpmSlots.length || !carrierCpmOptions(config.sfm).length}
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
                  onChange={(slot) => updateComponent(index, { slot })}
                />
                <FieldAutocomplete
                  label="Type"
                  value={component.type ?? ""}
                  options={carrierCpmOptions(config.sfm)}
                  onChange={(type) => updateComponent(index, { type })}
                  allowFreeText={false}
                />
              </Box>
            </Paper>
              )}
            />
            )}

            <ComponentSection
              title="Line cards"
              count={{ used: cards.length, max: componentCardSlotCount(selectedEntry, slotRules.componentIntegerMinimum) }}
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
                  onChange={(slot) => updateComponent(index, { slot })}
                />
                <FieldAutocomplete
                  label="Type"
                  value={component.type ?? ""}
                  options={pinnedOptions(selectedVariant, componentTypeOptions(selectedEntry, { slot: component.slot }, config.sfm))}
                  onChange={(type) => updateComponent(index, { type })}
                  allowFreeText={false}
                />
              </Box>

              {hasXcmModules(selectedEntry, component) ? (
                <XcmModuleSection
                  entry={selectedEntry}
                  component={component}
                  sfm={config.sfm}
                  mdaSlotsFor={(iom, mdaType) => xiomMdaSlotsFor(component, iom, mdaType)}
                  nextMdaFor={(iom) => nextXiomMdaFor(component, iom)}
                  onChange={(modules) => setModules(index, modules)}
                />
              ) : (
                <NestedMdaSection
                  title="MDAs"
                  mdas={component.mda ?? []}
                  options={directMdaOptions(selectedEntry, component, config.sfm)}
                  slotOptions={directMdaSlotsFor(component)}
                  slotOptionsByMda={(component.mda ?? []).map((mda) => directMdaSlotsFor(component, mda.type))}
                  addDisabled={!nextDirectMdaFor(component)}
                  onAdd={() => addMda(index)}
                  onUpdate={(mdaIndex, updates) => updateMda(index, mdaIndex, updates)}
                  onRemove={(mdaIndex) => removeMda(index, mdaIndex)}
                />
              )}
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
  onAddMda,
  onUpdateMda,
  onRemoveMda,
  modules
}: {
  component: SrsimComponent;
  mdaOptions: string[];
  mdaSlotOptions: number[];
  slotOptionsByMda?: number[][];
  addMdaDisabled?: boolean;
  onAddMda: () => void;
  onUpdateMda: (index: number, updates: Partial<SrsimMda>) => void;
  onRemoveMda: (index: number) => void;
  /** Module sections that replace the MDA list when the card takes XMAs or IOMs. */
  modules?: ReactNode;
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
        {modules ?? (
          <NestedMdaSection
            title="MDAs"
            mdas={component.mda ?? []}
            options={mdaTypeOptions}
            slotOptions={mdaSlotOptions}
            slotOptionsByMda={slotOptionsByMda}
            addDisabled={addMdaDisabled}
            onAdd={onAddMda}
            onUpdate={onUpdateMda}
            onRemove={onRemoveMda}
          />
        )}
      </Paper>
    </Stack>
  );
}

function ComponentSection({
  title,
  count,
  items,
  addLabel,
  addDisabled,
  onAdd,
  renderItem
}: {
  title: string;
  /** Configured and maximum number of components, shown after the title. */
  count?: { used: number; max: number };
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
        <Typography variant="subtitle1">
          {title}
          {count ? (
            <Box component="span" sx={{ color: "text.secondary", ml: 1 }}>
              {slotCountLabel(count.used, count.max)}
            </Box>
          ) : null}
        </Typography>
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
  onChange
}: {
  label: string;
  value?: SlotOption;
  options: SlotOption[];
  onChange: (slot: SlotOption) => void;
}) {
  const visibleOptions = withCurrentSlotOption(options, value);

  return (
    <FormControl size="small" fullWidth disabled={onlyChoice(visibleOptions, value)}>
      <InputLabel>{label}</InputLabel>
      <Select
        label={label}
        value={value === undefined || value === "" ? "" : String(value)}
        onChange={(event: SelectChangeEvent) => onChange(slotFromSelectValue(event.target.value, visibleOptions))}
      >
        {visibleOptions.map((option) => (
          <MenuItem key={String(option)} value={String(option)}>
            {String(option)}
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
            onChange={(slot) => onUpdate(index, { slot })}
          />
          <FieldAutocomplete
            label="Type"
            value={mda.type ?? ""}
            options={options}
            groupBy={generationGroup}
            groupOrder={generationGroupOrder}
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

/** Module slots of an XCM: each holds an XMA, or an IOM with its MDAs. */
function XcmModuleSection({
  entry,
  component,
  sfm,
  mdaSlotsFor,
  nextMdaFor,
  onChange,
  variant
}: {
  entry: MatrixEntry | undefined;
  component: SrsimComponent;
  sfm: string;
  mdaSlotsFor: (iom: SrsimXiom, mdaType?: string) => number[];
  nextMdaFor: (iom: SrsimXiom) => SrsimMda | null;
  onChange: (modules: XcmModule[]) => void;
  /** Selected hardware variant; limits the modules to what that variant installs. */
  variant?: ChassisVariant;
}) {
  const modules = xcmModulesFromComponent(component);
  const slots = xcmModuleSlotOptions(entry, component);
  const optionsByKind: Record<XcmModuleKind, string[]> = {
    xma: xcmXmaOptions(entry, component, sfm).filter((type) => !variant?.parts.length || variant.parts.includes(type)),
    iom: xcmIomOptions(entry, component, sfm).filter((type) => !variant?.parts.length || variant.parts.includes(type))
  };
  const freeSlots = (own?: number) => slots.filter((slot) => slot === own || !modules.some((module) => module.slot === slot));
  const update = (target: XcmModule, updates: Partial<XcmModule>) =>
    onChange(modules.map((module) => (module === target ? { ...module, ...updates } : module)));
  const remove = (target: XcmModule) => onChange(modules.filter((module) => module !== target));
  const add = (kind: XcmModuleKind) => {
    const slot = freeSlots()[0];
    if (slot === undefined || !optionsByKind[kind].length) return;
    onChange([...modules, { slot, kind, type: optionsByKind[kind][0], mda: [] }]);
  };
  const slotText = slots.length === 1 ? "One module slot, for" : `${slots.length} module slots, each for`;

  const moduleRow = (module: XcmModule) => (
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
        value={module.slot}
        options={freeSlots(module.slot)}
        onChange={(slot) => update(module, { slot: Number(slot) })}
      />
      <FieldAutocomplete
        label={module.kind === "xma" ? "XMA type" : "IOM type"}
        value={module.type}
        options={optionsByKind[module.kind]}
        groupBy={generationGroup}
        groupOrder={generationGroupOrder}
        onChange={(type) => update(module, { type, mda: module.kind === "iom" ? [] : module.mda })}
        allowFreeText={false}
      />
      <IconButton size="small" color="error" onClick={() => remove(module)} sx={{ justifySelf: { xs: "end", sm: "auto" } }}>
        <DeleteOutlineIcon fontSize="small" />
      </IconButton>
    </Box>
  );

  // XMAs and IOMs share the module slots: a kind with no module of its own and no free slot is blocked by the other.
  const blockedBy = (kind: XcmModuleKind): string => {
    if (freeSlots().length || modules.some((module) => module.kind === kind)) return "";
    return kind === "xma" ? "IOM" : "XMA";
  };

  const header = (kind: XcmModuleKind, title: string, addLabel: string) => {
    const blocker = blockedBy(kind);
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="subtitle2" sx={{ color: blocker ? "text.disabled" : undefined }}>
          {title}
          {blocker ? (
            <Box component="span" sx={{ fontWeight: 400 }}>
              {` (Blocked by ${blocker})`}
            </Box>
          ) : null}
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={() => add(kind)} disabled={!optionsByKind[kind].length || !freeSlots().length}>
          {addLabel}
        </Button>
      </Box>
    );
  };

  return (
    <>
      <FormHelperText sx={{ mt: 1.5 }}>
        {optionsByKind.xma.length && optionsByKind.iom.length
          ? `${slotText} either an XMA or an IOM with MDAs.`
          : optionsByKind.iom.length
            ? `${slotText} an IOM with MDAs.`
            : `${slotText} an XMA.`}
      </FormHelperText>

      {optionsByKind.xma.length ? (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          {header("xma", "XMA", "Add XMA")}
          {modules.filter((module) => module.kind === "xma").map((module) => (
            <Box key={module.slot}>{moduleRow(module)}</Box>
          ))}
        </Stack>
      ) : null}

      {optionsByKind.iom.length ? (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          {header("iom", "IOM + MDA", "Add IOM")}
          {modules.filter((module) => module.kind === "iom").map((module) => {
            const iom = { slot: module.slot, type: module.type, mda: module.mda };
            return (
              <Paper key={module.slot} variant="outlined" sx={{ p: 1.25, bgcolor: "action.hover" }}>
                {moduleRow(module)}
                <NestedMdaSection
                  title="MDAs"
                  mdas={module.mda}
                  options={xiomMdaOptions(entry, component, iom, sfm)}
                  slotOptions={mdaSlotsFor(iom)}
                  slotOptionsByMda={module.mda.map((mda) => mdaSlotsFor(iom, mda.type))}
                  addDisabled={!nextMdaFor(iom)}
                  onAdd={() => {
                    const mda = nextMdaFor(iom);
                    if (mda) update(module, { mda: [...module.mda, mda] });
                  }}
                  onUpdate={(mdaIndex, updates) =>
                    update(module, { mda: module.mda.map((mda, idx) => (idx === mdaIndex ? { ...mda, ...updates } : mda)) })
                  }
                  onRemove={(mdaIndex) => update(module, { mda: module.mda.filter((_, idx) => idx !== mdaIndex) })}
                />
              </Paper>
            );
          })}
        </Stack>
      ) : null}
    </>
  );
}
