import * as THREE from 'three';
import { paintedMaterial } from './boat';

// A tiny painted mountain biker that rides along a route in film mode. Built along +X
// (the direction of travel), one unit long from wheel to wheel, standing on y = 0.

export class Rider {
  readonly group = new THREE.Group();
  private body = new THREE.Group();

  constructor() {
    const add = (g: THREE.BufferGeometry, color: string) => this.body.add(new THREE.Mesh(g, paintedMaterial(color)));
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, color: string) => {
      const len = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(r, r, len, 6);
      g.translate(0, len / 2, 0);
      const m = new THREE.Mesh(g, paintedMaterial(color));
      m.position.copy(a);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.body.add(m);
    };
    const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

    // wheels
    for (const x of [-0.5, 0.5]) {
      const wheel = new THREE.TorusGeometry(0.3, 0.05, 6, 18);
      wheel.translate(x, 0.3, 0);
      add(wheel, '#2f2a33');
    }
    // frame (vermilion, like the bike trails)
    const frame = '#d2532c';
    const bb = v(-0.05, 0.3);
    const seat = v(-0.2, 0.72);
    const head = v(0.35, 0.72);
    tube(v(-0.5, 0.3), bb, 0.035, frame);
    tube(bb, seat, 0.04, frame);
    tube(bb, head, 0.04, frame);
    tube(seat, head, 0.035, frame);
    tube(v(-0.5, 0.3), seat, 0.03, frame);
    tube(v(0.5, 0.3), head, 0.035, frame);
    tube(head, v(0.32, 0.86), 0.03, '#2f2a33');
    // handlebar
    const bar = new THREE.CylinderGeometry(0.025, 0.025, 0.36, 6);
    bar.rotateX(Math.PI / 2);
    bar.translate(0.32, 0.86, 0);
    add(bar, '#2f2a33');

    // rider: legs, teal jersey, arms, helmeted head
    const hip = v(-0.2, 0.82);
    const shoulder = v(0.12, 1.12);
    tube(hip, v(0.02, 0.52, 0.08), 0.055, '#3b4550');
    tube(v(0.02, 0.52, 0.08), bb.clone().setZ(0.08), 0.045, '#3b4550');
    tube(hip, v(-0.1, 0.5, -0.08), 0.055, '#3b4550');
    tube(v(-0.1, 0.5, -0.08), bb.clone().setZ(-0.08), 0.045, '#3b4550');
    tube(hip, shoulder, 0.12, '#16949f');
    tube(shoulder.clone().setZ(0.1), v(0.32, 0.88, 0.14), 0.04, '#16949f');
    tube(shoulder.clone().setZ(-0.1), v(0.32, 0.88, -0.14), 0.04, '#16949f');
    const face = new THREE.SphereGeometry(0.12, 10, 8);
    face.translate(0.2, 1.3, 0);
    add(face, '#e8b894');
    const helmet = new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    helmet.translate(0.18, 1.32, 0);
    add(helmet, '#f2b632');

    // Draw after the (always-on-top) route line so the rider sits on it, not under it
    this.body.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.renderOrder = 20;
        (o.material as THREE.Material).transparent = true;
      }
    });
    this.group.add(this.body);

    // Clear depth just before the rider draws, so trees and ridges never hide it, while its
    // own parts still sort against each other. (An invisible triangle that exists only to
    // run this hook at the right point in the render order.)
    const reset = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3)),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true }),
    );
    reset.renderOrder = 19;
    reset.frustumCulled = false;
    reset.onBeforeRender = (renderer) => renderer.clearDepth();
    this.group.add(reset);
    this.group.visible = false;
  }

  /** Stand the rider at `p`, facing along `dir` (world units), `scale` world units long. */
  place(p: THREE.Vector3, dir: THREE.Vector3, scale: number, visible: boolean) {
    this.group.visible = visible;
    if (!visible) return;
    this.body.position.copy(p);
    this.body.rotation.set(0, Math.atan2(-dir.z, dir.x), 0);
    // lean into climbs and descents a little (dir.y is rise per unit of travel)
    this.body.rotateZ(THREE.MathUtils.clamp(Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -0.35, 0.35));
    this.body.scale.setScalar(scale);
  }
}
