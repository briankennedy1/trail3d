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
  name: string;
  from: LonLat;
  to: LonLat;
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
  let route: { pts: THREE.Vector3[]; dist: number[] } | null = null;
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

    /** Build a route from legs of named trails and roads. Returns its stats, and where each leg ends (u). */
    setRoute: (parts: RoutePart[]) => {
      const pts: THREE.Vector3[] = [];
      const eles: number[] = [];
      const legs: { name: string; uEnd: number; miles: number; gainFt: number; lossFt: number; endFt: number }[] = [];
      const legEnds: number[] = [];
      for (const part of parts) {
        const [fx, fy] = local(...part.from);
        const [tx, ty] = local(...part.to);
        // the line of this trail that passes closest to both ends, and the vertices nearest them
        let best: { line: number[]; i: number; j: number; score: number } | null = null;
        for (const line of trailByName(part.name).lines) {
          let i = 0;
          let j = 0;
          let di = Infinity;
          let dj = Infinity;
          for (let k = 0; k < line.length; k += 3) {
            const a = Math.hypot(line[k] - fx, line[k + 1] - fy);
            const b = Math.hypot(line[k] - tx, line[k + 1] - ty);
            if (a < di) [di, i] = [a, k];
            if (b < dj) [dj, j] = [b, k];
          }
          if (!best || di + dj < best.score) best = { line, i, j, score: di + dj };
        }
        const { line, i, j } = best!;
        const step = i <= j ? 3 : -3;
        for (let k = i; step > 0 ? k <= j : k >= j; k += step) {
          if (pts.length && k === i) continue; // shared junction point
          const [x, y] = [line[k], line[k + 1]];
          const [wx, wy, wz] = toWorld(map, x, y, terrain.heightAt(x, y));
          pts.push(new THREE.Vector3(wx, wy + LIFT, wz));
          eles.push(line[k + 2]);
        }
        legEnds.push(pts.length - 1);
        legs.push({ name: part.name, uEnd: 0, miles: 0, gainFt: 0, lossFt: 0, endFt: Math.round(eles[eles.length - 1] * 3.28084) });
      }
      // distances (horizontal meters) and climbing, with the same 4 m hysteresis as the trail stats
      const dist = [0];
      for (let k = 1; k < pts.length; k++) dist.push(dist[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z) * 100);
      const total = dist[dist.length - 1];
      let start = 0;
      legs.forEach((leg, n) => {
        const end = legEnds[n];
        let ref = eles[start];
        for (let k = start; k <= end; k++) {
          if (eles[k] - ref > 4) [leg.gainFt, ref] = [leg.gainFt + (eles[k] - ref) * 3.28084, eles[k]];
          else if (ref - eles[k] > 4) [leg.lossFt, ref] = [leg.lossFt + (ref - eles[k]) * 3.28084, eles[k]];
        }
        leg.gainFt = Math.round(leg.gainFt);
        leg.lossFt = Math.round(leg.lossFt);
        leg.miles = Math.round(((dist[end] - dist[start]) / 1609.34) * 10) / 10;
        leg.uEnd = dist[end] / total;
        start = end;
      });
      route = { pts, dist };
      setSegments(routeLines.preview, pts);
      return {
        miles: Math.round((total / 1609.34) * 10) / 10,
        gainFt: legs.reduce((a, l) => a + l.gainFt, 0),
        lossFt: legs.reduce((a, l) => a + l.lossFt, 0),
        topFt: Math.round(Math.max(...eles) * 3.28084),
        legs,
      };
    },
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
