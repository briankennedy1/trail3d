import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { Boat } from './boat';
import { Rider } from './rider';
import { MapData, Terrain, Trail, toWorld } from './data';
import type { View } from './main';
import type { Landscape } from './terrain';
import type { TrailLayer } from './trails';

// Film mode (?film): exposes window.__film so scripts/film.mjs can pose the camera, the boat,
// and trail highlights, then draw one exact frame at a time. Everything crossing that
// boundary is plain JSON.

type Padding = { left: number; right: number; top: number; bottom: number };

interface FilmContext {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  map: MapData;
  terrain: Terrain;
  trails: Trail[];
  trailLayer: TrailLayer;
  landscape: Landscape;
  placeCamera: (azimuth: number, polar: number, target: THREE.Vector3) => void;
  homeView: () => View;
  trailView: (id: number, pad: Padding, azimuth?: number) => View;
  fitView: (points: THREE.Vector3[], pad: Padding, azimuth?: number) => View;
  render: () => void;
  pixelsPerUnit: () => number;
}

/** A camera view as JSON */
export interface ViewJSON {
  target: [number, number, number];
  zoom: number;
  azimuth: number;
  polar: number;
}

export interface FrameState {
  view: ViewJSON;
  /** 0–1 along the route; omit to hide the boat */
  boat?: { u: number; sizePx: number; wake?: number };
  /** a trail to highlight, drawn on progressively */
  trail?: { name: string; reveal: number; reverse?: boolean };
  /** the route from setRoute: drawn on up to `reveal` (0–1) with a rider at its head;
   * `preview` (0–1) fades in a faint dashed line along the whole thing */
  route?: { reveal: number; riderPx?: number; preview?: number };
  /** 0–1: fade the landscape and other trails to spotlight the highlighted trail */
  focus?: number;
  caption?: { title: string; subtitle?: string; opacity: number };
  /** seconds, for small loops like the boat's bob */
  time: number;
}

const toJSON = (v: View): ViewJSON => ({ target: v.target.toArray(), zoom: v.zoom, azimuth: v.azimuth, polar: v.polar });

type LonLat = [number, number];
/** One leg of a route: part of a named trail or road, between the points nearest `from` and `to` */
interface RoutePart {
  /** the trail or road to follow; omit for a straight connector to `to` */
  name?: string;
  /** where to join the trail; defaults to wherever the previous leg ended */
  from?: LonLat;
  to: LonLat;
}

type XYE = [number, number, number]; // local meters + elevation

const JUNCTION = 40; // m: pieces of the same trail this close together connect
const GAP = 15; // m: a bigger jump between legs gets a straight connector

/** Shortest path along a trail's lines (which may be several pieces) between the vertices
 * nearest two points. Pieces connect wherever one's end comes within JUNCTION of another. */
function pathAlong(lines: number[][], from: [number, number], to: [number, number]): XYE[] {
  const nodes: XYE[] = [];
  const edges: [number, number][][] = [];
  const link = (a: number, b: number) => {
    const w = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]);
    edges[a].push([b, w]);
    edges[b].push([a, w]);
  };
  const ranges: [number, number][] = [];
  for (const line of lines) {
    const base = nodes.length;
    for (let k = 0; k < line.length; k += 3) {
      nodes.push([line[k], line[k + 1], line[k + 2]]);
      edges.push([]);
      if (k) link(nodes.length - 2, nodes.length - 1);
    }
    ranges.push([base, nodes.length - 1]);
  }
  ranges.forEach(([a0, a1], ai) => {
    for (const end of [a0, a1]) {
      ranges.forEach(([b0, b1], bi) => {
        if (ai === bi) return;
        let best = -1;
        let bd = JUNCTION;
        for (let n = b0; n <= b1; n++) {
          const d = Math.hypot(nodes[n][0] - nodes[end][0], nodes[n][1] - nodes[end][1]);
          if (d < bd) [bd, best] = [d, n];
        }
        if (best >= 0) link(end, best);
      });
    }
  });
  const nearest = ([x, y]: [number, number]) => {
    let best = 0;
    let bd = Infinity;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n[0] - x, n[1] - y);
      if (d < bd) [bd, best] = [d, i];
    });
    return best;
  };
  const start = nearest(from);
  const goal = nearest(to);
  // Dijkstra with a small binary heap
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  const heap: [number, number][] = [[0, start]];
  dist[start] = 0;
  const push = (item: [number, number]) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, n] = pop();
    if (n === goal) break;
    if (d > dist[n]) continue;
    for (const [m, w] of edges[n]) {
      if (d + w < dist[m]) {
        dist[m] = d + w;
        prev[m] = n;
        push([d + w, m]);
      }
    }
  }
  const path: XYE[] = [];
  for (let n = goal; n !== -1; n = prev[n]) path.unshift(nodes[n]);
  return path;
}

const LIFT = 0.12; // same as trails, so the route sits on top of the trail it follows

function lineMaterial(color: string, width: number, opacity = 1, dashed = false) {
  const m = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: width, transparent: true, opacity, dashed, dashSize: 1, gapSize: 0.7 });
  m.depthTest = false;
  m.depthWrite = false; // so the rider, drawn after, isn't clipped by the line
  const pr = Math.min(window.devicePixelRatio, 2);
  m.resolution.set(window.innerWidth * pr, window.innerHeight * pr);
  return m;
}

export function installFilm(ctx: FilmContext) {
  const { map, terrain, trails, trailLayer, camera } = ctx;
  const boat = new Boat();
  ctx.scene.add(boat.group);
  const rider = new Rider();
  ctx.scene.add(rider.group);

  // The route: world points, and cumulative horizontal distance along it for timing
  let route: { pts: THREE.Vector3[]; dist: number[]; eles: number[] } | null = null;
  const routeLines = {
    preview: new LineSegments2(new LineSegmentsGeometry(), lineMaterial('#fffaf0', 3, 1, true)),
    halo: new LineSegments2(new LineSegmentsGeometry(), lineMaterial('#fffaf0', 11, 0.95)),
    line: new LineSegments2(new LineSegmentsGeometry(), lineMaterial('#f2b632', 5.5)),
  };
  Object.values(routeLines).forEach((l, i) => {
    l.renderOrder = 10 + i;
    l.frustumCulled = false;
    l.visible = false;
    ctx.scene.add(l);
  });
  const setSegments = (l: LineSegments2, pts: THREE.Vector3[]) => {
    l.visible = pts.length > 1;
    if (!l.visible) return;
    const arr: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) arr.push(...pts[i].toArray(), ...pts[i + 1].toArray());
    l.geometry.dispose();
    l.geometry = new LineSegmentsGeometry().setPositions(arr);
    l.computeLineDistances();
  };
  /** Point and heading `u` (0–1) of the way along the route, by distance */
  const routeAt = (u: number) => {
    const { pts, dist } = route!;
    const d = THREE.MathUtils.clamp(u, 0, 1) * dist[dist.length - 1];
    let i = 1;
    while (i < dist.length - 1 && dist[i] < d) i++;
    const k = (d - dist[i - 1]) / (dist[i] - dist[i - 1] || 1);
    const p = pts[i - 1].clone().lerp(pts[i], k);
    const dir = pts[Math.min(pts.length - 1, i + 2)].clone().sub(pts[Math.max(0, i - 3)]).normalize();
    return { p, dir, i, k };
  };

  const caption = document.createElement('div');
  caption.id = 'film-caption';
  document.body.appendChild(caption);

  const local = (lon: number, lat: number): [number, number] => [
    ((lon - map.bbox.west) / (map.bbox.east - map.bbox.west)) * map.widthM,
    ((lat - map.bbox.south) / (map.bbox.north - map.bbox.south)) * map.heightM,
  ];
  const worldAt = (lon: number, lat: number) => {
    const [x, y] = local(lon, lat);
    return new THREE.Vector3(...toWorld(map, x, y, terrain.heightAt(x, y)));
  };
  const trailByName = (name: string) => {
    const t = trails.find((t) => !t.plan && t.name.toLowerCase() === name.toLowerCase());
    if (!t) throw new Error(`No trail named ${name}`);
    return t;
  };

  let lastCaption = '';

  const api = {
    ready: true,
    homeView: () => toJSON(ctx.homeView()),
    trailView: (name: string, pad: Padding = { left: 80, right: 80, top: 80, bottom: 80 }) =>
      toJSON(ctx.trailView(trailByName(name).id, pad)),
    /** A view centered on a lon/lat. `azimuth` defaults to the home direction; -π/2 puts east at the top. */
    pointView: (lon: number, lat: number, zoom: number, azimuth?: number): ViewJSON => {
      const home = ctx.homeView();
      const az = azimuth ?? home.azimuth;
      const p = worldAt(lon, lat);
      // slide the target along the view direction to the ground plane, like computeView does
      const dir = new THREE.Vector3(Math.sin(home.polar) * Math.sin(az), Math.cos(home.polar), Math.sin(home.polar) * Math.cos(az));
      p.addScaledVector(dir, -p.y / dir.y);
      return { target: p.toArray(), zoom, azimuth: az, polar: home.polar };
    },

    /** Build a route from legs of named trails and roads, in order. Where one leg ends away
     * from where the next begins, a straight connector bridges the gap. Returns overall stats,
     * each named leg's stats and span (u, 0–1 along the route), and the connectors' spans. */
    setRoute: (parts: RoutePart[]) => {
      const path: XYE[] = [];
      const spans: { name: string | null; from: number; to: number }[] = []; // vertex index ranges
      const append = (pts: XYE[], name: string | null) => {
        const from = Math.max(0, path.length - 1);
        for (const p of pts) {
          const last = path[path.length - 1];
          if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.5) continue;
          path.push(p);
        }
        spans.push({ name, from, to: path.length - 1 });
      };
      for (const part of parts) {
        const last = path[path.length - 1];
        const from: [number, number] = part.from ? local(...part.from) : [last[0], last[1]];
        const [tx, ty] = local(...part.to);
        const legPts: XYE[] = part.name ? pathAlong(trailByName(part.name).lines, from, [tx, ty]) : [[tx, ty, terrain.heightAt(tx, ty)]];
        const gap = last ? Math.hypot(legPts[0][0] - last[0], legPts[0][1] - last[1]) : 0;
        if (gap > GAP || (!part.name && gap > 0.5)) {
          // bridge the gap with a straight line, draped on the terrain every 20 m
          const [x0, y0] = last;
          const [x1, y1] = legPts[0];
          const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 20);
          const bridge: XYE[] = [];
          for (let k = 1; k < n; k++) {
            const x = x0 + ((x1 - x0) * k) / n;
            const y = y0 + ((y1 - y0) * k) / n;
            bridge.push([x, y, terrain.heightAt(x, y)]);
          }
          // a connector-only part is just the bridge, ending at its target
          append(part.name ? bridge : [...bridge, ...legPts], null);
        }
        if (part.name) append(legPts, part.name);
      }

      const pts = path.map(([x, y]) => {
        const [wx, wy, wz] = toWorld(map, x, y, terrain.heightAt(x, y));
        return new THREE.Vector3(wx, wy + LIFT, wz);
      });
      const eles = path.map((p) => p[2]);
      // distances (horizontal meters) and climbing, with the same 4 m hysteresis as the trail stats
      const dist = [0];
      for (let k = 1; k < path.length; k++) dist.push(dist[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
      const total = dist[dist.length - 1];
      const measure = (a: number, b: number) => {
        let gain = 0;
        let loss = 0;
        let ref = eles[a];
        for (let k = a; k <= b; k++) {
          if (eles[k] - ref > 4) [gain, ref] = [gain + eles[k] - ref, eles[k]];
          else if (ref - eles[k] > 4) [loss, ref] = [loss + ref - eles[k], eles[k]];
        }
        return {
          uStart: dist[a] / total,
          uEnd: dist[b] / total,
          miles: Math.round(((dist[b] - dist[a]) / 1609.34) * 10) / 10,
          gainFt: Math.round(gain * 3.28084),
          lossFt: Math.round(loss * 3.28084),
          endFt: Math.round(eles[b] * 3.28084),
        };
      };
      route = { pts, dist, eles };
      setSegments(routeLines.preview, pts);
      const whole = measure(0, path.length - 1);
      return {
        miles: whole.miles,
        gainFt: whole.gainFt,
        lossFt: whole.lossFt,
        topFt: Math.round(Math.max(...eles) * 3.28084),
        legs: spans.filter((s) => s.name).map((s) => ({ name: s.name!, ...measure(s.from, s.to) })),
        connectors: spans.filter((s) => !s.name).map((s) => measure(s.from, s.to)),
      };
    },
    /** Elevation (m) along the route at n+1 evenly spaced points, for pacing climbs and descents */
    routeProfile: (n: number) =>
      Array.from({ length: n + 1 }, (_, i) => {
        const { i: k, p } = routeAt(i / n);
        const { eles, pts } = route!;
        const t = pts[k].distanceTo(pts[k - 1]) ? p.distanceTo(pts[k - 1]) / pts[k].distanceTo(pts[k - 1]) : 0;
        return eles[k - 1] + (eles[k] - eles[k - 1]) * t;
      }),
    /** Where the route is at `u`, as a ground-plane camera target */
    routeTarget: (u: number): [number, number, number] => routeAt(u).p.toArray(),
    /** A view that fits the whole route */
    routeView: (pad: Padding, azimuth?: number) => toJSON(ctx.fitView(route!.pts, pad, azimuth)),
    /** Set the boat's route from [lon, lat] waypoints. Returns its length and any points on land. */
    setBoatRoute: (lonlats: [number, number][]) => {
      boat.setRoute(lonlats.map(([lon, lat]) => worldAt(lon, lat)));
      const dry: number[] = [];
      for (let i = 0; i <= 400; i++) {
        const p = boat.pointAt(i / 400);
        const x = p.x * 100 + map.widthM / 2;
        const y = -p.z * 100 + map.heightM / 2;
        if (!terrain.isWater(x, y)) dry.push(i / 400);
      }
      return { lengthUnits: boat.length, dry };
    },
    isWater: (lon: number, lat: number) => terrain.isWater(...local(lon, lat)),
    /** Where the boat is at `u`, as a ground-plane camera target */
    boatTarget: (u: number): [number, number, number] => boat.pointAt(u).toArray(),
    trailEnds: (name: string) => {
      const line = trailByName(name).lines.reduce((a, b) => (b.length > a.length ? b : a));
      const [x0, y0] = [line[0], line[1]];
      const [x1, y1] = [line[line.length - 3], line[line.length - 2]];
      return {
        start: toWorld(map, x0, y0, terrain.heightAt(x0, y0)),
        end: toWorld(map, x1, y1, terrain.heightAt(x1, y1)),
      };
    },

    frame(state: FrameState) {
      const v = state.view;
      camera.zoom = v.zoom;
      camera.updateProjectionMatrix();
      ctx.placeCamera(v.azimuth, v.polar, new THREE.Vector3(...v.target));
      camera.updateMatrixWorld();

      const ppu = ctx.pixelsPerUnit();
      if (state.boat && state.boat.sizePx > 0.5) {
        boat.update(state.boat.u, state.boat.sizePx / ppu, true, state.time, state.boat.wake ?? 1);
      } else boat.update(0, 1, false, state.time);

      const r = state.route;
      if (r && route) {
        const { p, dir, i, k } = routeAt(r.reveal);
        const drawn = r.reveal > 0 ? [...route.pts.slice(0, i), route.pts[i - 1].clone().lerp(route.pts[i], k)] : [];
        setSegments(routeLines.halo, drawn);
        setSegments(routeLines.line, drawn);
        routeLines.preview.visible = (r.preview ?? 0) > 0;
        routeLines.preview.material.opacity = 0.85 * (r.preview ?? 0);
        routeLines.preview.material.dashScale = ppu / 6;
        const size = (r.riderPx ?? 0) / ppu;
        rider.place(p.clone().setY(p.y - LIFT), dir, size, size > 0.01);
      } else {
        for (const l of Object.values(routeLines)) l.visible = false;
        rider.place(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 1, false);
      }

      if (state.trail && state.trail.reveal > 0) {
        trailLayer.setSelected(trailByName(state.trail.name).id, state.trail.reveal, state.trail.reverse);
      } else trailLayer.setSelected(null);

      const focus = state.focus ?? 0;
      ctx.landscape.focusUniform.value = focus * 0.45;
      trailLayer.setBaseFade(focus);

      const c = state.caption;
      const html = c ? `<h2>${c.title}</h2>${c.subtitle ? `<p>${c.subtitle}</p>` : ''}` : '';
      if (html !== lastCaption) {
        caption.innerHTML = html;
        lastCaption = html;
      }
      caption.style.opacity = String(c?.opacity ?? 0);

      ctx.render();
      return true;
    },
  };
  (window as unknown as { __film: typeof api }).__film = api;
}
