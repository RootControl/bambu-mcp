#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BED, MODELS_DIR, OPENSCAD_BIN, OUTPUT_DIR, BAMBU_STUDIO_BIN } from "./config.js";
import { exportPng, exportStl, VIEW_NAMES } from "./openscad.js";
import { analyseStl, type StlStats } from "./stl.js";
import { listFilaments, listProcesses, slice } from "./slicer.js";

for (const dir of [MODELS_DIR, OUTPUT_DIR]) mkdirSync(dir, { recursive: true });

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const scadPath = (n: string) => join(MODELS_DIR, `${n}.scad`);
const stlPath = (n: string) => join(MODELS_DIR, `${n}.stl`);
const pngPath = (n: string, view: string) => join(MODELS_DIR, `${n}.${view}.png`);

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

function requireModel(name: string): string | null {
  if (!NAME_RE.test(name)) return `Invalid model name "${name}". Use lowercase letters, digits, - and _.`;
  if (!existsSync(scadPath(name))) {
    const have = readdirSync(MODELS_DIR).filter((f) => f.endsWith(".scad")).map((f) => f.slice(0, -5));
    return `No model named "${name}". Existing models: ${have.length ? have.join(", ") : "(none yet)"}`;
  }
  return null;
}

const mm = (n: number) => `${n.toFixed(2)}mm`;

function describeMesh(s: StlStats): string {
  const [x, y, z] = s.bbox.size;
  const lines = [
    `Size: ${mm(x)} x ${mm(y)} x ${mm(z)} (W x D x H)`,
    `Volume: ${(s.volumeMm3 / 1000).toFixed(2)} cm3   Triangles: ${s.triangles}`,
    `Watertight: ${s.watertight ? "yes" : `NO - ${s.nakedEdges} naked edge(s)`}`,
  ];
  if (s.degenerate > 0) lines.push(`Degenerate facets: ${s.degenerate}`);
  if (s.volumeMm3 < 0) lines.push("WARNING: negative volume - the normals are inverted.");
  return lines.join("\n");
}

/** Fit and stability checks that are cheaper to answer here than by slicing. */
function printabilityNotes(s: StlStats): string[] {
  const notes: string[] = [];
  const [x, y, z] = s.bbox.size;
  const over: string[] = [];
  if (x > BED.x) over.push(`width ${mm(x)} > ${BED.x}mm`);
  if (y > BED.y) over.push(`depth ${mm(y)} > ${BED.y}mm`);
  if (z > BED.z) over.push(`height ${mm(z)} > ${BED.z}mm`);
  if (over.length) notes.push(`DOES NOT FIT the A1 mini bed: ${over.join(", ")}. Scale it down or split it.`);

  if (!s.watertight) {
    notes.push(
      `Mesh is not watertight (${s.nakedEdges} naked edges). This usually means coincident faces in a ` +
        `difference() or union() - nudge the cutting solid past the surface by 0.01mm on each open end.`,
    );
  }
  if (Math.min(x, y, z) < 0.8) {
    notes.push(`Thinnest overall dimension is ${mm(Math.min(x, y, z))}, below two 0.4mm extrusion widths.`);
  }
  const footprint = Math.min(x, y);
  if (footprint > 0 && z / footprint > 4) {
    notes.push(`Tall and narrow (height ${mm(z)} vs ${mm(footprint)} footprint) - slice with brim=true.`);
  }
  if (Math.abs(s.bbox.min[2]) > 0.01) {
    notes.push(
      `Model sits at z=${mm(s.bbox.min[2])} rather than on z=0. The slicer will drop it to the bed, ` +
        `but check that the intended face is downward.`,
    );
  }
  return notes;
}

const server = new McpServer({ name: "bambu-mcp", version: "0.1.0" });

server.registerTool(
  "create_model",
  {
    title: "Create or update a 3D model",
    description:
      "Write OpenSCAD source for a model, compile it to STL, and return a rendered preview image plus " +
      "mesh statistics. Always LOOK at the returned image before moving on - it is the only way to catch " +
      "a part that is upside down, inside out, or the wrong proportions. Re-calling with the same name " +
      "overwrites the model, so use this to iterate. Design in millimetres with the part resting on z=0.",
    inputSchema: {
      name: z.string().describe("Model id: lowercase letters, digits, - and _ (e.g. 'pipe-bracket')."),
      scad_code: z.string().describe("Complete OpenSCAD source. Put tunable values in named variables at the top."),
      notes: z.string().optional().describe("What this part is for, saved as a header comment."),
      view: z.enum(VIEW_NAMES as [string, ...string[]]).optional().describe("Preview angle (default iso)."),
    },
  },
  async ({ name, scad_code, notes, view }) => {
    if (!NAME_RE.test(name)) return textResult(`Invalid model name "${name}".`, true);
    if (!OPENSCAD_BIN) return textResult("OpenSCAD is not installed. Run: brew install --cask openscad", true);

    const header = notes ? `// ${name}: ${notes}\n// Generated for Bambu Lab A1 mini (180x180x180mm)\n\n` : "";
    writeFileSync(scadPath(name), header + scad_code, "utf8");

    const build = await exportStl(scadPath(name), stlPath(name));
    if (!build.ok || !existsSync(stlPath(name))) {
      return textResult(
        `OpenSCAD failed to compile "${name}":\n\n${build.errors.join("\n") || build.stderr.slice(-1200)}`,
        true,
      );
    }

    let stats: StlStats;
    try {
      stats = analyseStl(stlPath(name));
    } catch (e) {
      return textResult(`Compiled, but the STL could not be analysed: ${(e as Error).message}`, true);
    }

    const chosenView = view ?? "iso";
    const png = await exportPng(scadPath(name), pngPath(name, chosenView), { view: chosenView });

    const notesOut = printabilityNotes(stats);
    const text = [
      `Model "${name}" compiled in ${build.seconds.toFixed(1)}s.`,
      "",
      describeMesh(stats),
      build.warnings.length ? `\nOpenSCAD warnings:\n${build.warnings.slice(0, 5).join("\n")}` : "",
      notesOut.length ? `\nPrintability:\n- ${notesOut.join("\n- ")}` : "\nPrintability: no issues found.",
      `\nSTL: ${stlPath(name)}`,
    ]
      .filter(Boolean)
      .join("\n");

    const content: Array<
      { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
    > = [{ type: "text", text }];
    if (png.ok && existsSync(pngPath(name, chosenView))) {
      content.push({
        type: "image",
        data: readFileSync(pngPath(name, chosenView)).toString("base64"),
        mimeType: "image/png",
      });
    }
    return { content };
  },
);

server.registerTool(
  "preview_model",
  {
    title: "Render a model from another angle",
    description:
      "Render an existing model from a named viewpoint and return the image. Use this to check a face you " +
      "cannot see in the default isometric view - especially 'bottom' to confirm the part has a flat base.",
    inputSchema: {
      name: z.string(),
      view: z.enum(VIEW_NAMES as [string, ...string[]]).describe(VIEW_NAMES.join(" | ")),
      show_axes: z.boolean().optional().describe("Draw axes and scale markers (default true)."),
    },
  },
  async ({ name, view, show_axes }) => {
    const bad = requireModel(name);
    if (bad) return textResult(bad, true);

    const out = pngPath(name, view);
    const png = await exportPng(scadPath(name), out, { view, showAxes: show_axes ?? true });
    if (!png.ok || !existsSync(out)) {
      return textResult(`Render failed:\n${png.errors.join("\n") || png.stderr.slice(-800)}`, true);
    }
    return {
      content: [
        { type: "text" as const, text: `"${name}" viewed from ${view}.` },
        {
          type: "image" as const,
          data: readFileSync(out).toString("base64"),
          mimeType: "image/png",
        },
      ],
    };
  },
);

server.registerTool(
  "inspect_model",
  {
    title: "Inspect model geometry and source",
    description:
      "Return the mesh statistics, printability checks, and the OpenSCAD source of a model without " +
      "re-rendering. Read the source before editing a model you did not create in this session.",
    inputSchema: {
      name: z.string(),
      include_source: z.boolean().optional().describe("Include the full .scad source (default true)."),
    },
  },
  async ({ name, include_source }) => {
    const bad = requireModel(name);
    if (bad) return textResult(bad, true);
    if (!existsSync(stlPath(name))) return textResult(`"${name}" has no compiled STL yet; run create_model.`, true);

    const stats = analyseStl(stlPath(name));
    const notes = printabilityNotes(stats);
    const parts = [
      `Model "${name}"`,
      "",
      describeMesh(stats),
      notes.length ? `\nPrintability:\n- ${notes.join("\n- ")}` : "\nPrintability: no issues found.",
    ];
    if (include_source !== false) {
      parts.push(`\n--- ${name}.scad ---\n${readFileSync(scadPath(name), "utf8")}`);
    }
    return textResult(parts.join("\n"));
  },
);

server.registerTool(
  "slice_model",
  {
    title: "Slice a model for the A1 mini",
    description:
      "Slice a compiled model into a printable 3MF using the bundled Bambu Lab A1 mini profiles, and " +
      "report the estimated print time and filament weight. The 3MF is written to the output folder; " +
      "open it in Bambu Studio and press print. This does not touch the printer.",
    inputSchema: {
      name: z.string(),
      layer_height: z.number().optional().describe("mm; 0.08-0.28. Default 0.2."),
      filament: z.string().optional().describe("e.g. 'PLA Basic', 'PLA Matte', 'PETG HF'. Default PLA Basic."),
      quality: z.string().optional().describe("Disambiguates profiles at the same height, e.g. 'Strength'."),
      infill_percent: z.number().min(0).max(100).optional().describe("Default is the profile's 15%."),
      supports: z.boolean().optional(),
      brim: z.boolean().optional().describe("Recommended for tall or narrow parts."),
      wall_loops: z.number().int().min(1).max(10).optional(),
      nozzle: z.number().optional().describe("0.2, 0.4, 0.6 or 0.8. Default 0.4."),
    },
  },
  async (a) => {
    const bad = requireModel(a.name);
    if (bad) return textResult(bad, true);
    if (!BAMBU_STUDIO_BIN) return textResult("Bambu Studio is not installed at /Applications/BambuStudio.app.", true);
    if (!existsSync(stlPath(a.name))) return textResult(`"${a.name}" has no compiled STL; run create_model.`, true);

    const stats = analyseStl(stlPath(a.name));
    const [x, y, z] = stats.bbox.size;
    if (x > BED.x || y > BED.y || z > BED.z) {
      return textResult(
        `"${a.name}" is ${mm(x)} x ${mm(y)} x ${mm(z)} and will not fit the ${BED.x}x${BED.y}x${BED.z}mm bed.`,
        true,
      );
    }

    const res = await slice({
      stlPath: stlPath(a.name),
      outDir: OUTPUT_DIR,
      outName: `${a.name}.3mf`,
      layerHeight: a.layer_height,
      nozzle: a.nozzle,
      filament: a.filament,
      quality: a.quality,
      infillPercent: a.infill_percent,
      supports: a.supports,
      brim: a.brim,
      wallLoops: a.wall_loops,
    });

    if (!res.ok) {
      return textResult(
        `Slicing "${a.name}" failed.\nProfiles: ${res.profiles.process} / ${res.profiles.filament}\n\n${res.error}`,
        true,
      );
    }

    const hh = res.printSeconds ? Math.floor(res.printSeconds / 3600) : 0;
    const mmn = res.printSeconds ? Math.round((res.printSeconds % 3600) / 60) : 0;
    const lines = [
      `Sliced "${a.name}" successfully.`,
      "",
      `Print time: ${res.printSeconds ? `${hh}h ${mmn}m` : "unknown"}`,
      `Filament:   ${res.weightGrams !== undefined ? `${res.weightGrams.toFixed(1)} g` : "unknown"}`,
      `Machine:    ${res.profiles.machine}`,
      `Process:    ${res.profiles.process}`,
      `Filament:   ${res.profiles.filament}`,
      res.appliedOverrides.length ? `Overrides:  ${res.appliedOverrides.join(", ")}` : "",
      res.ignoredOverrides.length ? `IGNORED (not in profile): ${res.ignoredOverrides.join(", ")}` : "",
      "",
      `File: ${res.threemfPath}`,
      "Open it in Bambu Studio to send it to the printer.",
    ].filter(Boolean);
    return textResult(lines.join("\n"));
  },
);

server.registerTool(
  "list_models",
  {
    title: "List models in the workspace",
    description: "List every model in the workspace with its size and whether it has been sliced.",
    inputSchema: {},
  },
  async () => {
    const names = readdirSync(MODELS_DIR).filter((f) => f.endsWith(".scad")).map((f) => f.slice(0, -5)).sort();
    if (!names.length) return textResult("No models yet. Use create_model to make one.");
    const rows = names.map((n) => {
      let size = "not compiled";
      if (existsSync(stlPath(n))) {
        try {
          const [x, y, z] = analyseStl(stlPath(n)).bbox.size;
          size = `${mm(x)} x ${mm(y)} x ${mm(z)}`;
        } catch {
          size = "unreadable STL";
        }
      }
      const sliced = existsSync(join(OUTPUT_DIR, `${n}.3mf`)) ? "sliced" : "-";
      return `  ${n.padEnd(24)} ${size.padEnd(30)} ${sliced}`;
    });
    return textResult(`Models in ${MODELS_DIR}:\n\n${rows.join("\n")}`);
  },
);

server.registerTool(
  "list_print_profiles",
  {
    title: "List available A1 mini profiles",
    description: "List the process (layer height/quality) and filament profiles available for the A1 mini.",
    inputSchema: { nozzle: z.number().optional().describe("0.2, 0.4, 0.6 or 0.8. Default 0.4.") },
  },
  async ({ nozzle }) => {
    const n = nozzle ?? 0.4;
    const p = listProcesses(n);
    const f = listFilaments(n);
    if (!p.length && !f.length) return textResult(`No bundled profiles found for a ${n}mm nozzle.`, true);
    return textResult(
      `A1 mini profiles for a ${n}mm nozzle\n\nProcess (${p.length}):\n  ${p.join("\n  ")}\n\nFilament (${f.length}):\n  ${f.join("\n  ")}`,
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
