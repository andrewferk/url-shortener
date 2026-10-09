// Not ESLint's `import-x/no-cycle`: it skips `import type`, and a cycle that
// only types close still tangles the modules.
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
    // Without these, a workspace package's import is unresolved and a cycle across packages goes unseen.
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "default"] },
  },
};
