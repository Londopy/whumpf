import type { LngLat } from "../providers/types";
import type { RoutingMode } from "../providers/RoutingProvider";

export interface RouteEditorState {
  waypoints: LngLat[];
  mode: RoutingMode;
  isEditing: boolean;
  past: LngLat[][];
  future: LngLat[][];
}

export type RouteAction =
  | { type: "START_EDITING" }
  | { type: "STOP_EDITING" }
  | { type: "ADD_WAYPOINT"; point: LngLat }
  | { type: "MOVE_WAYPOINT"; index: number; point: LngLat }
  | { type: "DELETE_WAYPOINT"; index: number }
  | { type: "REORDER_WAYPOINT"; from: number; to: number }
  | { type: "SET_MODE"; mode: RoutingMode }
  | { type: "CLEAR" }
  | { type: "UNDO" }
  | { type: "REDO" };

export const initialRouteEditorState: RouteEditorState = {
  waypoints: [],
  mode: "hiking",
  isEditing: false,
  past: [],
  future: [],
};

const MAX_HISTORY = 50;

function withHistory(state: RouteEditorState, nextWaypoints: LngLat[]): RouteEditorState {
  return {
    ...state,
    waypoints: nextWaypoints,
    past: [...state.past, state.waypoints].slice(-MAX_HISTORY),
    future: [],
  };
}

export function routeReducer(state: RouteEditorState, action: RouteAction): RouteEditorState {
  switch (action.type) {
    case "START_EDITING":
      return { ...state, isEditing: true };
    case "STOP_EDITING":
      return { ...state, isEditing: false };
    case "ADD_WAYPOINT":
      return withHistory(state, [...state.waypoints, action.point]);
    case "MOVE_WAYPOINT":
      return withHistory(
        state,
        state.waypoints.map((w, i) => (i === action.index ? action.point : w)),
      );
    case "DELETE_WAYPOINT":
      return withHistory(
        state,
        state.waypoints.filter((_, i) => i !== action.index),
      );
    case "REORDER_WAYPOINT": {
      if (action.from === action.to || action.from < 0 || action.from >= state.waypoints.length) return state;
      const to = Math.max(0, Math.min(state.waypoints.length - 1, action.to));
      const next = [...state.waypoints];
      const [moved] = next.splice(action.from, 1);
      next.splice(to, 0, moved);
      return withHistory(state, next);
    }
    case "SET_MODE":
      return { ...state, mode: action.mode };
    case "CLEAR":
      return withHistory(state, []);
    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        waypoints: previous,
        past: state.past.slice(0, -1),
        future: [state.waypoints, ...state.future].slice(0, MAX_HISTORY),
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        ...state,
        waypoints: next,
        past: [...state.past, state.waypoints].slice(-MAX_HISTORY),
        future: rest,
      };
    }
    default:
      return state;
  }
}
