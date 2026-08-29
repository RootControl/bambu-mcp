import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BAMBU_STUDIO_BIN, PROFILE_ROOT } from "./config.js";
import { applyOverrides, asProfileValue, flatten, type Profile } from "./profiles.js";

export interface SliceResult {
  ok: boolean;
  threemfPath?: string;
  /** Estimated print time in seconds, read back out of the sliced 3MF. */
  printSeconds?: number;
  /** Estimated filament use in grams. */
  weightGrams?: number;
  appliedOverrides: string[];
  ignoredOverrides: string[];
  error?: string;
  logTail: string;
  profiles: { machine: string; process: string; filament: string };
}

const MACHINE_DIR = join(PROFILE_ROOT, "machine");
const PROCESS_DIR = join(PROFILE_ROOT, "process");
const FILAMENT_DIR = join(PROFILE_ROOT, "filament");

/**
 * Settings Bambu accepts but which the bundled A1 mini profiles never spell out.
 * Without this allowlist an override of one of them looks like a typo.
 */
const EXTRA_ALLOWED = new Set(["brim_type"]);

/** A1 mini profiles are tagged A1M; the 0.4mm nozzle variants carry no nozzle suffix. */
function nozzleSuffix(nozzle: number): string {
  return nozzle === 0.4 ? "" : ` ${nozzle} nozzle`;
}

function listMatching(dir: string, nozzle: number): string[] {
  if (!existsSync(dir)) return [];
  const suffix = `@BBL A1M${nozzleSuffix(nozzle)}.json`;
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export const listProcesses = (nozzle = 0.4) => listMatching(PROCESS_DIR, nozzle);
export const listFilaments = (nozzle = 0.4) => listMatching(FILAMENT_DIR, nozzle);

/**
 * Pick a process profile for a layer height. Several qualities exist at the same
 * height (0.20mm Standard vs 0.20mm Strength); prefer the everyday one unless a
 * quality is named.
 */
export function resolveProcess(layerHeight: number, nozzle = 0.4, quality?: string): string | null {
  const atHeight = listProcesses(nozzle).filter((p) => p.startsWith(`${layerHeight.toFixed(2)}mm `));
  if (atHeight.length === 0) return null;
  if (quality) {
    const hit = atHeight.find((p) => p.toLowerCase().includes(quality.toLowerCase()));
    if (hit) return hit;
  }
  for (const pref of ["Standard", "Optimal", "Fine", "High Quality", "Draft"]) {
    const hit = atHeight.find((p) => p.includes(pref));
    if (hit) return hit;
  }
  return atHeight[0];
}

export function resolveFilament(material: string, nozzle = 0.4): string | null {
  const all = listFilaments(nozzle);
  const want = material.toLowerCase().trim();
  return (
    all.find((f) => f.toLowerCase() === want) ??
    all.find((f) => f.toLowerCase() === `bambu ${want} @bbl a1m${nozzleSuffix(nozzle).toLowerCase()}`) ??
    all.find((f) => f.toLowerCase().includes(want)) ??
    null
  );
}

/** Read one entry out of a 3MF (which is just a zip) without pulling in a zip library. */
function read3mfEntry(archive: string, entry: string): string | null {
  try {
    return execFileSync("unzip", ["-p", archive, entry], { encoding: "utf8", maxBuffer: 8 << 20 });
  } catch {
    return null;
  }
}

function readSliceInfo(threemf: string): { printSeconds?: number; weightGrams?: number } {
  const xml = read3mfEntry(threemf, "Metadata/slice_info.config");
  if (!xml) return {};
  const pick = (key: string) => {
    const m = xml.match(new RegExp(`key="${key}"\\s+value="([^"]+)"`));
    return m && Number.isFinite(Number(m[1])) ? Number(m[1]) : undefined;
  };
  return { printSeconds: pick("prediction"), weightGrams: pick("weight") };
}

export interface SliceOptions {
  stlPath: string;
  outDir: string;
  outName: string;
  layerHeight?: number;
  nozzle?: number;
  filament?: string;
  quality?: string;
  infillPercent?: number;
  supports?: boolean;
  brim?: boolean;
  wallLoops?: number;
  timeoutMs?: number;
}

export async function slice(opts: SliceOptions): Promise<SliceResult> {
  const {
    stlPath,
    outDir,
    outName,
    layerHeight = 0.2,
    nozzle = 0.4,
    filament = "PLA Basic",
    quality,
    infillPercent,
    supports,
    brim,
    wallLoops,
    timeoutMs = 300_000,
  } = opts;

  const machineName = `Bambu Lab A1 mini ${nozzle} nozzle`;
  const processName = resolveProcess(layerHeight, nozzle, quality);
  const filamentName = resolveFilament(filament, nozzle);
  const profiles = {
    machine: machineName,
    process: processName ?? "(unresolved)",
    filament: filamentName ?? "(unresolved)",
  };
  const fail = (error: string): SliceResult => ({
    ok: false,
    error,
    logTail: "",
    profiles,
    appliedOverrides: [],
    ignoredOverrides: [],
  });

  if (!BAMBU_STUDIO_BIN) {
    return fail("Bambu Studio not found at /Applications/BambuStudio.app (set BAMBU_STUDIO_BIN).");
  }
  if (!existsSync(join(MACHINE_DIR, `${machineName}.json`))) {
    return fail(`No A1 mini machine profile for a ${nozzle}mm nozzle.`);
  }
  if (!processName) {
    return fail(
      `No ${layerHeight}mm process profile for the A1 mini. Available: ${listProcesses(nozzle).join(", ")}`,
    );
  }
  if (!filamentName) {
    return fail(`Unknown filament "${filament}". Available: ${listFilaments(nozzle).join(", ")}`);
  }

  // Flatten each profile chain into a standalone file so overrides survive.
  let machine: Profile;
  let processBase: Profile;
  let filamentProfile: Profile;
  try {
    machine = flatten(MACHINE_DIR, machineName);
    processBase = flatten(PROCESS_DIR, processName);
    filamentProfile = flatten(FILAMENT_DIR, filamentName);
  } catch (e) {
    return fail(`Could not resolve profile chain: ${(e as Error).message}`);
  }

  const overrides: Profile = {};
  if (infillPercent !== undefined) {
    overrides.sparse_infill_density = asProfileValue(
      processBase.sparse_infill_density,
      `${infillPercent}%`,
    );
  }
  if (supports !== undefined) {
    overrides.enable_support = asProfileValue(processBase.enable_support, supports);
  }
  if (wallLoops !== undefined) {
    overrides.wall_loops = asProfileValue(processBase.wall_loops, wallLoops);
  }
  if (brim !== undefined) {
    overrides.brim_type = brim ? "outer_only" : "no_brim";
  }

  const withExtras: Profile = { ...processBase };
  for (const k of EXTRA_ALLOWED) if (!(k in withExtras) && k in overrides) withExtras[k] = "";
  const { profile: processProfile, applied, unknown } = applyOverrides(withExtras, overrides);

  const tmp = mkdtempSync(join(tmpdir(), "bambu-mcp-"));
  const machinePath = join(tmp, "machine.json");
  const processPath = join(tmp, "process.json");
  const filamentPath = join(tmp, "filament.json");
  writeFileSync(machinePath, JSON.stringify(machine, null, 2));
  writeFileSync(processPath, JSON.stringify(processProfile, null, 2));
  writeFileSync(filamentPath, JSON.stringify(filamentProfile, null, 2));

  const args = [
    "--load-settings",
    `${machinePath};${processPath}`,
    "--load-filaments",
    filamentPath,
    "--arrange",
    "1",
    "--orient",
    "0",
    "--slice",
    "0",
    "--export-3mf",
    outName,
    "--outputdir",
    outDir,
    stlPath,
  ];

  const res = await runStudio(args, outDir, timeoutMs);
  const threemfPath = join(outDir, outName);

  // Bambu Studio drops a result.json describing the slice next to its output.
  let meta: Record<string, unknown> = {};
  const resultJson = join(outDir, "result.json");
  if (existsSync(resultJson)) {
    try {
      meta = JSON.parse(readFileSync(resultJson, "utf8"));
    } catch {
      /* leave meta empty */
    }
  }

  const returnCode = typeof meta.return_code === "number" ? meta.return_code : res.code;
  const ok = returnCode === 0 && existsSync(threemfPath);
  const logTail = (res.stderr || res.stdout).slice(-1500);

  return {
    ok,
    threemfPath: ok ? threemfPath : undefined,
    ...(ok ? readSliceInfo(threemfPath) : {}),
    appliedOverrides: applied,
    ignoredOverrides: unknown,
    error: ok ? undefined : String(meta.error_string ?? logTail ?? "slicing failed"),
    logTail,
    profiles,
  };
}

function runStudio(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const child = spawn(BAMBU_STUDIO_BIN!, args, { cwd, env: { ...process.env, LC_ALL: "C" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      res({ code: null, stdout, stderr: String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr });
    });
  });
}
