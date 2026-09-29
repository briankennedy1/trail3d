export const SURFACE_COLORS = { singletrack: '#edaa29', asphalt: '#424647', dirt: '#94613d', unknown: '#93a59b' };
export type RouteSurface = keyof typeof SURFACE_COLORS;
type SurfaceRecord = { coordinatesSha256: string; pointCount: number; ranges: { from: number; to: number; type: RouteSurface }[] };

// A replaced/uploaded track must never inherit classifications from old points.
export async function surfaceTypesForTrack(record: SurfaceRecord | undefined, coordinates: number[][]): Promise<RouteSurface[]> {
  const unknown = Array<RouteSurface>(Math.max(0, coordinates.length - 1)).fill('unknown');
  if (!record || record.pointCount !== coordinates.length || !Array.isArray(record.ranges)) return unknown;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(coordinates)));
  const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== record.coordinatesSha256) return unknown;
  const types = [...unknown]; let next = 0;
  for (const r of record.ranges) {
    if (!r || r.from !== next || !Number.isInteger(r.to) || r.to <= r.from || r.to > types.length || !Object.hasOwn(SURFACE_COLORS, r.type)) return unknown;
    types.fill(r.type, r.from, r.to); next = r.to;
  }
  return next === types.length ? types : unknown;
}
