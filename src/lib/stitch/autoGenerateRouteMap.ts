/**
 * Auto-Generated Stitch → App Route Map
 * 
 * SINGLE SOURCE OF TRUTH for all Stitch → Next.js route mappings.
 * Add new Stitch screens HERE ONLY.
 */

export type StitchRouteDef = {
  /** Unique identifier for this route */
  key: string;
  /** String pattern to match in href */
  includes: string;
  /** Target Next.js route (use :param for dynamic segments) */
  route: string;
  /** Parameter name for extraction (e.g., "dealId") */
  param?: string;
};

/**
 * CANONICAL ROUTE DEFINITIONS
 * 
 * To add a new Stitch screen:
 * 1. Add entry here
 * 2. That's it - route map auto-updates
 */
export const STITCH_ROUTE_DEFS: StitchRouteDef[] = [
  // ---- TOP LEVEL SCREENS ----
  { 
    key: "command", 
    includes: "command-center", 
    route: "/command" 
  },
  { 
    key: "pricing", 
    includes: "pricing", 
    route: "/pricing" 
  },
  { 
    key: "creditMemo", 
    includes: "credit-memo", 
    route: "/credit-memo" 
  },
  { 
    key: "underwrite", 
    includes: "underwrite", 
    route: "/underwrite" 
  },
  { 
    key: "admin", 
    includes: "admin", 
    route: "/admin" 
  },
  { 
    key: "settings", 
    includes: "settings", 
    route: "/settings" 
  },

  // ---- PARAMETERIZED ROUTES ----
  {
    key: "dealDetail",
    includes: "/deals/",
    route: "/deals/:dealId",
    param: "dealId",
  },
  {
    key: "borrowerPortal",
    includes: "/borrower/",
    route: "/borrower/:token",
    param: "token",
  },
];

/**
 * Build runtime route map from definitions
 * 
 * @returns Array of route matchers and resolvers
 */
export function buildStitchRouteMap() {
  return STITCH_ROUTE_DEFS.map(def => ({
    match: (href: string) => href.includes(def.includes),
    to: (href: string) => {
      // Static route - no param extraction needed
      if (!def.param) return def.route;

      // Extract param value from href
      const value = href.split(def.includes)[1]?.split(/[/?#]/)[0];
      return value ? def.route.replace(`:${def.param}`, value) : def.route;
    },
  }));
}

/**
 * Get route definition by key (for debugging/tooling)
 */
export function getRouteDefByKey(key: string): StitchRouteDef | undefined {
  return STITCH_ROUTE_DEFS.find(def => def.key === key);
}

/**
 * Validate route definitions (run in tests)
 */
export function validateRouteDefinitions(): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  
  for (const def of STITCH_ROUTE_DEFS) {
    // Check for duplicate keys
    if (keys.has(def.key)) {
      errors.push(`Duplicate route key: ${def.key}`);
    }
    keys.add(def.key);
    
    // Check param consistency
    if (def.param && !def.route.includes(`:${def.param}`)) {
      errors.push(`Route ${def.key}: param "${def.param}" not in route "${def.route}"`);
    }
    
    // Check for missing param definition
    if (def.route.includes(":") && !def.param) {
      errors.push(`Route ${def.key}: route has param but param field is empty`);
    }
  }
  
  return errors;
}
