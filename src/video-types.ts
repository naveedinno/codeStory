// Shared wire types; keep Node and Playwright out of the client type graph.
export interface VideoOptions {
  resolution: "720p" | "1080p";
  narration: boolean;
  narrationEngine?: "system" | "lino";
  lino?: { engine: string; voice: string };
  speed: number;
  theme: "light" | "dark";
}
export interface VideoJob {
  id: string;
  state: "rendering" | "encoding" | "ready" | "cancelled" | "error";
  completed: number;
  total: number;
  message: string;
  filename: string;
  /** Measured estimate for the active generation or encoding stage. */
  estimatedRemainingMs: number | null;
  /** Progress within the active stage, or null while preparing. */
  stageProgress: number | null;
}
