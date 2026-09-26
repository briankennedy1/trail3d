import * as THREE from 'three';
import { Boat } from './boat';
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
  trailView: (id: number, pad: Padding) => View;
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
  /** 0–1: fade the landscape and other trails to spotlight the highlighted trail */
  focus?: number;
  caption?: { title: string; subtitle?: string; opacity: number };
  /** seconds, for small loops like the boat's bob */
  time: number;
}

const toJSON = (v: View): ViewJSON => ({ target: v.target.toArray(), zoom: v.zoom, azimuth: v.azimuth, polar: v.polar });

export function installFilm(ctx: FilmContext) {
  const { map, terrain, trails, trailLayer, camera } = ctx;
  const boat = new Boat();
  ctx.scene.add(boat.group);

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
    /** A view centered on a lon/lat, looking from the home direction */
    pointView: (lon: number, lat: number, zoom: number): ViewJSON => {
      const home = ctx.homeView();
      const p = worldAt(lon, lat);
      // slide the target along the view direction to the ground plane, like computeView does
      const dir = new THREE.Vector3(
        Math.sin(home.polar) * Math.sin(home.azimuth),
        Math.cos(home.polar),
        Math.sin(home.polar) * Math.cos(home.azimuth),
      );
      p.addScaledVector(dir, -p.y / dir.y);
      return { target: p.toArray(), zoom, azimuth: home.azimuth, polar: home.polar };
    },
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
