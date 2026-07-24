// Shared in-memory fake Supabase client for src/lib/intelligence/* unit
// tests. Not a test file itself (no .test. in the name) -- imported by
// the actual *.test.ts files in this directory. A single shared fake is
// used here (rather than one inline per file, the convention elsewhere in
// this program) because PR5's domain services collectively touch ~18
// tables with a wider filter-operator surface than PR3/PR4 needed.

export type Row = Record<string, any>;

let idCounter = 0;
export function resetIdCounter() {
  idCounter = 0;
}

type Filter = { t: "eq" | "neq" | "in" | "notIn" | "gte" | "lte" | "lt" | "gt" | "ilike" | "isNull" | "notNull"; k: string; v?: any };

export class FakeDb {
  tables: Record<string, Row[]> = {};
  constructor(seed?: Partial<Record<string, Row[]>>) {
    if (seed) for (const [k, v] of Object.entries(seed)) if (v) this.tables[k] = v;
  }
  from(table: string) {
    this.tables[table] ??= [];
    return new FakeQuery(this, table);
  }
}

const DEFAULTS: Record<string, any> = {
  status: "open",
  is_active: true,
  do_not_contact: false,
  follow_up_required: false,
};

class FakeQuery {
  db: FakeDb;
  table: string;
  filters: Filter[] = [];
  _selectCols: string | null = null;
  _order: { col: string; asc: boolean } | null = null;
  _limit: number | null = null;
  _update: Row | null = null;
  _insert: Row[] | null = null;
  _delete = false;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(cols?: string) {
    this._selectCols = cols ?? null;
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this._order = { col, asc: opts?.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this._limit = n;
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ t: "eq", k, v });
    return this;
  }
  neq(k: string, v: any) {
    this.filters.push({ t: "neq", k, v });
    return this;
  }
  in(k: string, v: any[]) {
    this.filters.push({ t: "in", k, v });
    return this;
  }
  not(k: string, op: string, v: any) {
    if (op === "is" && v === null) return this.filters.push({ t: "notNull", k }), this;
    if (op === "in") {
      const list = typeof v === "string" ? v.replace(/^\(|\)$/g, "").split(",") : v;
      this.filters.push({ t: "notIn", k, v: list });
      return this;
    }
    return this;
  }
  is(k: string, v: null) {
    if (v === null) this.filters.push({ t: "isNull", k });
    return this;
  }
  gte(k: string, v: any) {
    this.filters.push({ t: "gte", k, v });
    return this;
  }
  lte(k: string, v: any) {
    this.filters.push({ t: "lte", k, v });
    return this;
  }
  lt(k: string, v: any) {
    this.filters.push({ t: "lt", k, v });
    return this;
  }
  gt(k: string, v: any) {
    this.filters.push({ t: "gt", k, v });
    return this;
  }
  ilike(k: string, v: string) {
    this.filters.push({ t: "ilike", k, v });
    return this;
  }
  insert(payload: Row | Row[]) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
      id: r.id ?? `id-${++idCounter}`,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      enrolled_at: new Date(0).toISOString(),
      ...r,
    }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...rows);
    this._insert = rows;
    return this;
  }
  update(patch: Row) {
    this._update = patch;
    return this;
  }
  delete() {
    this._delete = true;
    return this;
  }
  single(): Promise<{ data: any; error: any }> {
    if (this._insert) return Promise.resolve({ data: { ...this._insert[0] }, error: null });
    if (this._update) {
      this.applyUpdate();
      const rows = this.rowsCopy();
      return Promise.resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } });
    }
    const rows = this.rowsCopy();
    return rows.length ? Promise.resolve({ data: rows[0], error: null }) : Promise.resolve({ data: null, error: { message: "no rows" } });
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this._update) this.applyUpdate();
    return Promise.resolve({ data: this.rowsCopy()[0] ?? null, error: null });
  }
  then(onFulfilled: any, onRejected?: any) {
    if (this._delete) {
      this.applyDelete();
      return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    }
    if (this._insert) return Promise.resolve({ data: this._insert.map((r) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
    if (this._update) {
      this.applyUpdate();
      return Promise.resolve({ data: this.rowsCopy(), error: null }).then(onFulfilled, onRejected);
    }
    let rows = this.rowsCopy();
    if (this._order) {
      const { col, asc } = this._order;
      rows = rows.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
  }
  private rowsCopy(): Row[] {
    let rows = this.rows().map((r) => ({ ...r }));
    if (this._order) {
      const { col, asc } = this._order;
      rows = rows.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return rows;
  }
  private applyUpdate() {
    for (const row of this.rows()) Object.assign(row, this._update);
  }
  private applyDelete() {
    const matching = new Set(this.rows());
    this.db.tables[this.table] = (this.db.tables[this.table] ?? []).filter((r) => !matching.has(r));
  }
  private field(row: Row, key: string): any {
    return key in row ? row[key] : DEFAULTS[key];
  }
  private matches(row: Row): boolean {
    for (const f of this.filters) {
      const val = this.field(row, f.k);
      if (f.t === "eq" && val !== f.v) return false;
      if (f.t === "neq" && val === f.v) return false;
      if (f.t === "in" && !(f.v as any[]).includes(val)) return false;
      if (f.t === "notIn" && (f.v as any[]).includes(val)) return false;
      if (f.t === "gte" && !(val != null && val >= f.v)) return false;
      if (f.t === "lte" && !(val != null && val <= f.v)) return false;
      if (f.t === "lt" && !(val != null && val < f.v)) return false;
      if (f.t === "gt" && !(val != null && val > f.v)) return false;
      if (f.t === "ilike" && String(val ?? "").toLowerCase() !== String(f.v ?? "").toLowerCase()) return false;
      if (f.t === "isNull" && val != null) return false;
      if (f.t === "notNull" && val == null) return false;
    }
    return true;
  }
  private rows(): Row[] {
    return (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
  }
}
