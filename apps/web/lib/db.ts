import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Database } from 'sql.js';
import { DEFAULT_SITE_CONFIG } from '@/lib/site-defaults';

declare global {
  var __feiyan_db_open: Promise<Database> | undefined;
  var __feiyan_db_path: string | undefined;
}

export function getSqliteFilePath(): string {
  return process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'site.db');
}

type SqlJsStatic = import('sql.js').SqlJsStatic;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/** 通过根目录 sqljs-bootstrap.cjs 加载 sql.js，避免 Webpack 改写 createRequire / require */
async function loadSql(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const wasmDir = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist');
    const bootstrapPath = path.join(process.cwd(), 'sqljs-bootstrap.cjs');
    const href = pathToFileURL(bootstrapPath).href;
    const loaded = await import(/* webpackIgnore: true */ href);
    const initSqlJs = loaded.default as (o?: { locateFile?: (f: string) => string }) => Promise<SqlJsStatic>;
    sqlJsPromise = initSqlJs({
      locateFile: (file) => path.join(wasmDir, file),
    });
  }
  return sqlJsPromise;
}

function listTableColumnNames(db: Database, table: string): Set<string> {
  const r = db.exec(`PRAGMA table_info(${table})`);
  if (!r?.length) return new Set();
  const { columns, values } = r[0];
  const idx = columns.indexOf('name');
  if (idx < 0) return new Set();
  const names = new Set<string>();
  for (const row of values) names.add(String(row[idx]));
  return names;
}

/** 旧库补列：新建库已在 CREATE 中含下列字段。返回 true 表示执行了 ALTER，需 persistDb。 */
function migrateCaptainsColumns(db: Database): boolean {
  if (rowCount(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='captains'") === 0) return false;
  const cols = listTableColumnNames(db, 'captains');
  let changed = false;
  if (!cols.has('note')) {
    db.run('ALTER TABLE captains ADD COLUMN note TEXT');
    changed = true;
  }
  if (!cols.has('ship_tier')) {
    db.run('ALTER TABLE captains ADD COLUMN ship_tier TEXT');
    changed = true;
  }
  if (!cols.has('shipped_at')) {
    db.run('ALTER TABLE captains ADD COLUMN shipped_at INTEGER');
    changed = true;
  }
  if (!cols.has('wechat_remark')) {
    db.run('ALTER TABLE captains ADD COLUMN wechat_remark TEXT');
    changed = true;
  }
  if (!cols.has('game_id_remark')) {
    db.run('ALTER TABLE captains ADD COLUMN game_id_remark TEXT');
    changed = true;
  }
  if (!cols.has('bilibili_face_url')) {
    db.run('ALTER TABLE captains ADD COLUMN bilibili_face_url TEXT');
    changed = true;
  }
  return changed;
}

/** 热重载等场景下内存里的 sql.js 可能仍是旧表结构；舰长相关读写前先补列并落盘 */
async function getCaptainsDb(): Promise<Database> {
  const db = await getDb();
  if (migrateCaptainsColumns(db)) persistDb(db);
  return db;
}

function migrateHostingTodosColumns(db: Database): boolean {
  if (rowCount(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='hosting_todos'") === 0) return false;
  const cols = listTableColumnNames(db, 'hosting_todos');
  let changed = false;
  if (!cols.has('host_type')) {
    db.run("ALTER TABLE hosting_todos ADD COLUMN host_type TEXT NOT NULL DEFAULT 'scan'");
    changed = true;
  }
  if (!cols.has('stuck_task')) {
    db.run('ALTER TABLE hosting_todos ADD COLUMN stuck_task INTEGER NOT NULL DEFAULT 0');
    changed = true;
  }
  if (!cols.has('sort_order')) {
    db.run('ALTER TABLE hosting_todos ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    changed = true;
  }
  if (!cols.has('created_at')) {
    db.run('ALTER TABLE hosting_todos ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');
    changed = true;
  }
  if (!cols.has('updated_at')) {
    db.run('ALTER TABLE hosting_todos ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
    changed = true;
  }
  if (!cols.has('captain_id')) {
    // 关联舰长唯一 id；旧数据为 null（无法回填简称）
    db.run('ALTER TABLE hosting_todos ADD COLUMN captain_id INTEGER');
    changed = true;
  }
  return changed;
}

/** 若无表则创建；若有表则补列。有结构变更时返回 true（需 persistDb） */
function ensureHostingTodosSchema(db: Database): boolean {
  if (rowCount(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='hosting_todos'") === 0) {
    db.run(`
      CREATE TABLE hosting_todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        todo_date TEXT NOT NULL,
        role_name TEXT NOT NULL,
        host_type TEXT NOT NULL,
        stuck_task INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        captain_id INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    return true;
  }
  return migrateHostingTodosColumns(db);
}

/** 按自然日标记「托管请假」，主页周历红框展示 */
function ensureHostingLeaveDatesSchema(db: Database): boolean {
  if (rowCount(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='hosting_leave_dates'") === 0) {
    db.run(`
      CREATE TABLE hosting_leave_dates (
        leave_date TEXT PRIMARY KEY NOT NULL
      );
    `);
    return true;
  }
  return false;
}

function normalizeLegacyHostingHostTypes(db: Database): boolean {
  db.run(
    "UPDATE hosting_todos SET host_type = 'scan' WHERE host_type = 'normal' OR IFNULL(TRIM(host_type), '') = '' OR host_type NOT IN ('scan', 'group')",
  );
  return db.getRowsModified() > 0;
}

/** 热重载等场景下内存库可能未含 hosting_todos；任一条目 API 入口先走此函数 */
async function getHostingTodosDb(): Promise<Database> {
  const db = await getDb();
  let changed = false;
  if (ensureHostingTodosSchema(db)) changed = true;
  if (ensureHostingLeaveDatesSchema(db)) changed = true;
  if (normalizeLegacyHostingHostTypes(db)) changed = true;
  if (changed) persistDb(db);
  return db;
}

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS captains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      id_name TEXT,
      remark_name TEXT,
      note TEXT,
      wechat_remark TEXT,
      game_id_remark TEXT,
      ship_tier TEXT,
      shipped_at INTEGER,
      avatar_filename TEXT,
      bilibili_face_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS cooperation_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      brand_name TEXT,
      summary TEXT,
      detail_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  migrateCaptainsColumns(db);
  ensureHostingTodosSchema(db);
  ensureHostingLeaveDatesSchema(db);
}

function rowCount(db: Database, sql: string): number {
  const res = db.exec(sql);
  if (!res.length || !res[0].values.length) return 0;
  return Number(res[0].values[0][0]);
}

function seed(db: Database): void {
  if (rowCount(db, 'SELECT COUNT(*) FROM site_settings WHERE id = 1') === 0) {
    const json = JSON.stringify(DEFAULT_SITE_CONFIG);
    db.run('INSERT INTO site_settings (id, json) VALUES (1, ?)', [json]);
  }
}

export async function getDb(): Promise<Database> {
  if (globalThis.__feiyan_db_open) return globalThis.__feiyan_db_open;

  globalThis.__feiyan_db_open = (async () => {
    const SQL = await loadSql();
    const dbPath = getSqliteFilePath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    globalThis.__feiyan_db_path = dbPath;

    let db: Database;
    if (fs.existsSync(dbPath)) {
      const buf = fs.readFileSync(dbPath);
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }

    migrate(db);
    seed(db);
    persistDb(db);
    return db;
  })();

  return globalThis.__feiyan_db_open;
}

export function persistDb(db: Database): void {
  const p = globalThis.__feiyan_db_path ?? getSqliteFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const data = db.export();
  fs.writeFileSync(p, Buffer.from(data));
}

export async function getSiteSettingsJson(): Promise<string | null> {
  const db = await getDb();
  const res = db.exec('SELECT json FROM site_settings WHERE id = 1');
  if (!res.length || !res[0].values.length) return null;
  return String(res[0].values[0][0]);
}

export async function saveSiteSettingsJson(json: string): Promise<void> {
  const db = await getDb();
  db.run('INSERT OR REPLACE INTO site_settings (id, json) VALUES (1, ?)', [json]);
  persistDb(db);
}

/**
 * 从 site_settings JSON 中获取指定键的值
 */
export async function getSiteSetting(key: string): Promise<unknown> {
  const json = await getSiteSettingsJson();
  if (!json) return null;
  try {
    const obj = JSON.parse(json);
    return obj[key] ?? null;
  } catch {
    return null;
  }
}

/**
 * 设置 site_settings JSON 中指定键的值
 */
export async function setSiteSetting(key: string, value: unknown): Promise<void> {
  const json = await getSiteSettingsJson();
  let obj: Record<string, unknown> = {};
  if (json) {
    try {
      obj = JSON.parse(json);
    } catch {
      obj = {};
    }
  }
  obj[key] = value;
  await saveSiteSettingsJson(JSON.stringify(obj));
}

export async function getAdminCount(): Promise<number> {
  const db = await getDb();
  return rowCount(db, 'SELECT COUNT(*) FROM admins');
}

/**
 * 首次部署：在尚无管理员时插入一条记录（事务内二次检查，降低并发双插风险）。
 * @returns 新建管理员 id；若已有管理员或插入失败则返回 null
 */
export async function insertFirstAdminIfEmpty(username: string, passwordHash: string): Promise<number | null> {
  const db = await getDb();
  const u = username.trim();
  if (!u || u.length > 64) return null;
  if (!passwordHash) return null;
  db.run('BEGIN IMMEDIATE');
  try {
    if (rowCount(db, 'SELECT COUNT(*) FROM admins') > 0) {
      db.run('ROLLBACK');
      return null;
    }
    const now = Date.now();
    db.run('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)', [u, passwordHash, now]);
    const rid = db.exec('SELECT last_insert_rowid() AS id');
    const id = Number(rid[0]?.values[0]?.[0] ?? 0);
    db.run('COMMIT');
    persistDb(db);
    return id > 0 ? id : null;
  } catch {
    try {
      db.run('ROLLBACK');
    } catch {
      /* noop */
    }
    return null;
  }
}

export type AdminRow = { id: number; username: string; password_hash: string };

export async function findAdminByUsername(username: string): Promise<AdminRow | null> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?');
  stmt.bind([username]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const raw = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  const id = Number(raw.id);
  const uname = String(raw.username ?? '');
  const password_hash = String(raw.password_hash ?? raw.PASSWORD_HASH ?? '');
  if (!uname || !password_hash) return null;
  return { id, username: uname, password_hash };
}

export type CaptainRow = {
  id: number;
  uid: string;
  id_name: string | null;
  remark_name: string | null;
  note: string | null;
  wechat_remark: string | null;
  game_id_remark: string | null;
  ship_tier: string | null;
  shipped_at: number | null;
  avatar_filename: string | null;
  bilibili_face_url: string | null;
  created_at: number;
  updated_at: number;
};

function readCaptainRow(raw: Record<string, unknown>): CaptainRow {
  return {
    id: Number(raw.id),
    uid: String(raw.uid ?? ''),
    id_name: raw.id_name == null ? null : String(raw.id_name),
    remark_name: raw.remark_name == null ? null : String(raw.remark_name),
    note: raw.note == null ? null : String(raw.note),
    wechat_remark: raw.wechat_remark == null || raw.wechat_remark === '' ? null : String(raw.wechat_remark),
    game_id_remark: raw.game_id_remark == null || raw.game_id_remark === '' ? null : String(raw.game_id_remark),
    ship_tier: (() => {
      const v = raw.ship_tier;
      if (v == null || v === '') return null;
      const n = String(v);
      return n;
    })(),
    shipped_at: (() => {
      const v = raw.shipped_at;
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })(),
    avatar_filename: raw.avatar_filename == null ? null : String(raw.avatar_filename),
    bilibili_face_url:
      raw.bilibili_face_url == null || raw.bilibili_face_url === '' ? null : String(raw.bilibili_face_url),
    created_at: Number(raw.created_at ?? 0),
    updated_at: Number(raw.updated_at ?? 0),
  };
}

export async function listCaptains(): Promise<CaptainRow[]> {
  const db = await getCaptainsDb();
  const stmt = db.prepare(
    'SELECT id, uid, id_name, remark_name, note, wechat_remark, game_id_remark, ship_tier, shipped_at, avatar_filename, bilibili_face_url, created_at, updated_at FROM captains ORDER BY updated_at DESC, id DESC',
  );
  const rows: CaptainRow[] = [];
  while (stmt.step()) {
    rows.push(readCaptainRow(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();
  return rows;
}

export async function getCaptainById(id: number): Promise<CaptainRow | null> {
  const db = await getCaptainsDb();
  const stmt = db.prepare(
    'SELECT id, uid, id_name, remark_name, note, wechat_remark, game_id_remark, ship_tier, shipped_at, avatar_filename, bilibili_face_url, created_at, updated_at FROM captains WHERE id = ?',
  );
  stmt.bind([id]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = readCaptainRow(stmt.getAsObject() as Record<string, unknown>);
  stmt.free();
  return row;
}

export async function getCaptainByUid(uid: string): Promise<CaptainRow | null> {
  const u = uid.trim();
  if (!u) return null;
  const db = await getCaptainsDb();
  const stmt = db.prepare(
    'SELECT id, uid, id_name, remark_name, note, wechat_remark, game_id_remark, ship_tier, shipped_at, avatar_filename, bilibili_face_url, created_at, updated_at FROM captains WHERE uid = ?',
  );
  stmt.bind([u]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = readCaptainRow(stmt.getAsObject() as Record<string, unknown>);
  stmt.free();
  return row;
}

export async function createCaptain(input: {
  uid: string;
  id_name: string | null;
  remark_name: string | null;
  note: string | null;
  wechat_remark?: string | null;
  game_id_remark?: string | null;
  ship_tier: string | null;
  shipped_at: number | null;
  bilibili_face_url?: string | null;
}): Promise<number> {
  const db = await getCaptainsDb();
  const now = Date.now();
  const wx = input.wechat_remark ?? null;
  const gid = input.game_id_remark ?? null;
  const face = input.bilibili_face_url ?? null;
  db.run(
    'INSERT INTO captains (uid, id_name, remark_name, note, wechat_remark, game_id_remark, ship_tier, shipped_at, avatar_filename, bilibili_face_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
    [input.uid, input.id_name, input.remark_name, input.note, wx, gid, input.ship_tier, input.shipped_at, face, now, now],
  );
  const rid = db.exec('SELECT last_insert_rowid() AS id');
  const id = Number(rid[0]?.values[0]?.[0] ?? 0);
  persistDb(db);
  return id;
}

export async function updateCaptain(
  id: number,
  patch: {
    uid?: string;
    id_name?: string | null;
    remark_name?: string | null;
    note?: string | null;
    wechat_remark?: string | null;
    game_id_remark?: string | null;
    ship_tier?: string | null;
    shipped_at?: number | null;
    avatar_filename?: string | null;
    bilibili_face_url?: string | null;
  },
): Promise<boolean> {
  const db = await getCaptainsDb();
  const cur = await getCaptainById(id);
  if (!cur) return false;
  const uid = patch.uid !== undefined ? patch.uid : cur.uid;
  const id_name = patch.id_name !== undefined ? patch.id_name : cur.id_name;
  const remark_name = patch.remark_name !== undefined ? patch.remark_name : cur.remark_name;
  const note = patch.note !== undefined ? patch.note : cur.note;
  const wechat_remark = patch.wechat_remark !== undefined ? patch.wechat_remark : cur.wechat_remark;
  const game_id_remark = patch.game_id_remark !== undefined ? patch.game_id_remark : cur.game_id_remark;
  const ship_tier = patch.ship_tier !== undefined ? patch.ship_tier : cur.ship_tier;
  const shipped_at = patch.shipped_at !== undefined ? patch.shipped_at : cur.shipped_at;
  const avatar_filename = patch.avatar_filename !== undefined ? patch.avatar_filename : cur.avatar_filename;
  const bilibili_face_url = patch.bilibili_face_url !== undefined ? patch.bilibili_face_url : cur.bilibili_face_url;
  const now = Date.now();
  db.run(
    'UPDATE captains SET uid = ?, id_name = ?, remark_name = ?, note = ?, wechat_remark = ?, game_id_remark = ?, ship_tier = ?, shipped_at = ?, avatar_filename = ?, bilibili_face_url = ?, updated_at = ? WHERE id = ?',
    [uid, id_name, remark_name, note, wechat_remark, game_id_remark, ship_tier, shipped_at, avatar_filename, bilibili_face_url, now, id],
  );
  persistDb(db);
  return true;
}

export async function setCaptainAvatarFilename(id: number, avatar_filename: string | null): Promise<boolean> {
  const db = await getCaptainsDb();
  const cur = await getCaptainById(id);
  if (!cur) return false;
  const now = Date.now();
  db.run('UPDATE captains SET avatar_filename = ?, updated_at = ? WHERE id = ?', [avatar_filename, now, id]);
  persistDb(db);
  return true;
}

export async function deleteCaptainRow(id: number): Promise<CaptainRow | null> {
  const db = await getCaptainsDb();
  const cur = await getCaptainById(id);
  if (!cur) return null;
  db.run('DELETE FROM captains WHERE id = ?', [id]);
  persistDb(db);
  return cur;
}

export type HostingTodoRow = {
  id: number;
  todo_date: string;
  role_name: string;
  host_type: string;
  stuck_task: number;
  sort_order: number;
  captain_id: number | null;
  created_at: number;
  updated_at: number;
};

function readHostingTodoRow(raw: Record<string, unknown>): HostingTodoRow {
  const rawHt = String(raw.host_type ?? '').trim();
  const host_type = rawHt === 'scan' || rawHt === 'group' ? rawHt : 'scan';
  const capId = raw.captain_id;
  return {
    id: Number(raw.id),
    todo_date: String(raw.todo_date ?? ''),
    role_name: String(raw.role_name ?? ''),
    host_type,
    stuck_task: Number(raw.stuck_task ?? 0) ? 1 : 0,
    sort_order: Number(raw.sort_order ?? 0),
    captain_id: capId == null || capId === '' ? null : Number(capId),
    created_at: Number(raw.created_at ?? 0),
    updated_at: Number(raw.updated_at ?? 0),
  };
}

function maxSortOrderOnDate(db: Database, todo_date: string): number {
  const stmt = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM hosting_todos WHERE todo_date = ?');
  stmt.bind([todo_date]);
  let m = -1;
  if (stmt.step()) {
    const o = stmt.getAsObject() as Record<string, unknown>;
    m = Number(o.m ?? o.M ?? -1);
  }
  stmt.free();
  return Number.isFinite(m) ? m : -1;
}

export async function listHostingLeaveDates(): Promise<string[]> {
  const db = await getHostingTodosDb();
  const stmt = db.prepare('SELECT leave_date FROM hosting_leave_dates ORDER BY leave_date ASC');
  const out: string[] = [];
  while (stmt.step()) {
    const o = stmt.getAsObject() as Record<string, unknown>;
    const d = String(o.leave_date ?? (o as { LEAVE_DATE?: string }).LEAVE_DATE ?? '').trim();
    if (d) out.push(d);
  }
  stmt.free();
  return out;
}

export async function setHostingLeaveDate(leaveDate: string, onLeave: boolean): Promise<void> {
  const db = await getHostingTodosDb();
  if (onLeave) {
    db.run('INSERT OR REPLACE INTO hosting_leave_dates (leave_date) VALUES (?)', [leaveDate]);
  } else {
    db.run('DELETE FROM hosting_leave_dates WHERE leave_date = ?', [leaveDate]);
  }
  persistDb(db);
}

export async function listHostingTodos(): Promise<HostingTodoRow[]> {
  const db = await getHostingTodosDb();
  const stmt = db.prepare(
    'SELECT id, todo_date, role_name, host_type, stuck_task, sort_order, captain_id, created_at, updated_at FROM hosting_todos ORDER BY todo_date ASC, sort_order ASC, id ASC',
  );
  const rows: HostingTodoRow[] = [];
  while (stmt.step()) {
    rows.push(readHostingTodoRow(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();
  return rows;
}

export async function getHostingTodoById(id: number): Promise<HostingTodoRow | null> {
  const db = await getHostingTodosDb();
  const stmt = db.prepare(
    'SELECT id, todo_date, role_name, host_type, stuck_task, sort_order, captain_id, created_at, updated_at FROM hosting_todos WHERE id = ?',
  );
  stmt.bind([id]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = readHostingTodoRow(stmt.getAsObject() as Record<string, unknown>);
  stmt.free();
  return row;
}

export async function createHostingTodo(input: {
  todo_date: string;
  role_name: string;
  host_type: string;
  stuck_task: number;
  captain_id?: number | null;
}): Promise<number> {
  const db = await getHostingTodosDb();
  const now = Date.now();
  const nextOrder = maxSortOrderOnDate(db, input.todo_date) + 1;
  const captainId = input.captain_id == null ? null : Number(input.captain_id);
  db.run(
    'INSERT INTO hosting_todos (todo_date, role_name, host_type, stuck_task, sort_order, captain_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [input.todo_date, input.role_name, input.host_type, input.stuck_task ? 1 : 0, nextOrder, captainId, now, now],
  );
  const rid = db.exec('SELECT last_insert_rowid() AS id');
  const id = Number(rid[0]?.values[0]?.[0] ?? 0);
  persistDb(db);
  return id;
}

export async function updateHostingTodo(
  id: number,
  patch: {
    todo_date?: string;
    role_name?: string;
    host_type?: string;
    stuck_task?: number;
    sort_order?: number;
  },
): Promise<boolean> {
  const db = await getHostingTodosDb();
  const cur = await getHostingTodoById(id);
  if (!cur) return false;
  const todo_date = patch.todo_date !== undefined ? patch.todo_date : cur.todo_date;
  const role_name = patch.role_name !== undefined ? patch.role_name : cur.role_name;
  const host_type = patch.host_type !== undefined ? patch.host_type : cur.host_type;
  const stuck_task = patch.stuck_task !== undefined ? (patch.stuck_task ? 1 : 0) : cur.stuck_task;
  const sort_order = patch.sort_order !== undefined ? patch.sort_order : cur.sort_order;
  const now = Date.now();
  db.run(
    'UPDATE hosting_todos SET todo_date = ?, role_name = ?, host_type = ?, stuck_task = ?, sort_order = ?, updated_at = ? WHERE id = ?',
    [todo_date, role_name, host_type, stuck_task, sort_order, now, id],
  );
  persistDb(db);
  return true;
}

export async function deleteHostingTodo(id: number): Promise<boolean> {
  const db = await getHostingTodosDb();
  const cur = await getHostingTodoById(id);
  if (!cur) return false;
  db.run('DELETE FROM hosting_todos WHERE id = ?', [id]);
  persistDb(db);
  return true;
}

export async function reorderHostingTodosForDate(todo_date: string, orderedIds: number[]): Promise<boolean> {
  const db = await getHostingTodosDb();
  const now = Date.now();
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const row = await getHostingTodoById(id);
    if (!row || row.todo_date !== todo_date) return false;
    db.run('UPDATE hosting_todos SET sort_order = ?, updated_at = ? WHERE id = ?', [i, now, id]);
  }
  persistDb(db);
  return true;
}

/** 拖到新日期：放到该日末尾 */
export async function moveHostingTodoToDate(id: number, newDate: string): Promise<boolean> {
  const db = await getHostingTodosDb();
  const cur = await getHostingTodoById(id);
  if (!cur) return false;
  if (cur.todo_date === newDate) return true;
  const now = Date.now();
  const nextOrder = maxSortOrderOnDate(db, newDate) + 1;
  db.run('UPDATE hosting_todos SET todo_date = ?, sort_order = ?, updated_at = ? WHERE id = ?', [newDate, nextOrder, now, id]);
  persistDb(db);
  return true;
}

/**
 * 批量改期（队列延后）：整条时间线重排，部分成功会留下错乱的排期，故必须原子。
 * 同一目标日内按 moves 给出的顺序重新编号 sort_order。
 */
export async function bulkMoveHostingTodos(moves: { id: number; toDate: string }[]): Promise<boolean> {
  if (moves.length === 0) return true;
  const db = await getHostingTodosDb();
  const now = Date.now();

  db.run('BEGIN IMMEDIATE');
  try {
    // 改期前的位置快照：重排时要靠它还原时间线先后，不能用改期后的 sort_order
    const before = new Map<number, { date: string; sort: number }>();
    const snap = db.prepare('SELECT id, todo_date, sort_order FROM hosting_todos');
    while (snap.step()) {
      const o = snap.getAsObject() as Record<string, unknown>;
      before.set(Number(o.id), { date: String(o.todo_date ?? ''), sort: Number(o.sort_order ?? 0) });
    }
    snap.free();

    for (const mv of moves) {
      if (!Number.isFinite(mv.id) || mv.id <= 0) throw new Error('无效 id');
      if (!before.has(mv.id)) throw new Error(`条目 ${mv.id} 不存在`);
      db.run('UPDATE hosting_todos SET todo_date = ?, updated_at = ? WHERE id = ?', [mv.toDate, now, mv.id]);
    }

    /*
     * 受影响日期内重排 sort_order。
     * 按改期「前」的 (日期, sort_order, id) 排序 —— 即全局时间线顺序。
     * 若按改期后的 sort_order 排，来自不同源日期的条目并到同一天时会被颠倒：
     * A(05-10, sort=9) 与 B(05-11, sort=0) 同时落到 05-11，时间线上 A 在 B 前，
     * 但按旧 sort_order 排会得到 B, A。
     */
    const touched = new Set(moves.map(m => m.toDate));
    for (const date of touched) {
      const stmt = db.prepare('SELECT id FROM hosting_todos WHERE todo_date = ?');
      stmt.bind([date]);
      const ids: number[] = [];
      while (stmt.step()) {
        const o = stmt.getAsObject() as Record<string, unknown>;
        ids.push(Number(o.id));
      }
      stmt.free();
      ids.sort((a, b) => {
        const pa = before.get(a);
        const pb = before.get(b);
        if (!pa || !pb) return a - b;
        return pa.date.localeCompare(pb.date) || pa.sort - pb.sort || a - b;
      });
      for (let i = 0; i < ids.length; i++) {
        db.run('UPDATE hosting_todos SET sort_order = ? WHERE id = ?', [i, ids[i]]);
      }
    }

    db.run('COMMIT');
    persistDb(db);
    return true;
  } catch (e) {
    console.error('[bulkMoveHostingTodos]', e);
    try {
      db.run('ROLLBACK');
    } catch (rollbackErr) {
      /*
       * ROLLBACK 失败：这个 Database 句柄是进程级共享的，半应用的 UPDATE 会留在内存里，
       * 之后任何 handler 的 persistDb 都会把它写进文件。重新从磁盘加载以丢弃脏状态。
       */
      console.error('[bulkMoveHostingTodos] ROLLBACK 失败，丢弃内存库并从磁盘重载', rollbackErr);
      globalThis.__feiyan_db_open = undefined;
    }
    return false;
  }
}

export type CooperationCaseRow = {
  id: number;
  title: string;
  brand_name: string | null;
  summary: string | null;
  detail_url: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

function readCooperationCaseRow(raw: Record<string, unknown>): CooperationCaseRow {
  return {
    id: Number(raw.id),
    title: String(raw.title ?? ''),
    brand_name: raw.brand_name == null || raw.brand_name === '' ? null : String(raw.brand_name),
    summary: raw.summary == null || raw.summary === '' ? null : String(raw.summary),
    detail_url: raw.detail_url == null || raw.detail_url === '' ? null : String(raw.detail_url),
    sort_order: Number(raw.sort_order ?? 0),
    created_at: Number(raw.created_at ?? 0),
    updated_at: Number(raw.updated_at ?? 0),
  };
}

function maxCooperationCaseSortOrder(db: Database): number {
  const res = db.exec('SELECT COALESCE(MAX(sort_order), -1) AS m FROM cooperation_cases');
  if (!res.length || !res[0].values.length) return -1;
  const m = Number(res[0].values[0][0]);
  return Number.isFinite(m) ? m : -1;
}

export async function listCooperationCases(): Promise<CooperationCaseRow[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, title, brand_name, summary, detail_url, sort_order, created_at, updated_at FROM cooperation_cases ORDER BY sort_order ASC, id ASC',
  );
  const rows: CooperationCaseRow[] = [];
  while (stmt.step()) {
    rows.push(readCooperationCaseRow(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();
  return rows;
}

export async function getCooperationCaseById(id: number): Promise<CooperationCaseRow | null> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, title, brand_name, summary, detail_url, sort_order, created_at, updated_at FROM cooperation_cases WHERE id = ?',
  );
  stmt.bind([id]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = readCooperationCaseRow(stmt.getAsObject() as Record<string, unknown>);
  stmt.free();
  return row;
}

export async function createCooperationCase(input: {
  title: string;
  brand_name: string | null;
  summary: string | null;
  detail_url: string | null;
  sort_order?: number | null;
}): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const order =
    input.sort_order != null && Number.isFinite(input.sort_order)
      ? Math.trunc(Number(input.sort_order))
      : maxCooperationCaseSortOrder(db) + 1;
  db.run(
    'INSERT INTO cooperation_cases (title, brand_name, summary, detail_url, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [input.title, input.brand_name, input.summary, input.detail_url, order, now, now],
  );
  const rid = db.exec('SELECT last_insert_rowid() AS id');
  const id = Number(rid[0]?.values[0]?.[0] ?? 0);
  persistDb(db);
  return id;
}

export async function updateCooperationCase(
  id: number,
  patch: {
    title?: string;
    brand_name?: string | null;
    summary?: string | null;
    detail_url?: string | null;
    sort_order?: number;
  },
): Promise<boolean> {
  const db = await getDb();
  const cur = await getCooperationCaseById(id);
  if (!cur) return false;
  const title = patch.title !== undefined ? patch.title : cur.title;
  const brand_name = patch.brand_name !== undefined ? patch.brand_name : cur.brand_name;
  const summary = patch.summary !== undefined ? patch.summary : cur.summary;
  const detail_url = patch.detail_url !== undefined ? patch.detail_url : cur.detail_url;
  const sort_order =
    patch.sort_order !== undefined && Number.isFinite(patch.sort_order) ? Math.trunc(patch.sort_order) : cur.sort_order;
  const now = Date.now();
  db.run(
    'UPDATE cooperation_cases SET title = ?, brand_name = ?, summary = ?, detail_url = ?, sort_order = ?, updated_at = ? WHERE id = ?',
    [title, brand_name, summary, detail_url, sort_order, now, id],
  );
  persistDb(db);
  return true;
}

export async function deleteCooperationCase(id: number): Promise<boolean> {
  const db = await getDb();
  const cur = await getCooperationCaseById(id);
  if (!cur) return false;
  db.run('DELETE FROM cooperation_cases WHERE id = ?', [id]);
  persistDb(db);
  return true;
}
