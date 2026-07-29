export type PlannerSheetSnap = "expanded" | "middle" | "collapsed";

export type PlannerSheetOffsets = Record<PlannerSheetSnap, number>;

const snaps: PlannerSheetSnap[] = ["expanded", "middle", "collapsed"];

const keyboardClearance = 16;

export function androidKeyboardAvoidanceInset(
  windowHeight: number,
  keyboardScreenY: number,
  statusBarHeight: number,
): number {
  const overlap = Math.max(0, windowHeight - keyboardScreenY);
  return overlap === 0
    ? 0
    : overlap + Math.max(0, statusBarHeight) + keyboardClearance;
}

export function plannerSheetOffsets(
  stageHeight: number,
  bottomInset: number,
  collapsedContentHeight = 72,
): PlannerSheetOffsets {
  const collapsedVisibleHeight =
    collapsedContentHeight + Math.max(0, bottomInset);
  const collapsed = Math.max(0, stageHeight - collapsedVisibleHeight);
  const middle = Math.max(
    0,
    Math.min(Math.round(stageHeight * 0.43), collapsed - 96),
  );
  return { expanded: 0, middle, collapsed };
}

export function nearestPlannerSheetSnap(
  offsets: PlannerSheetOffsets,
  position: number,
  velocityY: number,
): PlannerSheetSnap {
  const projectedPosition = position + velocityY * 140;
  return snaps.reduce((nearest, candidate) =>
    Math.abs(offsets[candidate] - projectedPosition) <
    Math.abs(offsets[nearest] - projectedPosition)
      ? candidate
      : nearest,
  );
}

export function clampPlannerSheetPosition(
  offsets: PlannerSheetOffsets,
  position: number,
): number {
  return Math.min(offsets.collapsed, Math.max(offsets.expanded, position));
}
