// The domain core never imports `cloudflare:*` or uses a Workers type
// (ADR 0001), so it runs under plain Node and could move to another runtime
// with new adapters only.
//
// A Workers type is any global that @cloudflare/workers-types declares and the
// core's own libs (ES2024 and WebWorker) don't, plus the `Env` and `Cloudflare`
// globals Wrangler generates for each Worker. The set is read from the
// installed packages, so it follows the Workers runtime without a list to keep.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { AST_NODE_TYPES, AST_TOKEN_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";
import type { Scope } from "@typescript-eslint/utils/ts-eslint";
import ts from "typescript";

const cloudflareModule = /^(?:cloudflare:|@cloudflare\/|wrangler$|miniflare$|workerd$)/;
const tripleSlashTypes = /^\/\s*<reference\s+types\s*=\s*["']([^"']+)["']/;
const wranglerGenerated = ["Env", "Cloudflare"];
const coreLibs = ["es2024", "webworker"];

export const noCloudflareInCore = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: "problem",
    schema: [],
    messages: {
      cloudflareModule:
        "The domain core never imports '{{source}}': Cloudflare belongs in the Workers' adapters (ADR 0001).",
      workersType:
        "'{{name}}' is a Workers type: the domain core uses only web-standard globals (ADR 0001).",
    },
  },
  defaultOptions: [],
  create(context) {
    const checkSource = (node: TSESTree.Node, source: string | null | undefined) => {
      if (source != null && cloudflareModule.test(source)) {
        context.report({ node, messageId: "cloudflareModule", data: { source } });
      }
    };
    const checkLiteral = (node: TSESTree.Node | null | undefined) => {
      if (node?.type === AST_NODE_TYPES.Literal && typeof node.value === "string") {
        checkSource(node, node.value);
      }
    };

    return {
      ImportDeclaration(node) {
        checkLiteral(node.source);
      },
      ExportAllDeclaration(node) {
        checkLiteral(node.source);
      },
      ExportNamedDeclaration(node) {
        checkLiteral(node.source);
      },
      ImportExpression(node) {
        checkLiteral(node.source);
      },
      TSImportType(node) {
        checkLiteral(importTypeSource(node));
      },
      TSExternalModuleReference(node) {
        checkLiteral(node.expression);
      },
      CallExpression(node) {
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === "require") {
          checkLiteral(node.arguments[0]);
        }
      },
      Program(program) {
        for (const comment of context.sourceCode.getAllComments()) {
          const match =
            comment.type === AST_TOKEN_TYPES.Line ? tripleSlashTypes.exec(comment.value) : null;
          checkSource(comment as unknown as TSESTree.Node, match?.[1]);
        }
        const globalScope = context.sourceCode.getScope(program);
        for (const reference of unresolvedGlobals(globalScope)) {
          const { name } = reference.identifier;
          if (workersOnlyGlobals().has(name)) {
            context.report({ node: reference.identifier, messageId: "workersType", data: { name } });
          }
        }
      },
    };
  },
});

// `typeof import("x")`: typescript-eslint has moved the specifier between
// versions, so read whichever is present.
function importTypeSource(node: TSESTree.TSImportType): TSESTree.Node | undefined {
  const withSource = node as { source?: TSESTree.Node };
  if (withSource.source) return withSource.source;
  const argument = (node as { argument?: TSESTree.Node }).argument;
  return argument?.type === AST_NODE_TYPES.TSLiteralType ? argument.literal : argument;
}

// References no declaration in the file resolves: through the global scope,
// or to a global that only a lib or the config declares.
function* unresolvedGlobals(globalScope: Scope.Scope): Iterable<Scope.Reference> {
  yield* globalScope.through;
  for (const variable of globalScope.set.values()) {
    if (variable.defs.length === 0) yield* variable.references;
  }
}

let cached: ReadonlySet<string> | undefined;

function workersOnlyGlobals(): ReadonlySet<string> {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  const workers = declaredGlobals([require.resolve("@cloudflare/workers-types/index.d.ts")]);
  const libDir = dirname(require.resolve("typescript/lib/lib.d.ts"));
  const web = declaredGlobals(coreLibs.map((lib) => join(libDir, `lib.${lib}.d.ts`)));
  cached = new Set([...wranglerGenerated, ...[...workers].filter((name) => !web.has(name))]);
  return cached;
}

// The names a set of declaration files puts in the global scope, following
// their `/// <reference lib>` directives.
function declaredGlobals(files: readonly string[]): Set<string> {
  const names = new Set<string>();
  const seen = new Set<string>();
  const queue = [...files];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
    for (const lib of source.libReferenceDirectives) {
      queue.push(join(dirname(file), `lib.${lib.fileName.toLowerCase()}.d.ts`));
    }
    for (const statement of source.statements) {
      for (const name of statementNames(statement)) names.add(name);
    }
  }
  return names;
}

function statementNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    );
  }
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name))
  ) {
    return statement.name ? [statement.name.text] : [];
  }
  return [];
}
