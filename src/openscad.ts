import { spawn } from "node:child_process";
import { OPENSCAD_BIN } from "./config.js";

export interface ScadRun {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** ERROR:/WARNING: lines pulled out of stderr, which is where OpenSCAD reports them. */
  errors: string[];
  warnings: string[];
  seconds: number;
}

/** Gimbal angles (rot_x, rot_z) that OpenSCAD's --camera flag expects. */
const VIEWS: Record<string, [number, number]> = {
  iso: [55, 25],
  front: [90, 0],
  back: [90, 180],
  left: [90, 270],
  right: [90, 90],
  top: [0, 0],
  bottom: [180, 0],
};

export type ViewName = keyof typeof VIEWS;
export const VIEW_NAMES = Object.keys(VIEWS);

function run(args: string[], timeoutMs: number): Promise<ScadRun> {
  if (!OPENSCAD_BIN) {
    return Promise.resolve({
      ok: false,
      code: null,
      stdout: "",
      stderr:
        "OpenSCAD not found. Install it with: brew install --cask openscad " +
        "(or set OPENSCAD_BIN to the binary path).",
      errors: ["OpenSCAD binary not found"],
      warnings: [],
      seconds: 0,
    });
  }

  // Capture into a local so the null check above narrows inside the callback.
  const bin = OPENSCAD_BIN;
  const started = Date.now();
  return new Promise((res) => {
    const child = spawn(bin, args, {
      // OpenSCAD needs a writable HOME for its config; inherit the environment
      // but force a headless-friendly locale so number parsing stays predictable.
      env: { ...process.env, LC_ALL: "C" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      clearTimeout(timer);
      res({
        ok: false,
        code: null,
        stdout,
        stderr: String(err),
        errors: [String(err)],
        warnings: [],
        seconds: (Date.now() - started) / 1000,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const lines = stderr.split("\n");
      const errors = lines.filter((l) => /^\s*ERROR:/i.test(l));
      const warnings = lines.filter((l) => /^\s*WARNING:/i.test(l));
      if (timedOut) errors.push(`Timed out after ${timeoutMs / 1000}s`);
      res({
        ok: !timedOut && code === 0 && errors.length === 0,
        code,
        stdout,
        stderr,
        errors,
        warnings,
        seconds: (Date.now() - started) / 1000,
      });
    });
  });
}

function defineArgs(params: Record<string, string | number | boolean>): string[] {
  return Object.entries(params).flatMap(([k, v]) => {
    const val =
      typeof v === "string" ? JSON.stringify(v) : typeof v === "boolean" ? String(v) : String(v);
    return ["-D", `${k}=${val}`];
  });
}

/** Compile a .scad file to a binary STL. */
export function exportStl(
  scadPath: string,
  stlPath: string,
  params: Record<string, string | number | boolean> = {},
  timeoutMs = 180_000,
): Promise<ScadRun> {
  // 2021.01 defaults to ASCII STL, which is ~5x larger and slower to parse.
  return run(
    ["--export-format", "binstl", "-o", stlPath, ...defineArgs(params), scadPath],
    timeoutMs,
  );
}

/**
 * Render a PNG preview. Axes and scale markers are on by default: they are what
 * make a flat image useful for judging whether the geometry is the right size
 * and the right way up.
 */
export function exportPng(
  scadPath: string,
  pngPath: string,
  opts: {
    view?: string;
    width?: number;
    height?: number;
    colorScheme?: string;
    showAxes?: boolean;
    params?: Record<string, string | number | boolean>;
    timeoutMs?: number;
  } = {},
): Promise<ScadRun> {
  const {
    view = "iso",
    width = 900,
    height = 700,
    colorScheme = "Tomorrow",
    showAxes = true,
    params = {},
    timeoutMs = 180_000,
  } = opts;

  const [rotX, rotZ] = VIEWS[view] ?? VIEWS.iso;
  const args = [
    "-o",
    pngPath,
    "--imgsize",
    `${width},${height}`,
    "--colorscheme",
    colorScheme,
    // Target 0,0,0 with distance 0, then let --viewall/--autocenter frame it.
    "--camera",
    `0,0,0,${rotX},0,${rotZ},0`,
    "--viewall",
    "--autocenter",
    "--projection",
    "o",
  ];
  if (showAxes) args.push("--view", "axes,scales");
  args.push(...defineArgs(params), scadPath);

  return run(args, timeoutMs);
}
