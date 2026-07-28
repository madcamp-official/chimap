import {
  chimapColors,
  routeColors,
  statusColors,
} from "@chimap/design-tokens";

export const chimapTheme = {
  ...chimapColors,
  purple: routeColors.subway,
  busBlue: routeColors.bus,
  exerciseHalo: routeColors.exerciseHalo,
  danger: statusColors.danger,
  realtimeText: statusColors.realtimeText,
  realtimeSurface: statusColors.realtimeSurface,
  estimatedText: statusColors.estimatedText,
  estimatedSurface: statusColors.estimatedSurface,
  warningText: statusColors.warningText,
  warningSurface: statusColors.warningSurface,
  dangerSurface: statusColors.dangerSurface,
} as const;
