export type Status = "healthy" | "missing" | "dead" | "exposed" | "unknown";
export interface Reference {
  file: string;
  line: number;
  pattern: string;
  service: string;
}
export interface Definition {
  file: string;
  hasValue: boolean;
  tracked: boolean;
  fingerprint?: string;
}
export interface Variable {
  name: string;
  status: Status;
  secret: boolean;
  classification: string;
  definitions: Definition[];
  references: Reference[];
  services: string[];
  drifted: boolean;
  lastSeen: string;
  confidence: number;
  ignored?: boolean;
}
export interface Scan {
  name: string;
  path: string;
  branch: string;
  variables: Variable[];
  files: number;
  duration: number;
  scannedAt: string;
  environments: string[];
  warnings: string[];
  demo?: boolean;
  gitAvailable: boolean;
}
export interface SourceFile {
  path: string;
  content: string;
  tracked?: boolean;
}
export interface ProjectRecord {
  name: string;
  path: string;
  health: number;
  issues: number;
  scannedAt: string;
  pinned?: boolean;
  demo?: boolean;
}
export type View =
  | "overview"
  | "variables"
  | "dead"
  | "missing"
  | "secrets"
  | "drift"
  | "graph"
  | "history"
  | "projects"
  | "settings";
export const statusLabels = {
  healthy: "Healthy",
  missing: "Missing",
  dead: "Dead",
  exposed: "Exposed",
  unknown: "Unknown",
};
export const getHealth = (vars: Variable[]) => {
  if (!vars.length) return 100;
  return Math.max(
    0,
    Math.round(
      100 -
        (vars.reduce(
          (n, v) =>
            n +
            (v.status === "exposed"
              ? 2
              : v.status === "missing"
                ? 1.3
                : v.status === "dead"
                  ? 0.45
                  : 0) +
            (v.drifted ? 0.25 : 0),
          0,
        ) /
          vars.length) *
          100,
    ),
  );
};
