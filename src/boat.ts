import * as THREE from 'three';
import { NOISE, PAINT } from './shaders';
import { LIGHT_DIR } from './terrain';

// A little mahogany runabout (a nod to Obexer's wooden boats) that follows a route across
// the water, trailing a painted white wake. Used by film mode.

/** A flat-colored material with the map's watercolor lighting, for small props */
export function paintedMaterial(hex: string, side: THREE.Side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    vertexShader: PAINTED_VERT,
    fragmentShader: PAINTED_FRAG,
    uniforms: { uColor: { value: new THREE.Color(hex) }, uLightDir: { value: LIGHT_DIR } },
    side,
  });
}

const PAINTED_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const PAINTED_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec3 vNormal;
varying vec3 vWorld;
${NOISE}
${PAINT}
void main() {
  vec3 col = paint(uColor, vNormal, vWorld.xz * 8.0, vnoise(vWorld.xz * 20.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

const WAKE_VERT = /* glsl */ `
attribute float aS;
attribute float aSide;
varying float vS;
varying float vSide;
varying vec3 vWorld;
void main() {
  vS = aS;
  vSide = aSide;
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const WAKE_FRAG = /* glsl */ `
uniform float uScale;
uniform float uStrength;
varying float vS;
varying float vSide;
varying vec3 vWorld;
${NOISE}
void main() {
  float side = abs(vSide);
  // foam piles up along the two arms of the V and in the churn right behind the stern
  float arms = smoothstep(0.45, 0.95, side) * (1.0 - smoothstep(0.95, 1.0, side));
  float churn = (1.0 - smoothstep(0.0, 0.35, vS)) * (1.0 - smoothstep(0.0, 0.5, side));
  float broken = fbm(vWorld.xz / uScale * 3.0);
  float a = (arms * 0.85 + churn * 0.9 + 0.12) * pow(1.0 - vS, 1.3);
  a *= smoothstep(0.25, 0.6, broken + 0.3 * (1.0 - vS));
  gl_FragColor = vec4(vec3(0.99, 0.98, 0.95), clamp(a * uStrength, 0.0, 0.92));
}
`;

const WAKE_SAMPLES = 48;

export class Boat {
  readonly group = new THREE.Group();
  private hull = new THREE.Group();
  private wake: THREE.Mesh;
  private wakePos: Float32Array;
  private route: THREE.CatmullRomCurve3 | null = null;
  private routeLength = 1;

  constructor() {
    const mat = (hex: string) => paintedMaterial(hex);

    // Top-down outline: square stern at -x, pointed bow at +x, length 1
    const outline = (k: number) => {
      const s = new THREE.Shape();
      s.moveTo(-0.5 * k, -0.17 * k);
      s.lineTo(0.12 * k, -0.17 * k);
      s.quadraticCurveTo(0.42 * k, -0.15 * k, 0.5 * k, 0);
      s.quadraticCurveTo(0.42 * k, 0.15 * k, 0.12 * k, 0.17 * k);
      s.lineTo(-0.5 * k, 0.17 * k);
      s.closePath();
      return s;
    };
    const slab = (k: number, depth: number, y: number) => {
      const g = new THREE.ExtrudeGeometry(outline(k), { depth, bevelEnabled: false, curveSegments: 10 });
      g.rotateX(-Math.PI / 2); // extrude upward; the outline lies in the water plane
      g.translate(0, y, 0);
      return g;
    };
    const add = (g: THREE.BufferGeometry, color: string) => this.hull.add(new THREE.Mesh(g, mat(color)));

    add(slab(1, 0.1, 0), '#8e3a1c'); // mahogany hull
    add(slab(0.95, 0.018, 0.1), '#b8653a'); // varnished deck
    // cream king-plank stripes down the foredeck
    for (const z of [-0.045, 0.045]) {
      const g = new THREE.BoxGeometry(0.34, 0.006, 0.012);
      g.translate(0.27, 0.121, z);
      add(g, '#f3e6c6');
    }
    // cockpit upholstery and windshield
    const seats = new THREE.BoxGeometry(0.34, 0.035, 0.24);
    seats.translate(-0.16, 0.13, 0);
    add(seats, '#efe1c2');
    const glass = new THREE.BoxGeometry(0.018, 0.075, 0.27);
    glass.rotateZ(0.35);
    glass.translate(0.05, 0.155, 0);
    add(glass, '#a7d4da');
    // a jaunty stern flag
    const pole = new THREE.CylinderGeometry(0.006, 0.006, 0.2, 5);
    pole.translate(-0.47, 0.2, 0);
    add(pole, '#3b2a22');
    const flag = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.47, 0.3, 0),
      new THREE.Vector3(-0.47, 0.23, 0),
      new THREE.Vector3(-0.58, 0.265, 0),
    ]);
    flag.computeVertexNormals();
    const flagMesh = new THREE.Mesh(flag, mat('#d2532c'));
    flagMesh.material.side = THREE.DoubleSide;
    this.hull.add(flagMesh);

    this.group.add(this.hull);

    // Wake: a ribbon of WAKE_SAMPLES pairs of vertices, rewritten every frame
    this.wakePos = new Float32Array(WAKE_SAMPLES * 2 * 3);
    const s = new Float32Array(WAKE_SAMPLES * 2);
    const side = new Float32Array(WAKE_SAMPLES * 2);
    const index: number[] = [];
    for (let i = 0; i < WAKE_SAMPLES; i++) {
      s[i * 2] = s[i * 2 + 1] = i / (WAKE_SAMPLES - 1);
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
      if (i < WAKE_SAMPLES - 1) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const wakeGeo = new THREE.BufferGeometry();
    wakeGeo.setAttribute('position', new THREE.BufferAttribute(this.wakePos, 3).setUsage(THREE.DynamicDrawUsage));
    wakeGeo.setAttribute('aS', new THREE.BufferAttribute(s, 1));
    wakeGeo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    wakeGeo.setIndex(index);
    this.wake = new THREE.Mesh(
      wakeGeo,
      new THREE.ShaderMaterial({
        vertexShader: WAKE_VERT,
        fragmentShader: WAKE_FRAG,
        uniforms: { uScale: { value: 1 }, uStrength: { value: 1 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.wake.frustumCulled = false;
    this.wake.renderOrder = 4;
    this.group.add(this.wake);
    this.group.visible = false;
  }

  setRoute(points: THREE.Vector3[]) {
    this.route = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    this.routeLength = this.route.getLength();
  }

  get length() {
    return this.routeLength;
  }

  pointAt(u: number) {
    return this.route!.getPointAt(THREE.MathUtils.clamp(u, 0, 1));
  }

  /** Place the boat `u` (0–1) of the way along its route, `scale` world units long.
   * `wake` (0–1) is how churned-up the water behind it is: 0 when idling, 1 at full speed. */
  update(u: number, scale: number, visible: boolean, time: number, wake = 1) {
    this.group.visible = visible && !!this.route;
    if (!this.group.visible) return;
    const route = this.route!;
    u = THREE.MathUtils.clamp(u, 0, 1);
    const p = route.getPointAt(u);
    const t = route.getTangentAt(Math.min(u, 0.999));
    this.hull.position.set(p.x, p.y + Math.sin(time * 9) * 0.01 * scale, p.z);
    this.hull.rotation.set(0, Math.atan2(-t.z, t.x), 0);
    this.hull.scale.setScalar(scale);
    // bow up a touch while planing
    this.hull.rotateZ(0.06);

    // The wake trails behind the stern along the path already travelled
    const wakeLength = scale * 9;
    const du = wakeLength / this.routeLength;
    const q = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let i = 0; i < WAKE_SAMPLES; i++) {
      const s = i / (WAKE_SAMPLES - 1);
      const ui = Math.max(0, u - s * du - (0.45 * scale) / this.routeLength);
      route.getPointAt(ui, q);
      route.getTangentAt(Math.min(ui, 0.999), tan);
      const half = scale * (0.12 + 0.95 * Math.pow(s, 0.75));
      const nx = -tan.z;
      const nz = tan.x;
      const y = q.y + 0.004;
      this.wakePos.set([q.x + nx * half, y, q.z + nz * half, q.x - nx * half, y, q.z - nz * half], i * 6);
    }
    this.wake.geometry.getAttribute('position').needsUpdate = true;
    const uniforms = (this.wake.material as THREE.ShaderMaterial).uniforms;
    uniforms.uScale.value = scale;
    uniforms.uStrength.value = wake;
  }
}
