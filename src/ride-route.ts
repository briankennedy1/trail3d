import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

// Shared original route strokes and rider marker, with terrain depth testing.
export function createRideRoute(scene: THREE.Scene, points: THREE.Vector3[]) {
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
  const preview = routeLine(mat('#fff7e7', 4.5, 0.9), 20);
  preview.geometry.setPositions(points.flatMap(p => [p.x, p.y, p.z]));
  const previewCore = routeLine(mat('#8a6d5b', 1.6875, 0.85), 21);
  previewCore.geometry.setPositions(points.flatMap(p => [p.x, p.y, p.z]));
  // Keep all route strokes in the transparent pass so renderOrder can put the
  // growing gold line above the full, muted preview.
  const activeHalo = routeLine(mat('#fff9df', 6.75, 0.99), 22);
  const active = routeLine(mat('#edaa29', 3.375, 0.99), 23);
  const overlap = routeLine(mat('#c58820', 3.375, 0.99), 24);
  overlap.visible = false;
  const rider = new THREE.Group();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.196, 16, 12), new THREE.MeshBasicMaterial({ color: '#0ba86b', depthTest: true }));
  rider.add(dot);
  rider.renderOrder = 25;
  rider.visible = false;
  scene.add(rider);

  return { preview, previewCore, activeHalo, active, overlap, rider };
}
