import type { PlannerSheetSnap } from "./planner-sheet-snap";

export type PlannerSheetEvent =
  | { type: "NEW_ENTRY" }
  | { type: "SEARCH_FOCUS" }
  | { type: "CALCULATING" }
  | { type: "ERROR" }
  | { type: "RESULT" }
  | { type: "SELECT_ROUTE" }
  | { type: "TOGGLE" }
  | { type: "RESTORE"; hasSelectedRoute: boolean };

export function plannerSheetTransition(
  current: PlannerSheetSnap,
  event: PlannerSheetEvent,
): PlannerSheetSnap {
  if (event.type === "NEW_ENTRY") return "middle";
  if (
    event.type === "SEARCH_FOCUS" ||
    event.type === "CALCULATING" ||
    event.type === "ERROR" ||
    event.type === "RESULT"
  ) return "expanded";
  if (event.type === "SELECT_ROUTE") return "collapsed";
  if (event.type === "RESTORE") {
    return event.hasSelectedRoute ? "collapsed" : "middle";
  }
  return current === "collapsed" ? "middle" : "collapsed";
}
