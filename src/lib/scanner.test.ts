import { describe, it, expect } from "vitest";
import { analyzeFiles } from "./scanner";
import { exampleText } from "./platform";
const scan = (files: { path: string; content: string; tracked?: boolean }[]) =>
  analyzeFiles(files, "fixture", "fixture");
describe("local browser analyzer", () => {
  it("detects ecosystem references, statuses, and service ownership without values", () => {
    const result = scan([
      {
        path: ".env.local",
        content:
          "DATABASE_URL=postgres://user:very-secret@host/db\nUNUSED=legacy\nEMPTY=",
      },
      {
        path: "apps/api/config.ts",
        content:
          "process.env.DATABASE_URL; process.env.MISSING; process.env.EMPTY",
      },
      { path: "worker.py", content: 'os.getenv("PY_KEY")' },
      { path: "main.rs", content: 'env!("RUST_KEY")' },
      { path: "main.go", content: 'os.Getenv("GO_KEY")' },
      {
        path: "main.cs",
        content: 'Environment.GetEnvironmentVariable("DOTNET_KEY")',
      },
    ]);
    expect(
      result.variables.find((v) => v.name === "DATABASE_URL"),
    ).toMatchObject({ status: "healthy", secret: true, services: ["api"] });
    expect(result.variables.find((v) => v.name === "UNUSED")?.status).toBe(
      "dead",
    );
    expect(result.variables.find((v) => v.name === "EMPTY")?.status).toBe(
      "missing",
    );
    expect(result.variables).toHaveLength(8);
    expect(JSON.stringify(result)).not.toContain("very-secret");
  });
  it("does not treat example credentials as populated definitions", () => {
    const result = scan([
      { path: ".env.example", content: "TOKEN=example-value" },
      { path: "app.ts", content: "process.env.TOKEN" },
    ]);
    expect(result.variables[0]).toMatchObject({
      status: "missing",
      definitions: [],
    });
  });
  it("handles multiline values, duplicates, and interpolation", () => {
    const result = scan([
      {
        path: ".env",
        content:
          'PRIVATE_KEY="first\nFAKE=inside\nlast"\nHOST=localhost\nHOST=duplicate\nURL=${HOST}/api',
      },
    ]);
    expect(result.variables.map((v) => v.name)).not.toContain("FAKE");
    expect(result.warnings.some((w) => w.startsWith("Duplicate HOST"))).toBe(
      true,
    );
    expect(
      result.variables.find((v) => v.name === "HOST")?.references,
    ).toHaveLength(1);
  });
  it("ignores generated directories and binary inputs", () => {
    const result = scan([
      { path: "node_modules/pkg/config.ts", content: "process.env.NOPE" },
      { path: "image.js", content: "\0process.env.BINARY" },
      {
        path: "src/index.ts",
        content: "const { VALID, ALSO_VALID: name } = process.env;",
      },
    ]);
    expect(result.variables.map((v) => v.name)).toEqual([
      "ALSO_VALID",
      "VALID",
    ]);
    expect(result.files).toBe(1);
  });
  it("marks tracked secrets as exposed and identifies presence drift", () => {
    const result = scan([
      {
        path: ".env.local",
        content: "API_KEY=private\nPORT=3000",
        tracked: true,
      },
      { path: ".env.production", content: "PORT=3000" },
      { path: "main.ts", content: "process.env.API_KEY; process.env.PORT" },
    ]);
    expect(result.variables.find((v) => v.name === "API_KEY")).toMatchObject({
      status: "exposed",
      drifted: true,
    });
    expect(exampleText(result)).toContain("API_KEY=\n");
    expect(exampleText(result)).not.toContain("private");
    expect(exampleText(result)).not.toContain("3000");
  });
  it("handles quoted inline comments and empty assignments", () => {
    const result = scan([
      {
        path: ".env",
        content:
          'FILLED="yes" # note\nEMPTY="" # note\nALSO_EMPTY= # note\nNEXT=value',
      },
      {
        path: "main.ts",
        content:
          "process.env.FILLED; process.env.EMPTY; process.env.ALSO_EMPTY; process.env.NEXT",
      },
    ]);
    expect(result.variables.find((v) => v.name === "FILLED")?.status).toBe(
      "healthy",
    );
    expect(result.variables.find((v) => v.name === "NEXT")?.status).toBe(
      "healthy",
    );
    expect(result.variables.find((v) => v.name === "EMPTY")?.status).toBe(
      "missing",
    );
    expect(result.variables.find((v) => v.name === "ALSO_EMPTY")?.status).toBe(
      "missing",
    );
  });
  it("detects quoted source credentials without returning the credential", () => {
    const result = scan([
      {
        path: "src/config.ts",
        content: "const API_KEY = 'ghp_private';",
        tracked: true,
      },
    ]);
    expect(result.variables[0]).toMatchObject({
      name: "API_KEY",
      status: "exposed",
    });
    expect(JSON.stringify(result)).not.toContain("ghp_private");
  });
});
