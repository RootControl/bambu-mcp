import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Profile = Record<string, unknown>;

/**
 * Bambu's bundled profiles are layered: a printer-specific file inherits from a
 * shared base, which inherits again, up to four levels deep. The CLI resolves
 * that chain only for profiles it already knows about, so to override a single
 * setting we flatten the chain ourselves and hand it a complete, standalone file.
 */
export function flatten(dir: string, name: string, maxDepth = 12): Profile {
  const chain: Profile[] = [];
  let current: string | undefined = name;
  const seen = new Set<string>();

  for (let depth = 0; current && depth < maxDepth; depth++) {
    if (seen.has(current)) throw new Error(`Circular inherits at "${current}"`);
    seen.add(current);
    const path = join(dir, `${current}.json`);
    if (!existsSync(path)) throw new Error(`Profile not found: ${path}`);
    const json = JSON.parse(readFileSync(path, "utf8")) as Profile;
    chain.push(json);
    current = typeof json.inherits === "string" ? json.inherits : undefined;
  }

  // Walk root-first so the most specific file wins.
  const merged: Profile = {};
  for (const layer of chain.reverse()) Object.assign(merged, layer);
  delete merged.inherits;
  return merged;
}

export interface ApplyResult {
  profile: Profile;
  applied: string[];
  /** Keys the base profile does not define - silently passing these to the CLI is how you get a confusing rejection. */
  unknown: string[];
}

export function applyOverrides(base: Profile, overrides: Profile): ApplyResult {
  const profile = { ...base };
  const applied: string[] = [];
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    if (k in base) {
      profile[k] = v;
      applied.push(k);
    } else {
      unknown.push(k);
    }
  }
  return { profile, applied, unknown };
}

/** Bambu stores most numeric settings as strings, and per-extruder ones as arrays. */
export function asProfileValue(base: unknown, value: string | number | boolean): unknown {
  const str = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  return Array.isArray(base) ? [str] : str;
}
