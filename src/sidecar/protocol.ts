import type { ClientEvent } from "../ui/types.js";
import type { ServerEvent } from "../agent/types.js";

export type SidecarInboundMessage =
  | { type: "client-event"; event: ClientEvent };

export type SidecarOutboundMessage =
  | { type: "server-event"; event: ServerEvent }
  | { type: "log"; level: "info" | "error"; message: string; context?: Record<string, unknown> };

