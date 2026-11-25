import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https",
  "module", "net", "os", "path", "process", "readline", "stream", "timers", "url", "util", "vm",
]);

const FORBIDDEN_UI_LIBS = new Set(["lucide-react-native", "react-native-svg", "react-dom"]);
const DOM_IDENTIFIERS = new Set(["window", "document", "HTMLElement", "HTMLDivElement", "localStorage"]);
const HTML_JSX_TAGS = new Set(["div", "span", "button", "input", "p", "h1", "h2", "a", "ul", "li"]);
const FORBIDDEN_MARKERS = [
  { name: "TODO", re: /\bTODO\b/ },
  { name: "HACK", re: /\bHACK\b/ },
  { name: "@ts-ignore", re: /@ts-ignore/ },
  { name: "@ts-expect-error", re: /@ts-expect-error/ },
  { name: "eslint-disable", re: /eslint-disable/ },
];

function collectSourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function getZone(relPath) {
  const norm = relPath.replace(/\\/g, "/");
  if (norm === "index.server.ts" || norm === "index.client.tsx") return "entry";
  if (norm.startsWith("shared/")) return "shared";
  if (norm.startsWith("server/")) return "server";
  if (norm.startsWith("client/")) return "client";
  return "other";
}

function featureNameOf(relPath) {
  const m = relPath.replace(/\\/g, "/").match(/^(?:server|client)\/features\/([^/]+)\//);
  return m ? m[1] : null;
}

function isCoreFile(relPath) {
  return /^(?:server|client)\/core\//.test(relPath.replace(/\\/g, "/"));
}

function lineLimitFor(relPath) {
  const norm = relPath.replace(/\\/g, "/");
  if (/\/test_logic\.ts$/.test(norm) || /\.test\.ts$/.test(norm)) return null;
  if (norm === "index.server.ts" || norm === "index.client.tsx") return 40;
  if (norm.startsWith("shared/") || /\/schema\.ts$/.test(norm)) return 400;
  if (norm.startsWith("server/") || norm.startsWith("client/")) return 300;
  return null;
}

function resolveRelativeImport(relPath, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.posix.dirname(relPath.replace(/\\/g, "/"));
  return path.posix.normalize(path.posix.join(base, spec));
}

function isNodeSpecifier(spec) {
  if (spec.startsWith("node:")) return true;
  const head = spec.split("/")[0];
  return NODE_BUILTINS.has(head);
}

export function checkSource(relPath, content) {
  const violations = [];
  const norm = relPath.replace(/\\/g, "/");
  const zone = getZone(norm);
  const myFeature = featureNameOf(norm);
  const myIsCore = isCoreFile(norm);
  const lines = content.split("\n");
  const limit = lineLimitFor(norm);

  if (limit !== null && lines.length > limit) {
    violations.push(`[GATE::LINE_LIMIT] ${norm} has ${lines.length} lines (max ${limit})`);
  }

  for (let i = 0; i < lines.length; i += 1) {
    for (const marker of FORBIDDEN_MARKERS) {
      if (marker.re.test(lines[i])) {
        violations.push(`[GATE::FORBIDDEN_MARKER] ${norm}:${i + 1} contains ${marker.name}`);
      }
    }
  }

  const kind = norm.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(norm, content, ts.ScriptTarget.ES2022, true, kind);

  const checkImportSpec = (spec, pos) => {
    const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
    const resolved = resolveRelativeImport(norm, spec);

    if (zone === "shared") {
      if (isNodeSpecifier(spec) || spec === "react" || spec === "react-native" || spec.startsWith("@getpaseo/plugin/")) {
        violations.push(`[GATE::SHARED_BOUNDARY] ${norm}:${line} forbidden import "${spec}"`);
      }
    }
    if (zone === "server" || norm === "index.server.ts") {
      if (spec === "react" || spec === "react-native" || spec.startsWith("@getpaseo/plugin/client")) {
        violations.push(`[GATE::SERVER_BOUNDARY] ${norm}:${line} forbidden UI import "${spec}"`);
      }
      if (resolved && resolved.startsWith("client/")) {
        violations.push(`[GATE::SERVER_BOUNDARY] ${norm}:${line} cannot import client module "${spec}"`);
      }
    }
    if (zone === "client" || norm === "index.client.tsx") {
      if (isNodeSpecifier(spec) || FORBIDDEN_UI_LIBS.has(spec) || spec.startsWith("@getpaseo/plugin/server")) {
        violations.push(`[GATE::CLIENT_BOUNDARY] ${norm}:${line} forbidden import "${spec}"`);
      }
      if (resolved && resolved.startsWith("server/")) {
        violations.push(`[GATE::CLIENT_BOUNDARY] ${norm}:${line} cannot import server module "${spec}"`);
      }
    }
    if (resolved) {
      const targetFeature = featureNameOf(resolved);
      if (myFeature && targetFeature && targetFeature !== myFeature) {
        violations.push(`[GATE::CROSS_FEATURE] ${norm}:${line} feature "${myFeature}" cannot import feature "${targetFeature}"`);
      }
      if (myIsCore && targetFeature) {
        violations.push(`[GATE::CORE_REVERSE_DEP] ${norm}:${line} core cannot import feature "${targetFeature}"`);
      }
    }
  };

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      checkImportSpec(node.moduleSpecifier.text, node.getStart(sf));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      checkImportSpec(node.moduleSpecifier.text, node.getStart(sf));
    } else if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      violations.push(`[GATE::FORBIDDEN_MARKER] ${norm}:${line} explicit "any" type is forbidden`);
    } else if (zone === "client") {
      if (ts.isIdentifier(node) && DOM_IDENTIFIERS.has(node.text)) {
        const parent = node.parent;
        const isPropKey = ts.isPropertyAccessExpression(parent) && parent.name === node;
        const isPropertyDef = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
        if (!isPropKey && !isPropertyDef) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          violations.push(`[GATE::CLIENT_BOUNDARY] ${norm}:${line} DOM global "${node.text}" forbidden`);
        }
      } else if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) {
        if (HTML_JSX_TAGS.has(node.tagName.text)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          violations.push(`[GATE::CLIENT_BOUNDARY] ${norm}:${line} HTML tag <${node.tagName.text}> forbidden in RN`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return violations;
}

export function scanWorkspace(root = ROOT) {
  const violations = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      if (entry.name !== "index.server.ts" && entry.name !== "index.client.tsx") {
        violations.push(`[GATE::ROOT_FILE] unexpected root source file "${entry.name}"`);
      }
    }
  }
  const targets = [
    path.join(root, "index.server.ts"),
    path.join(root, "index.client.tsx"),
    ...collectSourceFiles(path.join(root, "shared")),
    ...collectSourceFiles(path.join(root, "server")),
    ...collectSourceFiles(path.join(root, "client")),
  ];
  for (const absPath of targets) {
    if (!fs.existsSync(absPath)) continue;
    const rel = path.relative(root, absPath);
    violations.push(...checkSource(rel, fs.readFileSync(absPath, "utf8")));
  }
  return violations;
}

export function runSelfTest(root = ROOT) {
  const cases = [
    {
      fixture: "tests/gates/cross-feature-import.ts",
      simulatedRel: "server/features/alpha/logic.ts",
      expectedCode: "[GATE::CROSS_FEATURE]",
    },
    {
      fixture: "tests/gates/core-reverse-dep.ts",
      simulatedRel: "server/core/bad.ts",
      expectedCode: "[GATE::CORE_REVERSE_DEP]",
    },
    {
      fixture: "tests/gates/client-dom-leak.tsx",
      simulatedRel: "client/features/alpha/view.tsx",
      expectedCode: "[GATE::CLIENT_BOUNDARY]",
    },
    {
      fixture: "tests/gates/forbidden-marker.ts",
      simulatedRel: "server/features/alpha/bad.ts",
      expectedCode: "[GATE::FORBIDDEN_MARKER]",
    },
    {
      fixture: "tests/gates/oversize-logic.ts",
      simulatedRel: "server/features/alpha/oversize.ts",
      expectedCode: "[GATE::LINE_LIMIT]",
    },
  ];

  const errors = [];
  for (const c of cases) {
    const content = fs.readFileSync(path.join(root, c.fixture), "utf8");
    const found = checkSource(c.simulatedRel, content);
    if (!found.some((msg) => msg.includes(c.expectedCode))) {
      errors.push(`Fixture ${c.fixture} did NOT trigger ${c.expectedCode}; got: ${JSON.stringify(found)}`);
    }
  }
  return errors;
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--self-test")) {
    const errors = runSelfTest();
    if (errors.length > 0) {
      for (const e of errors) console.error(e);
      process.exit(1);
    }
    console.log("[PASS] Gate fixtures self-test (5/5 caught)");
    return;
  }

  console.log("1. Running tsc --noEmit...");
  execFileSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, stdio: "inherit" });

  console.log("2. Running architecture & boundary checks...");
  const violations = scanWorkspace();
  if (violations.length > 0) {
    for (const v of violations) console.error(v);
    process.exit(1);
  }
  console.log("[PASS] Architecture & boundary checks");

  console.log("3. Running gate fixture self-tests...");
  const selfErrors = runSelfTest();
  if (selfErrors.length > 0) {
    for (const e of selfErrors) console.error(e);
    process.exit(1);
  }
  console.log("[PASS] Gate fixture self-tests (5/5 caught)");

  if (args.has("--fast")) return;

  console.log("4. Running Vitest suite...");
  execFileSync("npx", ["vitest", "run", "--config", "tests/vitest.config.mjs"], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
