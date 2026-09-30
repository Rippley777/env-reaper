import type { Scan, Variable, Status } from "./types";
const envs = [
  ".env.local",
  ".env.development",
  ".env.staging",
  ".env.production",
];
function variable(
  name: string,
  status: Status,
  secret: boolean,
  services: string[],
  count: number,
  env: number[] = [0, 1, 2, 3],
  drifted = false,
): Variable {
  const file =
    services[0] === "web"
      ? "apps/web/src/config.ts"
      : `apps/${services[0] || "api"}/src/${name.includes("DATABASE") ? "db/client" : name.includes("STRIPE") ? "billing/stripe" : "config"}.ts`;
  return {
    name,
    status,
    secret,
    services,
    drifted,
    confidence: 100,
    classification: secret
      ? name.includes("URL")
        ? "Database connection string"
        : name.includes("SECRET")
          ? "Signing secret"
          : "API credential"
      : "Not classified as sensitive",
    definitions: env.map((i) => ({
      file: envs[i],
      hasValue: true,
      tracked: status === "exposed",
    })),
    references: Array.from({ length: count }, (_, i) => ({
      file:
        i === 0
          ? file
          : i % 3 === 0
            ? "docker-compose.yml"
            : `apps/${services[i % services.length] || "api"}/src/${i % 2 ? "config" : "index"}.ts`,
      line: 17 + i * 7,
      pattern: `process.env.${name}`,
      service: services[i % services.length] || "api",
    })),
    lastSeen: status === "dead" ? "94 days ago" : "Just now",
  };
}
export function demoScan(): Scan {
  const variables: Variable[] = [
    variable("DATABASE_URL", "healthy", true, ["api", "worker"], 14),
    variable("REDIS_URL", "healthy", true, ["api", "worker"], 8),
    variable("NEXT_PUBLIC_API_URL", "healthy", false, ["web"], 6),
    variable("STRIPE_SECRET_KEY", "exposed", true, ["api"], 4, [0, 1, 3], true),
    variable("STRIPE_WEBHOOK_SECRET", "missing", true, ["api"], 3, []),
    variable("LEGACY_API_URL", "dead", false, [], 0, [0, 1], true),
    variable("JWT_SECRET", "healthy", true, ["api", "web"], 7),
    variable("OPENAI_API_KEY", "exposed", true, ["worker"], 2, [0, 1, 2, 3]),
    variable("SENTRY_DSN", "missing", false, ["web", "api"], 3, []),
    variable("OLD_REDIS_HOST", "dead", false, [], 0, [0, 3], true),
    variable("PORT", "healthy", false, ["api"], 5),
    variable("NODE_ENV", "healthy", false, ["api", "web", "worker"], 12),
    variable("LOG_LEVEL", "healthy", false, ["api", "worker"], 6),
    variable("SMTP_PASSWORD", "missing", true, ["worker"], 2, []),
    variable("ENABLE_ANALYTICS", "dead", false, [], 0, [0, 1, 2, 3]),
    variable("AWS_REGION", "healthy", false, ["worker"], 3),
    variable("UPLOAD_BUCKET", "healthy", false, ["api"], 4),
    variable("SESSION_SECRET", "healthy", true, ["web"], 4),
    variable("OLD_STRIPE_KEY", "dead", true, [], 0, [0]),
    variable("DEBUG", "healthy", false, ["api"], 2, [0, 1], true),
    variable("EMAIL_FROM", "healthy", false, ["worker"], 2),
    variable("VITE_APP_NAME", "healthy", false, ["web"], 3),
    variable("CACHE_TTL", "healthy", false, ["api", "worker"], 4),
    variable("QUEUE_NAME", "healthy", false, ["worker"], 6),
    variable("LEGACY_FEATURE_FLAG", "dead", false, [], 0, [0, 1, 2, 3]),
    variable("WEBHOOK_URL", "missing", false, ["worker"], 1, []),
    variable("CORS_ORIGIN", "healthy", false, ["api"], 3),
    variable("RATE_LIMIT", "healthy", false, ["api"], 2),
  ];
  return {
    name: "shipwreck",
    path: "~/Developer/shipwreck",
    branch: "main",
    variables,
    files: 1248,
    duration: 0.84,
    scannedAt: new Date().toISOString(),
    environments: envs,
    warnings: [],
    demo: true,
    gitAvailable: true,
  };
}
