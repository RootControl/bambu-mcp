import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Bambu Lab A1 mini build volume, in mm. */
export const BED = { x: 180, y: 180, z: 180 };

/** Keep a margin from the bed edge so the purge line and skirt have room. */
export const BED_MARGIN = 5;

export const WORKSPACE =
  process.env.BAMBU_MCP_WORKSPACE ?? resolve(here, "..", "workspace");
export const MODELS_DIR = resolve(WORKSPACE, "models");
export const OUTPUT_DIR = resolve(WORKSPACE, "output");

/**
 * OpenSCAD ships as a .app on macOS. The Homebrew cask installs a versioned
 * bundle and links a binary into the prefix, but a hand-installed snapshot may
 * sit elsewhere, so probe the usual spots and let the env var win.
 */
function findOpenScad(): string | null {
  const candidates = [
    process.env.OPENSCAD_BIN,
    "/opt/homebrew/bin/openscad",
    "/usr/local/bin/openscad",
    "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD",
    "/Applications/OpenSCAD-2021.01.app/Contents/MacOS/OpenSCAD",
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => existsSync(c)) ?? null;
}

function findBambuStudio(): string | null {
  const candidates = [
    process.env.BAMBU_STUDIO_BIN,
    "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => existsSync(c)) ?? null;
}

export const OPENSCAD_BIN = findOpenScad();
export const BAMBU_STUDIO_BIN = findBambuStudio();

export const PROFILE_ROOT =
  process.env.BAMBU_PROFILE_ROOT ??
  "/Applications/BambuStudio.app/Contents/Resources/profiles/BBL";
