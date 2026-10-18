// Effect-type handler registry (kept dependency-free so the handler modules can import each other).
/** effect type -> { visit(ctx), confirmed?(ctx, pending), declined?(ctx, pending), afterCombat?(ctx, won, result, context), ... } */
export const EFFECTS = {};
