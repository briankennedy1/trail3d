// Finds shared overview paths in horizontal world coordinates (one unit = 1 km).
// Each visible run keeps the terrain heights and shape of one original route.
const EDGE_KM = 0.0125;
const CELL_KM = 0.05;
const MIN_HEADING_DOT = Math.cos(20 * Math.PI / 180);

function horizontalDistanceToSegment(px, pz, edge) {
  const dx = edge.x2 - edge.x1, dz = edge.z2 - edge.z1;
  const t = Math.max(0, Math.min(1, ((px - edge.x1) * dx + (pz - edge.z1) * dz) / (edge.length ** 2)));
  return Math.hypot(px - edge.x1 - t * dx, pz - edge.z1 - t * dz);
}

function projectedOverlap(a, b) {
  const start = (b.x1 - a.x1) * a.ux + (b.z1 - a.z1) * a.uz;
  const end = (b.x2 - a.x1) * a.ux + (b.z2 - a.z1) * a.uz;
  return Math.max(0, Math.min(a.length, Math.max(start, end)) - Math.max(0, Math.min(start, end)));
}

function matchingEdges(a, b, toleranceKm) {
  if (Math.abs(a.ux * b.ux + a.uz * b.uz) < MIN_HEADING_DOT) return false;
  if (projectedOverlap(a, b) < Math.min(a.length, b.length) * 0.25) return false;
  return horizontalDistanceToSegment(a.mx, a.mz, b) <= toleranceKm &&
    horizontalDistanceToSegment(b.mx, b.mz, a) <= toleranceKm;
}

function reversePositions(positions) {
  const reverse = [];
  for (let i = positions.length - 3; i >= 0; i -= 3) reverse.push(positions[i], positions[i + 1], positions[i + 2]);
  return reverse;
}

function canonicalRouteIsReversed(positions) {
  for (let i = 0, j = positions.length - 3; i < positions.length; i += 3, j -= 3) {
    const order = compareTriplet(positions, positions, i, j);
    if (order) return order > 0;
  }
  return false;
}

/** Return a copy of the complete route in the same stable direction as its runs. */
export function canonicalRoutePositions(positions) {
  return canonicalRouteIsReversed(positions) ? reversePositions(positions) : Array.from(positions);
}

function makeEdges(routes) {
  const edges = [];
  const routeInfo = new Map();
  for (const route of routes) {
    const positions = route.positions;
    if (!positions || positions.length < 6 || positions.length % 3) continue;
    let order = 0, phaseKm = 0;
    for (let i = 0; i + 5 < positions.length; i += 3) {
      const x1 = positions[i], y1 = positions[i + 1], z1 = positions[i + 2];
      const x2 = positions[i + 3], y2 = positions[i + 4], z2 = positions[i + 5];
      if (![x1, y1, z1, x2, y2, z2].every(Number.isFinite)) continue;
      const distance = Math.hypot(x2 - x1, z2 - z1);
      if (distance < 0.000001) continue;
      // A longer tangent resists phone GPS jitter while retaining curved geometry.
      const before = Math.max(0, i - 3), after = Math.min(positions.length - 3, i + 6);
      const tx = positions[after] - positions[before], tz = positions[after + 2] - positions[before + 2];
      const tangentLength = Math.hypot(tx, tz);
      const ux = tangentLength > 0.000001 ? tx / tangentLength : (x2 - x1) / distance;
      const uz = tangentLength > 0.000001 ? tz / tangentLength : (z2 - z1) / distance;
      const pieces = Math.ceil(distance / EDGE_KM);
      for (let piece = 0; piece < pieces; piece++) {
        const t1 = piece / pieces, t2 = (piece + 1) / pieces;
        const xa = x1 + (x2 - x1) * t1, ya = y1 + (y2 - y1) * t1, za = z1 + (z2 - z1) * t1;
        const xb = x1 + (x2 - x1) * t2, yb = y1 + (y2 - y1) * t2, zb = z1 + (z2 - z1) * t2;
        edges.push({id:route.id,order:order++,x1:xa,y1:ya,z1:za,x2:xb,y2:yb,z2:zb,
          mx:(xa + xb)/2,mz:(za + zb)/2,length:Math.hypot(xb-xa,zb-za),ux,uz,
          phaseKm,ids:new Set([route.id]),matches:[],visible:false});
        phaseKm += edges.at(-1).length;
      }
    }
    routeInfo.set(route.id,{lengthKm:phaseKm,reversed:canonicalRouteIsReversed(positions)});
  }
  return {edges,routeInfo};
}

function cellsFor(edge, toleranceKm) {
  const minX = Math.floor((Math.min(edge.x1, edge.x2) - toleranceKm) / CELL_KM);
  const maxX = Math.floor((Math.max(edge.x1, edge.x2) + toleranceKm) / CELL_KM);
  const minZ = Math.floor((Math.min(edge.z1, edge.z2) - toleranceKm) / CELL_KM);
  const maxZ = Math.floor((Math.max(edge.z1, edge.z2) + toleranceKm) / CELL_KM);
  const cells = [];
  for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) cells.push(`${x},${z}`);
  return cells;
}

function compareTriplet(a, b, indexA, indexB) {
  // x/z determine visible direction; y breaks ties on vertical overlap.
  return a[indexA] - b[indexB] || a[indexA + 2] - b[indexB + 2] || a[indexA + 1] - b[indexB + 1];
}

function compareRuns(a, b) {
  const ids = a.ids.join('\0').localeCompare(b.ids.join('\0'));
  if (ids) return ids;
  const count = Math.min(a.positions.length, b.positions.length);
  for (let i = 0; i < count; i += 3) {
    const order = compareTriplet(a.positions, b.positions, i, i);
    if (order) return order;
  }
  return a.positions.length - b.positions.length || a.sourceId.localeCompare(b.sourceId);
}

function smoothShortGaps(edges) {
  let start = 0;
  while (start < edges.length) {
    let end = start + 1;
    while (end < edges.length && edges[end].id === edges[start].id) end++;
    const routeEdges = edges.slice(start, end);
    const others = new Set(routeEdges.flatMap(edge => [...edge.ids].filter(id => id !== edge.id)));
    for (const id of others) {
      let index = 0;
      while (index < routeEdges.length) {
        if (routeEdges[index].ids.has(id)) {index++;continue;}
        const gapStart = index;
        let gapLength = 0;
        while (index < routeEdges.length && !routeEdges[index].ids.has(id)) gapLength += routeEdges[index++].length;
        if (gapStart === 0 || index === routeEdges.length || gapLength > 0.025) continue;
        const before = routeEdges[gapStart - 1], after = routeEdges[index];
        if (before.ux * after.ux + before.uz * after.uz < Math.cos(35 * Math.PI / 180)) continue;
        for (let fill = gapStart; fill < index; fill++) routeEdges[fill].ids.add(id);
      }
    }
    start = end;
  }
}

/**
 * @param {{id:string, positions:ArrayLike<number>}[]} routes Densified overview XYZ paths.
 * @param {{toleranceKm?:number}} options Horizontal matching tolerance; default 15 m.
 * @returns {{ids:string[], positions:number[], sourceId:string, phaseKm:number}[]}
 * Single- and multi-route runs. phaseKm is distance along the entire source
 * route from its canonical start, including unique sections before this run.
 */
export function buildOverviewRouteNetwork(routes, {toleranceKm = 0.015} = {}) {
  if (!Number.isFinite(toleranceKm) || toleranceKm <= 0 || toleranceKm > 0.018)
    throw new RangeError('The overview overlap tolerance must be between 0 and 18 m.');
  const sorted = [...routes].sort((a,b) => String(a.id).localeCompare(String(b.id)));
  if (new Set(sorted.map(route => route.id)).size !== sorted.length)
    throw new Error('Overview route IDs must be unique.');
  const {edges,routeInfo} = makeEdges(sorted);
  const grid = new Map();
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    for (const key of cellsFor(edge, toleranceKm)) {
      const bucket = grid.get(key) || [];
      bucket.push(index);grid.set(key, bucket);
    }
  }
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    const candidates = grid.get(`${Math.floor(edge.mx / CELL_KM)},${Math.floor(edge.mz / CELL_KM)}`) || [];
    for (const candidateIndex of candidates) {
      if (candidateIndex <= index) continue;
      const other = edges[candidateIndex];
      if (edge.id === other.id && Math.abs(edge.order - other.order) <= 2) continue;
      // A ride can have close parallel switchbacks. Only collapse its own
      // nearly exact retracing; GPS tolerance is for comparing separate rides.
      if (!matchingEdges(edge, other, edge.id === other.id ? Math.min(toleranceKm,0.002) : toleranceKm)) continue;
      edge.ids.add(other.id);other.ids.add(edge.id);
      edge.matches.push(candidateIndex);other.matches.push(index);
    }
  }
  // A hidden route cannot hide another route. A and C remain separately drawn
  // when each matches B but they are farther apart than the tolerance.
  for (let index = 0; index < edges.length; index++) {
    edges[index].visible = !edges[index].matches.some(otherIndex =>
      otherIndex < index && edges[otherIndex].visible);
  }
  smoothShortGaps(edges);
  const runs = [];
  let current = null, previous = null;
  for (const edge of edges) {
    const ids = [...edge.ids].sort();
    const visible = edge.visible;
    const contiguous = previous?.id === edge.id && previous?.order + 1 === edge.order &&
      Math.hypot(previous.x2 - edge.x1, previous.z2 - edge.z1) < 0.000001;
    if (!visible) {current = null;previous = null;continue;}
    if (!current || !contiguous || current.ids.length !== ids.length || current.ids.some((id,i) => id !== ids[i])) {
      current = {ids,sourceId:edge.id,phaseKm:edge.phaseKm,endKm:edge.phaseKm,positions:[edge.x1,edge.y1,edge.z1]};runs.push(current);
    }
    current.positions.push(edge.x2,edge.y2,edge.z2);
    current.endKm = edge.phaseKm + edge.length;
    previous = edge;
  }
  // Keep phase continuous across membership breaks and even unique sections.
  // Sub-millimeter rounding removes opposite-direction interpolation noise.
  for (const run of runs) {
    const info = routeInfo.get(run.sourceId);
    if (info.reversed) {
      run.positions = reversePositions(run.positions);
      run.phaseKm = info.lengthKm - run.endKm;
    }
    run.phaseKm = Math.round(run.phaseKm * 1e9) / 1e9;
    run.positions = run.positions.map(value => Math.round(value * 1e9) / 1e9);
    delete run.endKm;
  }
  return runs.sort(compareRuns);
}
