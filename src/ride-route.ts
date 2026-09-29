import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { SURFACE_COLORS, type RouteSurface } from './route-surfaces';

// Shared original route strokes and rider marker, with terrain depth testing.
export function createRideRoute(scene: THREE.Scene, points: THREE.Vector3[], surfaces?: RouteSurface[]) {
  const mat = (color: string, width: number, opacity = 1) => new LineMaterial({
    color: new THREE.Color(color).getHex(), linewidth: width, transparent: opacity < 1, opacity,
    depthTest: true, depthWrite: false,
  });
  const routeLine = (material: LineMaterial, order: number) => {
    const line = new Line2(new LineGeometry(), material);
    line.frustumCulled = false;
    line.renderOrder = order;
    scene.add(line);
    return line;
  };
  const coloredLine = (width: number, opacity: number, order: number) => {
    const material = mat('#ffffff', width, opacity); material.vertexColors = true;
    const line = new LineSegments2(new LineSegmentsGeometry(), material);
    line.frustumCulled = false; line.renderOrder = order; scene.add(line); return line;
  };
  const colors = points.slice(1).map((_, i) => new THREE.Color(surfaces ? SURFACE_COLORS[surfaces[i] ?? 'unknown'] : '#edaa29'));
  const stroke = (line: LineSegments2, start: number, end: number, endPoint?: THREE.Vector3, darken = 1, preview = false) => {
    const positions: number[] = [], values: number[] = [];
    for (let j = start; j < end; j++) {
      const a = points[j], b = j === end - 1 && endPoint ? endPoint : points[j + 1];
      const color = preview && !surfaces ? new THREE.Color('#8a6d5b') : colors[j];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      for (let k = 0; k < 2; k++) values.push(color.r * darken, color.g * darken, color.b * darken);
    }
    line.geometry.setPositions(positions); line.geometry.setColors(values);
  };
  const preview = routeLine(mat('#fff7e7', 4.5, 0.9), 20);
  preview.geometry.setPositions(points.flatMap(p => [p.x, p.y, p.z]));
  const previewCore = coloredLine(1.6875, 0.85, 21);
  stroke(previewCore, 0, points.length - 1, undefined, 1, true);
  // Keep all route strokes in the transparent pass so renderOrder can put the
  // growing route above the full, muted preview.
  const activeHalo = routeLine(mat('#fff9df', 6.75, 0.99), 22);
  const active = coloredLine(3.375, 0.99, 23);
  const overlap = coloredLine(3.375, 0.99, 24);
  overlap.visible = false;
  const rider = new THREE.Group();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.196, 16, 12), new THREE.MeshBasicMaterial({ color: '#0ba86b', depthTest: true }));
  rider.add(dot);
  rider.renderOrder = 25;
  rider.visible = false;
  scene.add(rider);

  return { preview, previewCore, activeHalo, active, overlap, rider,
    updateSurfaceStrokes(end: number, position: THREE.Vector3, returnStart: number) {
      stroke(active, 0, end, position);
      if (overlap.visible) stroke(overlap, returnStart, end, position, 0.82);
    },
  };
}
