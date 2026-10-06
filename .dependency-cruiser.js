// No import cycles anywhere in the repo, type-only imports included: a cycle
// that only types close still tangles the modules. ESLint's `import-x/no-cycle`
// skips `import type`, so this is checked here instead.
/** @type {import("dependency-cruiser").IConfiguration} */
export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Modules form a hierarchy: break the cycle by moving what both sides need into a module below them.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|\\.wrangler)/" },
    // Follow a workspace package through its `exports` map (ADR 0015), so a
    // cycle that crosses packages is caught too.
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "default"] },
  },
};
