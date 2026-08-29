# bambu-mcp

An MCP server that lets Claude design parametric 3D models and slice them for a
**Bambu Lab A1 mini**. Claude writes OpenSCAD, renders a preview, *looks at it*,
fixes what is wrong, and produces a ready-to-print 3MF.

It stops at the 3MF. Nothing here talks to the printer over the network — you
open the file in Bambu Studio and press print.

## Why OpenSCAD and not a text-to-3D model

Generative mesh models produce geometry that looks plausible and prints badly:
non-manifold surfaces, no flat base, walls thinner than a nozzle. OpenSCAD is
*code*, which is the thing an LLM is actually good at. "A wall bracket for a
22mm pipe with two M4 holes 44mm apart" becomes exact, watertight geometry, and
every dimension stays a named variable you can change afterwards.

## Tools

| Tool | Purpose |
|---|---|
| `create_model` | Write OpenSCAD source, compile to STL, return mesh stats **and a rendered preview image** |
| `preview_model` | Re-render from another angle (`iso`, `top`, `bottom`, `front`, `back`, `left`, `right`) |
| `inspect_model` | Mesh stats, printability checks, and the `.scad` source, without re-rendering |
| `slice_model` | Slice to a 3MF with the bundled A1 mini profiles; reports print time and filament weight |
| `list_models` | Everything in the workspace, with sizes |
| `list_print_profiles` | Which layer heights and filaments are available |

The preview image is the point. A flat render with axes and scale markers is
what catches a part that is upside down, inside out, or twice the size it should
be — before any filament is spent.

## Checks that run automatically

`create_model` analyses the mesh itself rather than trusting the compile:

- **Watertight test** — counts edges not shared by exactly two triangles. Naked
  edges almost always mean two coincident faces in a `difference()`; the fix is
  to overshoot the cutting solid by `eps` at each open end.
- **Bed fit** — against the A1 mini's 180 x 180 x 180mm volume.
- **Inverted normals** — via signed mesh volume.
- **Stability** — flags tall, narrow parts that want a brim.
- **Thin features** — anything under two 0.4mm extrusion widths.

## Setup

Requires [Bambu Studio](https://bambulab.com/en/download/studio) and OpenSCAD:

```bash
brew install --cask openscad
```

Then clone and install. `npm install` builds the server too, via a `prepare`
script, so there is no separate build step:

```bash
npm install
```

`.mcp.json` registers the server for Claude Code sessions started in this
directory. Approve it when prompted, then ask for a part.

Start Claude Code **from the repository root** -- the server path is written as
`${CLAUDE_PROJECT_DIR:-.}/dist/server.js`. Claude Code sets `CLAUDE_PROJECT_DIR`
in the spawned server's environment rather than its own, so for a project-scoped
`.mcp.json` the `:-.` fallback is what actually resolves, and it resolves against
the working directory.

### Paths and overrides

| Variable | Default |
|---|---|
| `OPENSCAD_BIN` | first of `/opt/homebrew/bin/openscad`, `/usr/local/bin/openscad`, the `.app` bundles |
| `BAMBU_STUDIO_BIN` | `/Applications/BambuStudio.app/Contents/MacOS/BambuStudio` |
| `BAMBU_PROFILE_ROOT` | Bambu Studio's bundled `profiles/BBL` |
| `BAMBU_MCP_WORKSPACE` | `./workspace` |

## How the slicing works

Bambu Studio's CLI has no flags for individual settings like infill or supports.
Its profiles are layered instead — `0.20mm Standard @BBL A1M` inherits from
`fdm_process_single_0.20`, which inherits twice more, ending at a 170-key base.
So `src/profiles.ts` walks that chain, merges it root-first into one standalone
197-key profile, applies your overrides, and hands the CLI a complete file.

Overrides are checked against the flattened profile: anything the profile does
not define is reported as ignored rather than silently dropped.

## Known limitations

- **OpenSCAD 2021.01** is what Homebrew's `openscad` cask installs. The cask is
  deprecated (it fails Gatekeeper) and `openscad@snapshot` conflicts with it, so
  swapping means uninstalling first. The snapshot's Manifold backend is much
  faster on complex models. Point `OPENSCAD_BIN` at it if you switch.
- STL export is forced to `binstl`; 2021.01 defaults to ASCII. The parser reads
  both anyway.
- Slicing a single plate only. No multi-plate or multi-material.

## Example

`workspace/models/pipe-bracket.scad` is a worked example — a wall bracket for a
22mm pipe. It slices to about 17 minutes and 8.2g in PLA.

Its first version was **not** watertight: the collar cylinder was positioned
exactly tangent to the back plate, so the two solids met along a zero-width
line. OpenSCAD warned, the watertight check caught it, and the fix was to sink
the collar 3mm into the plate. That is the loop working.
