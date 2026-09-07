/** Snippet-local mirror of the shared event contract (zero runtime deps). */

export type EventType =
  | "pageview"
  | "click"
  | "form_focus"
  | "form_submit"
  | "form_abandon"
  | "error"
  | "route_change"
  | "page_leave"
  | "identify"
  | "track";

export interface EventInput {
  eventId?: string;
  type: EventType;
  ts: number;
  path?: string;
  url?: string;
  referrer?: string;
  props?: Record<string, unknown>;
}

export interface Batch {
  key: string;
  anonId: string;
  userId?: string;
  sessionId: string;
  sentAt: number;
  events: EventInput[];
}

export interface TrackiConfig {
  key: string;
  endpoint: string;
}
