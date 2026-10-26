import type { GameState } from '../core/types';
import { CURRENT_SCHEMA_VERSION, SAVE_BACKUP_KEY, SAVE_CORRUPT_KEY, SAVE_KEY } from '../data/constants';
import { createInitialState, createOwnedBus } from '../core/state';
import { BUS_BY_ID, STARTER_BUS_ID } from '../data/buses';
import { hashString, isFiniteNumber } from '../core/utils';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Storage for tests, private browsing fallbacks and non-browser environments. */
export class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migration n transforms schema version n into n+1.
 * Add an entry here (and bump CURRENT_SCHEMA_VERSION) whenever the GameState shape changes.
 */
export const MIGRATIONS: Record<number, Migration> = {};

interface Envelope {
  v: number;
  savedAt: number;
  checksum: number;
  data: Record<string, unknown>;
}

export interface LoadResult {
  state: GameState;
  source: 'primary' | 'backup' | 'new';
  /** true when the primary save was unreadable (corrupt) */
  corrupted: boolean;
  /** true when we recovered from the backup */
  recoveredFromBackup: boolean;
  message?: string;
}

export function checksumOf(data: unknown): number {
  return hashString(JSON.stringify(data));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Fills missing / wrongly-typed fields from defaults without throwing away valid data. */
export function mergeDefaults<T>(defaults: T, data: unknown): T {
  if (Array.isArray(defaults)) return (Array.isArray(data) ? data : defaults) as T;
  if (isObject(defaults)) {
    const src = isObject(data) ? data : {};
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(defaults)) {
      out[k] = mergeDefaults((defaults as Record<string, unknown>)[k], src[k]);
    }
    // keep dynamic-key records (progress maps, reports, counters) that are not in the defaults
    for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
    return out as T;
  }
  if (defaults === null) return (data === undefined ? defaults : data) as T;
  return (typeof data === typeof defaults && (typeof data !== 'number' || Number.isFinite(data)) ? data : defaults) as T;
}

export class SaveManager {
  private dirty = false;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly now: () => number = () => Date.now(),
    private readonly migrations: Record<number, Migration> = MIGRATIONS,
    private readonly currentVersion: number = CURRENT_SCHEMA_VERSION,
  ) {}

  markDirty(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  serialize(state: GameState): string {
    const data = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    const env: Envelope = { v: this.currentVersion, savedAt: this.now(), checksum: checksumOf(data), data };
    return JSON.stringify(env);
  }

  /** Writes the save. The previous valid primary is kept as a backup first. */
  save(state: GameState): { ok: boolean; error?: string } {
    try {
      const payload = this.serialize(state);
      const prev = this.storage.getItem(SAVE_KEY);
      if (prev && this.parse(prev)) this.storage.setItem(SAVE_BACKUP_KEY, prev);
      this.storage.setItem(SAVE_KEY, payload);
      this.dirty = false;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  flushIfDirty(state: GameState): void {
    if (this.dirty) this.save(state);
  }

  /** Parses and validates an envelope; returns null if unreadable / checksum mismatch. */
  private parse(raw: string): Envelope | null {
    try {
      const env = JSON.parse(raw) as Envelope;
      if (!isObject(env) || !isObject(env.data) || !isFiniteNumber(env.v)) return null;
      if (env.checksum !== checksumOf(env.data)) return null;
      return env;
    } catch {
      return null;
    }
  }

  migrate(data: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
    let cur = data;
    for (let v = fromVersion; v < this.currentVersion; v++) {
      const step = this.migrations[v];
      if (!step) throw new Error(`Missing migration ${v} -> ${v + 1}`);
      cur = step(cur);
      cur.schemaVersion = v + 1;
    }
    return cur;
  }

  /** Brings arbitrary loaded data into a valid GameState. */
  sanitize(data: Record<string, unknown>): GameState {
    const now = this.now();
    const merged = mergeDefaults(createInitialState(now), data) as GameState;
    merged.schemaVersion = this.currentVersion;
    merged.cash = Math.max(0, isFiniteNumber(merged.cash) ? merged.cash : 0);
    merged.gold = Math.max(0, isFiniteNumber(merged.gold) ? merged.gold : 0);
    merged.buses = (Array.isArray(merged.buses) ? merged.buses : []).filter((b) => b && BUS_BY_ID[b.modelId] && typeof b.uid === 'string');
    for (const b of merged.buses) {
      const model = BUS_BY_ID[b.modelId];
      b.damage = Math.min(100, Math.max(0, isFiniteNumber(b.damage) ? b.damage : 0));
      b.fuel = Math.min(model.tankCapacity, Math.max(0, isFiniteNumber(b.fuel) ? b.fuel : model.tankCapacity));
      b.upgrades = mergeDefaults({ engine: 0, comfort: 0, handling: 0 }, b.upgrades);
      for (const k of ['engine', 'comfort', 'handling'] as const) b.upgrades[k] = Math.min(3, Math.max(0, Math.floor(b.upgrades[k])));
    }
    if (merged.buses.length === 0) merged.buses.push(createOwnedBus(STARTER_BUS_ID, 0));
    if (!merged.buses.some((b) => b.uid === merged.selectedBusUid)) merged.selectedBusUid = merged.buses[0].uid;
    merged.company.level = Math.max(1, Math.floor(merged.company.level));
    merged.company.reputation = Math.min(100, Math.max(0, merged.company.reputation));
    merged.company.name = String(merged.company.name).slice(0, 24) || 'RoadMaster Tur';
    if (!Array.isArray(merged.company.unlockedCities) || merged.company.unlockedCities.length === 0) {
      merged.company.unlockedCities = ['kuzeyliman', 'yesilvadi'];
    }
    return merged;
  }

  /** Loads the game: primary -> backup -> new game. Never throws. */
  load(): LoadResult {
    let primaryRaw: string | null = null;
    try {
      primaryRaw = this.storage.getItem(SAVE_KEY);
    } catch {
      primaryRaw = null;
    }
    if (primaryRaw === null) {
      return { state: createInitialState(this.now()), source: 'new', corrupted: false, recoveredFromBackup: false };
    }
    const fromEnv = (env: Envelope): GameState => {
      const data = env.v < this.currentVersion ? this.migrate(env.data, env.v) : env.data;
      return this.sanitize(data);
    };
    const primary = this.parse(primaryRaw);
    if (primary) {
      try {
        return { state: fromEnv(primary), source: 'primary', corrupted: false, recoveredFromBackup: false };
      } catch (e) {
        // fall through to backup
        console.error('[Save] migration failed', e);
      }
    }
    // primary unreadable: keep a copy for inspection, then try the backup
    try {
      this.storage.setItem(SAVE_CORRUPT_KEY, primaryRaw);
    } catch {
      /* ignore quota errors */
    }
    let backupRaw: string | null = null;
    try {
      backupRaw = this.storage.getItem(SAVE_BACKUP_KEY);
    } catch {
      backupRaw = null;
    }
    const backup = backupRaw ? this.parse(backupRaw) : null;
    if (backup) {
      try {
        return {
          state: fromEnv(backup),
          source: 'backup',
          corrupted: true,
          recoveredFromBackup: true,
          message: 'save.recoveredBackup',
        };
      } catch (e) {
        console.error('[Save] backup migration failed', e);
      }
    }
    return {
      state: createInitialState(this.now()),
      source: 'new',
      corrupted: true,
      recoveredFromBackup: false,
      message: 'save.corruptNew',
    };
  }

  /** Text export of the save (for manual backups / moving between devices). */
  exportText(state: GameState): string {
    return this.serialize(state);
  }

  importText(text: string): { ok: boolean; state?: GameState; error?: string } {
    const env = this.parse(text.trim());
    if (!env) return { ok: false, error: 'invalid' };
    try {
      const data = env.v < this.currentVersion ? this.migrate(env.data, env.v) : env.data;
      return { ok: true, state: this.sanitize(data) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'migration' };
    }
  }

  hasSave(): boolean {
    try {
      return this.storage.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  wipe(): void {
    for (const k of [SAVE_KEY, SAVE_BACKUP_KEY, SAVE_CORRUPT_KEY]) {
      try {
        this.storage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  }
}
