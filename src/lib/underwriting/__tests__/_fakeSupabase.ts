/**
 * Shared in-memory Supabase fake for underwriting tests.
 *
 * Implements the subset of @supabase/supabase-js query-builder methods that
 * `runBankerAnalysisPipeline`, `getDealAnalysisStatus`, and
 * `cleanupStaleAnalysisRuns` actually call. Each test should construct a
 * fresh fake and (when needed) supply an explicit list of operations to
 * fail via `failures`.
 *
 * Filename starts with `_` so the test runner glob (`*.test.ts`) doesn't
 * pick it up as a test file.
 */

export type FakeRow = Record<string, any>;

export type FakeFailureSpec = {
  table: string;
  op: "insert" | "update" | "upsert" | "select";
};

export type FakeFixtures = Record<string, FakeRow[]>;

export type FakeSupabase = {
  sb: any;
  tables: Record<string, FakeRow[]>;
  inserts: { table: string; rows: FakeRow[] }[];
  updates: { table: string; patch: FakeRow; filter: FakeRow[] }[];
  upserts: { table: string; rows: FakeRow[] }[];
};

export function fakeSupabase(
  initial: FakeFixtures = {},
  failures: FakeFailureSpec[] = [],
): FakeSupabase {
  const tables: Record<string, FakeRow[]> = {};
  for (const k of Object.keys(initial)) {
    tables[k] = initial[k]?.slice() ?? [];
  }

  const inserts: { table: string; rows: FakeRow[] }[] = [];
  const updates: { table: string; patch: FakeRow; filter: FakeRow[] }[] = [];
  const upserts: { table: string; rows: FakeRow[] }[] = [];

  function newId(): string {
    return `id_${Math.random().toString(36).slice(2, 12)}`;
  }

  function builder(table: string) {
    let rows: FakeRow[] = (tables[table] ??= []).slice();
    let action: "select" | "insert" | "update" | "upsert" = "select";
    let _patch: FakeRow | null = null;
    let _insertRows: FakeRow[] = [];
    let _upsertRows: FakeRow[] = [];
    let _orderKey: string | null = null;
    let _orderAsc = true;
    let _limit: number | null = null;
    let _wantSingle: "single" | "maybeSingle" | null = null;

    function shouldFail(): boolean {
      return failures.some((f) => f.table === table && f.op === action);
    }

    const apply = (filter: (r: FakeRow) => boolean) => {
      rows = rows.filter(filter);
      return chain;
    };

    const chain: any = {
      select(_cols?: string) {
        return chain;
      },
      insert(rowOrRows: FakeRow | FakeRow[]) {
        action = "insert";
        _insertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        return chain;
      },
      update(patch: FakeRow) {
        action = "update";
        _patch = patch;
        return chain;
      },
      upsert(rowOrRows: FakeRow | FakeRow[]) {
        action = "upsert";
        _upsertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        return chain;
      },
      eq(col: string, val: unknown) {
        return apply((r) => r[col] === val);
      },
      neq(col: string, val: unknown) {
        return apply((r) => r[col] !== val);
      },
      not(_col: string, _op: string, _val: unknown) {
        return chain;
      },
      in(col: string, vals: unknown[]) {
        return apply((r) => vals.includes(r[col]));
      },
      gte(col: string, val: any) {
        return apply((r) => r[col] >= val);
      },
      lt(col: string, val: any) {
        return apply((r) => r[col] < val);
      },
      gt(col: string, val: any) {
        return apply((r) => r[col] > val);
      },
      is(col: string, val: any) {
        if (val === null) return apply((r) => r[col] == null);
        return apply((r) => r[col] === val);
      },
      or(_expr: string) {
        return chain;
      },
      filter() {
        return chain;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        _orderKey = col;
        _orderAsc = opts?.ascending ?? true;
        return chain;
      },
      limit(n: number) {
        _limit = n;
        return chain;
      },
      single() {
        _wantSingle = "single";
        return resolve();
      },
      maybeSingle() {
        _wantSingle = "maybeSingle";
        return resolve();
      },
      then(onF: any, onR?: any) {
        return resolve().then(onF, onR);
      },
    };

    function resolve(): Promise<{ data: any; error: any; count?: number }> {
      if (shouldFail()) {
        return Promise.resolve({
          data: null,
          error: { message: `fake_${action}_failed` },
        });
      }

      if (action === "insert") {
        const stamped = _insertRows.map((r) => ({
          id: r.id ?? newId(),
          created_at: r.created_at ?? new Date().toISOString(),
          ...r,
        }));
        tables[table].push(...stamped);
        inserts.push({ table, rows: stamped });
        const data =
          _wantSingle === "single" || _wantSingle === "maybeSingle"
            ? stamped[0] ?? null
            : stamped;
        return Promise.resolve({ data, error: null });
      }
      if (action === "upsert") {
        const stamped: FakeRow[] = _upsertRows.map((r) => ({
          id: r.id ?? newId(),
          ...r,
        }));
        for (const r of stamped) {
          const idx = tables[table].findIndex(
            (t: FakeRow) => t.deal_id === r.deal_id,
          );
          if (idx >= 0) tables[table][idx] = { ...tables[table][idx], ...r };
          else tables[table].push(r);
        }
        upserts.push({ table, rows: stamped });
        return Promise.resolve({ data: stamped, error: null });
      }
      if (action === "update") {
        const matching = rows;
        for (const r of matching) {
          const idx = tables[table].indexOf(r);
          if (idx >= 0) {
            tables[table][idx] = { ...tables[table][idx], ..._patch };
          }
        }
        updates.push({ table, patch: _patch ?? {}, filter: matching });
        return Promise.resolve({ data: matching, error: null });
      }

      // select
      let result = rows.slice();
      if (_orderKey) {
        result.sort((a, b) =>
          _orderAsc
            ? String(a[_orderKey!] ?? "") > String(b[_orderKey!] ?? "")
              ? 1
              : -1
            : String(a[_orderKey!] ?? "") < String(b[_orderKey!] ?? "")
              ? 1
              : -1,
        );
      }
      if (_limit != null) result = result.slice(0, _limit);
      const data =
        _wantSingle === "single"
          ? result[0] ?? null
          : _wantSingle === "maybeSingle"
            ? result[0] ?? null
            : result;
      return Promise.resolve({ data, error: null });
    }

    return chain;
  }

  const sb: any = {
    from: (t: string) => builder(t),
    rpc: async () => ({ data: null, error: null }),
  };

  return { sb, tables, inserts, updates, upserts };
}
