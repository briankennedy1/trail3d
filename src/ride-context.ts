import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Terrain, toWorld, WORLD_SCALE, LAKE_LEVEL, EXAGGERATION, type XY } from './data';
import type { ContextFeature } from './ride-context-data';

// Context belongs to the ride scene. Lines depth-test; labels use an occlusion
// check at their anchor. The viewer's disposal releases all GPU resources.
export function buildRideContext(terrain: Terrain, features: ContextFeature[]) {
  const group = new THREE.Group();
  const materials: LineMaterial[] = [];
  const labelLayer = document.createElement('div'); labelLayer.className = 'ride-context-labels';
  document.body.append(labelLayer);
  const labels: { element: HTMLElement; anchor: THREE.Vector3; width: number; height: number; occluded: boolean }[] = [];
  const world = (p: XY, lift: number) => new THREE.Vector3(...toWorld(terrain.map, p[0], p[1], terrain.heightAt(...p) + lift));
  const inLake = ([x, y]: XY) => {
    const i = Math.max(0, Math.min(terrain.w - 1, Math.round(x / terrain.map.widthM * (terrain.w - 1))));
    const j = Math.max(0, Math.min(terrain.h - 1, Math.round((1 - y / terrain.map.heightM) * (terrain.h - 1))));
    return terrain.water[j * terrain.w + i] !== 0;
  };
  for (const feature of features) {
    const water = feature.kind === 'waterway';
    const material = new LineMaterial({ color: water ? '#568998' : '#8c8170', linewidth: water ? 2.2 : 1.5,
      transparent: true, opacity: water ? 0.85 : 0.7, depthTest: true, depthWrite: false });
    materials.push(material);
    let longest: XY[] = [], longestLength = 0;
    const visibleLines: XY[][] = [];
    for (const line of feature.lines) {
      let run: XY[] = [];
      const add = (p: XY) => {
        // Hydrography may include submerged channels through reservoirs.
        if (water && inLake(p)) { if (run.length > 1) visibleLines.push(run); run = []; }
        else run.push(p);
      };
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i], distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(distance / 12));
        for (let j = 0; j < steps; j++) add([a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps]);
      }
      add(line.at(-1)!); if (run.length > 1) visibleLines.push(run);
    }
    for (const line of visibleLines) {
      const positions = line.flatMap(p => world(p, 2).toArray());
      let length = 0;
      for (let i = 1; i < line.length; i++) length += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      const geometry = new LineGeometry(); geometry.setPositions(positions);
      group.add(new Line2(geometry, material));
      if (length > longestLength) { longest = line; longestLength = length; }
    }
    if (longestLength < 100) continue;
    // A stable geographic anchor at the midpoint of the longest local section.
    let remaining = longestLength / 2, anchor = longest[0];
    for (let i = 1; i < longest.length; i++) {
      const a = longest[i - 1], b = longest[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (remaining <= length) { anchor = [a[0] + (b[0] - a[0]) * remaining / length, a[1] + (b[1] - a[1]) * remaining / length]; break; }
      remaining -= length;
    }
    // Reuse the overview's actual nameplate component and styles.
    const element = document.createElement('span'); element.className = 'map-marker ride-context-label';
    element.textContent = feature.name; element.style.visibility = 'hidden'; labelLayer.append(element);
    labels.push({ element, anchor: world(anchor, 2), width: 0, height: 0, occluded: false });
  }
  const projected = new THREE.Vector3(), towardViewer = new THREE.Vector3();
  let lastOcclusion = -Infinity;
  return { group,
    dispose() { labelLayer.remove(); },
    resize(width: number, height: number) { for (const m of materials) m.resolution.set(width, height); },
    update(camera: THREE.OrthographicCamera, width: number, height: number, exclusions: DOMRect[]) {
      const placed: number[][] = [];
      const now = performance.now(), checkOcclusion = now - lastOcclusion > 160;
      camera.getWorldDirection(towardViewer).negate();
      for (const item of labels) {
        const { element, anchor } = item;
        if (checkOcclusion) {
          item.width = element.offsetWidth; item.height = element.offsetHeight;
          item.occluded = false;
          for (let distance = 0; distance < Math.hypot(terrain.map.widthM, terrain.map.heightM) / WORLD_SCALE; distance += 0.3) {
            const x = (anchor.x + towardViewer.x * distance) * WORLD_SCALE + terrain.map.widthM / 2;
            const y = terrain.map.heightM / 2 - (anchor.z + towardViewer.z * distance) * WORLD_SCALE;
            if (x < 0 || y < 0 || x > terrain.map.widthM || y > terrain.map.heightM) break;
            const ground = (terrain.heightAt(x, y) - LAKE_LEVEL) / WORLD_SCALE * EXAGGERATION;
            if (ground > anchor.y + towardViewer.y * distance) { item.occluded = true; break; }
          }
        }
        const w = item.width, h = item.height, stem = width <= 700 ? 9 : 15;
        projected.copy(anchor).project(camera);
        const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2 - stem;
        const r = [x - w / 2 - 8, y - h - 5, x + w / 2 + 8, y + stem];
        element.style.left = `${x}px`; element.style.top = `${y}px`;
        const visible = !item.occluded && projected.z > -1 && projected.z < 1 && r[0] > 12 && r[2] < width - 12 && r[1] > 12 && r[3] < height - 24
          && placed.length < 9 && !placed.some(p => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1])
          && !exclusions.some(p => r[0] < p.right && r[2] > p.left && r[1] < p.bottom && r[3] > p.top);
        element.style.visibility = visible ? 'visible' : 'hidden';
        if (visible) placed.push(r);
      }
      if (checkOcclusion) lastOcclusion = now;
    },
  };
}
