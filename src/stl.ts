import { readFileSync } from "node:fs";

export interface StlStats {
  triangles: number;
  degenerate: number;
  bbox: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  /** Signed volume in mm^3. Negative means the normals are inside-out. */
  volumeMm3: number;
  /** Edges not shared by exactly two triangles - holes in the surface. */
  nakedEdges: number;
  watertight: boolean;
}

type Vec = [number, number, number];

/** Quantise to 0.1um so float noise from OpenSCAD does not split shared vertices. */
function vkey(v: Vec): string {
  return `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)},${Math.round(v[2] * 1e4)}`;
}

function cross(a: Vec, b: Vec): Vec {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Parse a binary STL and report the things that decide whether a mesh is
 * printable: how big it is, whether it is watertight, and which way the
 * normals face. Cheap enough to run on every model before slicing.
 */
/** Pull triangles out of a binary STL: 80-byte header, uint32 count, 50 bytes per facet. */
function* binaryTriangles(buf: Buffer, count: number): Generator<[Vec, Vec, Vec]> {
  for (let i = 0; i < count; i++) {
    const off = 84 + i * 50 + 12; // skip the stored normal, we recompute it
    const tri: Vec[] = [];
    for (let v = 0; v < 3; v++) {
      tri.push([
        buf.readFloatLE(off + v * 12),
        buf.readFloatLE(off + v * 12 + 4),
        buf.readFloatLE(off + v * 12 + 8),
      ]);
    }
    yield tri as [Vec, Vec, Vec];
  }
}

const VERTEX_RE = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;

/** Pull triangles out of an ASCII STL by reading vertices three at a time. */
function* asciiTriangles(text: string): Generator<[Vec, Vec, Vec]> {
  VERTEX_RE.lastIndex = 0;
  let tri: Vec[] = [];
  let m: RegExpExecArray | null;
  while ((m = VERTEX_RE.exec(text)) !== null) {
    tri.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    if (tri.length === 3) {
      yield tri as [Vec, Vec, Vec];
      tri = [];
    }
  }
}

/**
 * Report the things that decide whether a mesh is printable: how big it is,
 * whether it is watertight, and which way the normals face. Handles both binary
 * and ASCII STL, since OpenSCAD's default format varies by version.
 */
export function analyseStl(path: string): StlStats {
  const buf = readFileSync(path);
  if (buf.length < 15) throw new Error(`STL too short to be valid: ${path}`);

  // An ASCII STL opens with "solid"; a binary one may too, so confirm by
  // checking whether the header's triangle count matches the actual file size.
  const looksAscii = buf.subarray(0, 5).toString("ascii") === "solid";
  const headerCount = buf.length >= 84 ? buf.readUInt32LE(80) : -1;
  const isBinary = buf.length === 84 + headerCount * 50;
  if (!isBinary && !looksAscii) throw new Error(`Unrecognised STL format: ${path}`);

  const source = isBinary
    ? binaryTriangles(buf, headerCount)
    : asciiTriangles(buf.toString("utf8"));

  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  const undirected = new Map<string, number>();
  let volume = 0;
  let degenerate = 0;
  let triangles = 0;

  for (const [a, b, c] of source) {
    triangles++;
    for (const p of [a, b, c]) {
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
    }

    const n = cross(
      [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    );
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) degenerate++;

    // Signed volume of the tetrahedron from the origin to this facet.
    volume += dot(a, cross(b, c)) / 6;

    const keys = [vkey(a), vkey(b), vkey(c)];
    for (let e = 0; e < 3; e++) {
      const u = keys[e];
      const w = keys[(e + 1) % 3];
      const edge = u < w ? `${u}|${w}` : `${w}|${u}`;
      undirected.set(edge, (undirected.get(edge) ?? 0) + 1);
    }
  }

  if (triangles === 0) throw new Error(`STL contains no triangles: ${path}`);

  let naked = 0;
  for (const n of undirected.values()) if (n !== 2) naked++;

  return {
    triangles,
    degenerate,
    bbox: { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] },
    volumeMm3: volume,
    nakedEdges: naked,
    watertight: naked === 0,
  };
}
