import { UWContext } from "./types";

/**
 * Predicate DSL examples:
 * { "=": ["deal_type","Commercial Real Estate"] }
 * { ">": ["ltv",0.80] }
 * { "and": [ ... ] }
 * { "or": [ ... ] }
 * { "in": ["deal_type", ["SBA 7(a)","SBA 504"]] }
 * { "exists": ["dscr"] }
 */
export function evalPredicate(pred: any, ctx: UWContext): boolean {
  if (!pred || typeof pred !== "object") return false;

  if (pred.and && Array.isArray(pred.and)) return pred.and.every((p: any) => evalPredicate(p, ctx));
  if (pred.or && Array.isArray(pred.or)) return pred.or.some((p: any) => evalPredicate(p, ctx));
  if (pred.not) return !evalPredicate(pred.not, ctx);

  const op = Object.keys(pred)[0];
  const args = (pred as any)[op];

  const getVal = (k: any) => (typeof k === "string" ? (ctx as any)[k] : k);

  switch (op) {
    case "=": {
      const [a, b] = args;
      return getVal(a) === getVal(b);
    }
    case "!=": {
      const [a, b] = args;
      return getVal(a) !== getVal(b);
    }
    case ">": {
      const [a, b] = args;
      const av = Number(getVal(a));
      const bv = Number(getVal(b));
      return Number.isFinite(av) && Number.isFinite(bv) && av > bv;
    }
    case ">=": {
      const [a, b] = args;
      const av = Number(getVal(a));
      const bv = Number(getVal(b));
      return Number.isFinite(av) && Number.isFinite(bv) && av >= bv;
    }
    case "<": {
      const [a, b] = args;
      const av = Number(getVal(a));
      const bv = Number(getVal(b));
      return Number.isFinite(av) && Number.isFinite(bv) && av < bv;
    }
    case "<=": {
      const [a, b] = args;
      const av = Number(getVal(a));
      const bv = Number(getVal(b));
      return Number.isFinite(av) && Number.isFinite(bv) && av <= bv;
    }
    case "in": {
      const [a, list] = args;
      const av = getVal(a);
      return Array.isArray(list) && list.includes(av);
    }
    case "exists": {
      const [a] = args;
      const av = getVal(a);
      return av !== null && av !== undefined && av !== "";
    }
    default:
      return false;
  }
}
