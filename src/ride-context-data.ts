import type { MapData, XY } from './data';

export type ContextFeature = {
  name: string; kind: 'road' | 'waterway'; importance: number;
  length: number; lines: XY[][]; showLabel?: boolean;
  /** Optional fixed label location as [longitude, latitude]. */
  labelCoordinates?: XY;
};
type Source = { features: { properties: { name: string; kind: 'road' | 'waterway'; class: string };
  geometry: { type: string; coordinates: XY[] } }[] };

// Clip segments, rather than dropping outside vertices: a road crossing the
// whole cutout may have both endpoints outside it.
export function clipContextSegment(a: XY, b: XY, width: number, height: number): [XY, XY] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let low = 0, high = 1;
  for (const [p, q] of [[-dx, a[0]], [dx, width - a[0]], [-dy, a[1]], [dy, height - a[1]]]) {
    if (p === 0) { if (q < 0) return null; }
    else if (p < 0) low = Math.max(low, q / p);
    else high = Math.min(high, q / p);
    if (low > high) return null;
  }
  return [[a[0] + low * dx, a[1] + low * dy], [a[0] + high * dx, a[1] + high * dy]];
}

export function rideContextForMap(source: Source, map: MapData): ContextFeature[] {
  const groups = new Map<string, ContextFeature>();
  const project = ([lon, lat]: XY): XY => [
    (lon - map.bbox.west) / (map.bbox.east - map.bbox.west) * map.widthM,
    (lat - map.bbox.south) / (map.bbox.north - map.bbox.south) * map.heightM,
  ];
  for (const feature of source.features) {
    const p = feature.properties;
    if (feature.geometry.type !== 'LineString' || !p.name) continue;
    if (p.kind === 'road' && /^(?:Forest (?:Road|Route) )?\d+[A-Z]\d+[A-Z\d.]*$/i.test(p.name)) continue;
    const importance = p.kind === 'waterway' ? (p.class === 'river' ? 3 : 1)
      : ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(p.class) ? 3 : p.class === 'track' ? 0 : 1;
    const key = `${p.kind}:${p.name}`;
    const group = groups.get(key) ?? { name: p.name, kind: p.kind, importance, length: 0, lines: [] };
    group.importance = Math.max(group.importance, importance);
    const points = feature.geometry.coordinates.map(project);
    let line: XY[] = [];
    const flush = () => { if (line.length > 1) group.lines.push(line); line = []; };
    for (let i = 1; i < points.length; i++) {
      const segment = clipContextSegment(points[i - 1], points[i], map.widthM, map.heightM);
      if (!segment) { flush(); continue; }
      const [a, b] = segment;
      if (line.length && Math.hypot(line.at(-1)![0] - a[0], line.at(-1)![1] - a[1]) > 0.01) flush();
      if (!line.length) line.push(a);
      line.push(b); group.length += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    flush(); groups.set(key, group);
  }
  return [...groups.values()].filter(f => f.length >= (f.importance === 3 ? 250 : f.importance === 0 ? 1800 : 900))
    .sort((a, b) => b.importance - a.importance || b.length - a.length)
    .filter((f, i, all) => all.slice(0, i).filter(other => other.kind === f.kind).length < 12);
}
