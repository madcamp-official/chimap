export const chimapColors = {
  navy: "#123C48",
  navyStrong: "#082D37",
  teal: "#1D6C68",
  orange: "#F47B35",
  green: "#2A9864",
  ink: "#173137",
  muted: "#647276",
  line: "#DFE3DE",
  paper: "#FFFEF9",
  canvas: "#F6F4EE",
  surface: "#FFFFFF",
  surfaceSubtle: "#EEF3F2",
  selectedSurface: "#F4FAF7",
  personalizationSurface: "#EAF4EF",
  keyboardSurface: "#F1F2F3",
  mapCanvas: "#E9ECE6",
  track: "#EDF0ED",
  handle: "#D5DAD7",
  placeholder: "#8A9694",
  shadow: "#071D22",
  sheetBorder: "rgba(23,49,55,0.1)",
  mapOverlay: "rgba(255,254,249,0.92)",
  white: "#FFFFFF",
  textOnNavyMuted: "rgba(255,255,255,0.64)",
  dividerOnNavy: "rgba(255,255,255,0.16)",
  successOnNavy: "#9FE0C7",
  orangeOnNavy: "#FFC49D",
  focus: "#F47B3573",
} as const;

export const routeColors = {
  walk: chimapColors.orange,
  bus: "#2E6DD8",
  subway: "#7957B8",
  exercise: "#F47B35",
  exerciseHalo: "#FFF7EC",
} as const;

export const statusColors = {
  realtimeText: "#096343",
  realtimeSurface: "#DFF5EA",
  estimatedText: "#825016",
  estimatedSurface: "#FFF0D4",
  warningText: "#825016",
  warningSurface: "#FFF4E9",
  danger: "#A83B32",
  dangerSurface: "#FFF0ED",
  success: "#2A9864",
} as const;

/** Compatibility aliases for packages that have not moved to semantic names yet. */
export const colors = {
  background: chimapColors.canvas,
  surface: chimapColors.surface,
  text: chimapColors.ink,
  textMuted: chimapColors.muted,
  primary: chimapColors.teal,
  primaryPressed: chimapColors.navy,
  border: chimapColors.line,
  danger: statusColors.danger,
  warning: statusColors.warningText,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  mdSm: 12,
  md: 16,
  mdLg: 20,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 14,
  lg: 24,
  pill: 999,
} as const;

export const typography = {
  caption: 10,
  label: 12,
  body: 15,
  bodyLarge: 17,
  title: 21,
  display: 28,
} as const;

export const elevation = {
  card: {
    shadowColor: chimapColors.navyStrong,
    shadowOpacity: 0.13,
    shadowRadius: 14,
    shadowOffsetY: 6,
  },
  sheet: {
    shadowColor: chimapColors.navyStrong,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffsetY: -4,
  },
} as const;

export const chimapCssVariables = {
  "--navy": chimapColors.navy,
  "--navy-strong": chimapColors.navyStrong,
  "--teal": chimapColors.teal,
  "--orange": chimapColors.orange,
  "--green": chimapColors.green,
  "--purple": routeColors.subway,
  "--bus-blue": routeColors.bus,
  "--ink": chimapColors.ink,
  "--muted": chimapColors.muted,
  "--line": chimapColors.line,
  "--paper": chimapColors.paper,
  "--canvas": chimapColors.canvas,
  "--surface": chimapColors.surface,
  "--surface-subtle": chimapColors.surfaceSubtle,
  "--selected-surface": chimapColors.selectedSurface,
  "--status-realtime-text": statusColors.realtimeText,
  "--status-realtime-surface": statusColors.realtimeSurface,
  "--status-estimated-text": statusColors.estimatedText,
  "--status-estimated-surface": statusColors.estimatedSurface,
  "--status-warning-text": statusColors.warningText,
  "--status-warning-surface": statusColors.warningSurface,
  "--status-danger": statusColors.danger,
  "--status-danger-surface": statusColors.dangerSurface,
} as const;
