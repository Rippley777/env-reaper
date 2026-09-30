import type { SourceFile, Scan, Variable, Reference } from "./types";
export const excluded =
  /(^|\/)(node_modules|\.git|\.next|dist|build|target|\.venv|venv|vendor|coverage|__pycache__)(\/|$)/;
export const supported =
  /(?:\.(?:[cm]?[jt]sx?|py|rs|go|cs|java|rb|php|sh|bash|zsh|yml|yaml|toml|json|tf|ini|conf|config|properties)|(?:^|\/)(?:Dockerfile[^/]*|\.env[^/]*|\.npmrc))$/i;
export const envFile = /(?:^|\/)\.env(?:[.\w-]*)$/;
function closingQuote(text: string, quote: string): number {
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === quote) return i;
    if (ch === "\\" && quote === '"') escaped = true;
  }
  return -1;
}
function openQuote(value: string): string {
  return (value[0] === '"' || value[0] === "'") &&
    closingQuote(value.slice(1), value[0]) < 0
    ? value[0]
    : "";
}
function hasValue(value: string): boolean {
  if (value.startsWith('"') || value.startsWith("'"))
    return closingQuote(value.slice(1), value[0]) !== 0;
  return value.split("#")[0].trim().length > 0;
}
export function classifySecret(name: string, value = ""): string {
  if (
    /PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_KEY|CREDENTIAL|DATABASE_URL|REDIS_URL|STRIPE.*KEY/i.test(
      name,
    )
  )
    return /URL/.test(name)
      ? "Connection string"
      : /SECRET/.test(name)
        ? "Signing secret"
        : "API credential";
  if (
    /(?:sk-(?:live|test|proj)-|gh[pousr]_|github_pat_|AKIA[0-9A-Z]{16}|-----BEGIN .*PRIVATE KEY|:\/\/[^\s:]+:[^\s@]+@)/.test(
      value,
    )
  )
    return "Credential pattern";
  if (
    value.length > 24 &&
    !/\s|:\/\//.test(value) &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value)
  ) {
    const chars = new Set(value);
    const entropy = [...chars].reduce((n, c) => {
      const p = value.split(c).length - 1;
      const f = p / value.length;
      return n - f * Math.log2(f);
    }, 0);
    if (entropy > 4.3) return "High-entropy value";
  }
  return "";
}
const patterns = [
  /(?:process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)/g,
  /(?:process\.env|import\.meta\.env|os\.environ)\s*\[\s*["']([A-Z_][A-Z0-9_]*)["']\s*\]/g,
  /(?:Deno\.env\.get|os\.getenv|os\.environ\.get|(?:std::)?env::var|(?:option_)?env!|os\.Getenv|Environment\.GetEnvironmentVariable|configuration\.GetValue(?:<[^>]+>)?)\s*\(\s*["']([A-Z_][A-Z0-9_]*)["']/g,
  /\$\{([A-Z_][A-Z0-9_]*)(?:[^}]*)\}/g,
  /\$([A-Z_][A-Z0-9_]*)/g,
  /(?:secrets|vars|env)\.([A-Z_][A-Z0-9_]*)/g,
  /(?:configuration|Configuration)\s*\[\s*["']([A-Z_][A-Z0-9_]*)["']/g,
];
export function analyzeFiles(
  files: SourceFile[],
  name: string,
  path: string,
): Scan {
  const start = performance.now(),
    inventory = new Map<string, Variable>(),
    environments = new Set<string>(),
    warnings: string[] = [];
  const get = (key: string) => {
    if (!inventory.has(key))
      inventory.set(key, {
        name: key,
        status: "unknown",
        secret: false,
        classification: "",
        definitions: [],
        references: [],
        services: [],
        drifted: false,
        lastSeen: "Just now",
        confidence: 95,
      });
    return inventory.get(key)!;
  };
  let indexed = 0;
  for (const file of files) {
    if (
      excluded.test(file.path) ||
      !supported.test(file.path) ||
      file.content.includes("\0")
    )
      continue;
    indexed++;
    const isEnv = envFile.test(file.path),
      example = /\.env\.(?:example|sample|template)$/.test(file.path);
    if (isEnv && !example) environments.add(file.path);
    const service =
      file.path.match(/(?:apps|packages|services)\/([^/]+)/)?.[1] || "root";
    let quote = "";
    file.content.split(/\r?\n/).forEach((line, i) => {
      if (quote) {
        if (closingQuote(line, quote) >= 0) quote = "";
        return;
      }
      const clean = line.trim();
      if (
        !clean ||
        clean.startsWith("#") ||
        clean.startsWith("//") ||
        clean.startsWith("*")
      )
        return;
      if (isEnv) {
        const m = clean.match(
          /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
        );
        if (m) {
          const [, key, value] = m;
          quote = openQuote(value);
          const v = get(key);
          if (!example) {
            if (v.definitions.some((d) => d.file === file.path))
              warnings.push(`Duplicate ${key} in ${file.path}:${i + 1}`);
            else
              v.definitions.push({
                file: file.path,
                hasValue: hasValue(value),
                tracked: !!file.tracked,
              });
          }
          const classification = classifySecret(key, value);
          if (classification) {
            v.secret = true;
            v.classification = classification;
          }
        } else
          warnings.push(`Unrecognized assignment in ${file.path}:${i + 1}`);
      }
      if (!isEnv) {
        const assignment = clean.match(
          /(?:^|\s)(?:ENV\s+|ARG\s+|(?:const|let|var)\s+)?([A-Z_][A-Z0-9_]*)\s*(?:=|:)\s*["']([^"']*)["']/,
        );
        if (assignment) {
          const classification = classifySecret(assignment[1], assignment[2]);
          if (classification) {
            const v = get(assignment[1]);
            v.secret = true;
            v.classification = classification;
            if (!v.definitions.some((d) => d.file === file.path))
              v.definitions.push({
                file: file.path,
                hasValue: assignment[2].length > 0,
                tracked: !!file.tracked,
              });
          }
        }
      }
      if (example) return;
      for (const re of patterns) {
        re.lastIndex = 0;
        for (const m of clean.matchAll(re)) {
          const key = m[1];
          const v = get(key);
          if (
            v.references.some((r) => r.file === file.path && r.line === i + 1)
          )
            continue;
          const ref: Reference = {
            file: file.path,
            line: i + 1,
            pattern: isEnv ? `\u0024{${key}}` : m[0],
            service,
          };
          v.references.push(ref);
          if (!v.services.includes(service)) v.services.push(service);
        }
      }
      // Common destructuring: const { A, B: alias } = process.env.
      const destructure = clean.match(
        /\{\s*([^{}]+)\}\s*=\s*(?:process\.env|import\.meta\.env)/,
      );
      if (destructure)
        for (const field of destructure[1].split(",")) {
          const key = field.trim().split(/[:=]/)[0].trim();
          if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
          const v = get(key);
          v.references.push({
            file: file.path,
            line: i + 1,
            pattern: `{ ${key} } = process.env`,
            service,
          });
          if (!v.services.includes(service)) v.services.push(service);
        }
    });
  }
  const vars = [...inventory.values()].filter(
    (v) => v.references.length || v.definitions.length,
  );
  for (const v of vars) {
    const c = classifySecret(v.name);
    if (c) {
      v.secret = true;
      v.classification = c;
    }
    v.status =
      v.secret && v.definitions.some((d) => d.tracked)
        ? "exposed"
        : v.references.length === 0
          ? "dead"
          : !v.definitions.some((d) => d.hasValue)
            ? "missing"
            : "healthy";
    const envDefinitions = v.definitions.filter((d) =>
      environments.has(d.file),
    ).length;
    v.drifted = envDefinitions > 0 && envDefinitions < environments.size;
    v.lastSeen = v.references.length ? "Just now" : "No reference";
  }
  warnings.push(
    "Static analysis cannot resolve dynamic variable names. No reference does not prove a variable is safe to remove.",
  );
  return {
    name,
    path,
    branch: "local",
    variables: vars.sort((a, b) => a.name.localeCompare(b.name)),
    files: indexed,
    duration: (performance.now() - start) / 1000,
    scannedAt: new Date().toISOString(),
    environments: [...environments].sort(),
    warnings,
    gitAvailable: false,
  };
}
