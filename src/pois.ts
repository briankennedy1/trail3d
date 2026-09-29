import * as THREE from 'three';
import { EXAGGERATION, LAKE_LEVEL, Terrain, WORLD_SCALE, toWorld, type MapData } from './data';
import { BASE_ELEVATION } from './terrain';

export type POI = { name: string; latitude: number; longitude: number; color: string; elevationFt?: number; url?: string };

// Banner height in world units; its width follows the text on it.
export const BANNER_HEIGHT = 1.97;

function labelTexture(name: string, color: string, elevationFt?: number, linked = false) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const nameFont = `700 ${elevationFt ? 49 : 53}px system-ui, sans-serif`;
  const elevationFont = '700 38px system-ui, sans-serif';
  const elevation = elevationFt ? `${elevationFt.toLocaleString()} ft` : '';
  const textStart = linked ? 99 : 36;
  ctx.font = nameFont;
  const nameEnd = textStart + ctx.measureText(name).width;
  ctx.font = elevationFont;
  const textEnd = elevation ? nameEnd + 30 + ctx.measureText(elevation).width : nameEnd;
  // Size the banner to its text, leaving room for the forked fly end.
  const tip = Math.ceil(textEnd + 82);
  canvas.width = tip + 12;
  canvas.height = 144;
  // A straight-edged fabric banner with a forked fly end, not a text card.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(tip, 8);
  ctx.lineTo(tip - 44, 72);
  ctx.lineTo(tip, 136);
  ctx.lineTo(0, 136);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, .17)';
  ctx.fillRect(0, 8, 17, 128);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fffaf0';
  ctx.font = nameFont;
  ctx.fillText(name, textStart, 72);
  if (elevation) {
    ctx.font = elevationFont;
    ctx.textAlign = 'right';
    ctx.fillText(elevation, textEnd, 72);
  }
  if (linked) {
    // Standard external-link mark, drawn on the fabric rather than overlaid on it.
    ctx.strokeStyle = '#fffaf0';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(65, 68);
    ctx.lineTo(65, 91);
    ctx.lineTo(39, 91);
    ctx.lineTo(39, 65);
    ctx.lineTo(62, 65);
    ctx.moveTo(55, 76);
    ctx.lineTo(81, 50);
    ctx.moveTo(67, 50);
    ctx.lineTo(81, 50);
    ctx.lineTo(81, 64);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  return { texture, width: canvas.width * BANNER_HEIGHT / canvas.height };
}

export type Flag = {
  marker: THREE.Group;
  pole: THREE.Mesh;
  pennant: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  // Loose copies of the pennant and banner that blow away and settle on the terrain.
  leaves: LoosePiece[];
  looseBanners: LoosePiece[];
  bannerWidth: number;
  url?: string;
};

// The small pennant's centroid, which the loose leaf tumbles around.
export const PENNANT_CENTER = new THREE.Vector3(0.373, -0.28, 0);

type DriftStyle = {
  distance: number; // how far the first gust carries it downwind
  sink: number; // starting fall speed, world units per second
  gravity: number; // how quickly the fall speeds up, so long drops downhill don't drag
  swingsPerSecond: number;
  sway: number; // downwind rocking
  bob: number; // pendulum rise at each end of a swing
  wander: number; // crosswind wander
  roll: number; // tumble speed, radians per second
  rock: number;
  twist: number;
  touchdown: number; // how close its middle gets to the ground before it starts lying down
  settle: number; // seconds to lie down flat once it does
};
const LEAF_STYLE: DriftStyle = { distance: 3.6, sink: 0.9, gravity: 0.8, swingsPerSecond: 0.53, sway: 0.45, bob: 0.28, wander: 0.2, roll: 2.3, rock: 0.75, twist: 0.5, touchdown: 0.3, settle: 0.6 };
const BANNER_STYLE: DriftStyle = { distance: 5, sink: 1.3, gravity: 1, swingsPerSecond: 0.39, sway: 0.6, bob: 0.35, wander: 0.43, roll: 1.35, rock: 0.3, twist: 0.35, touchdown: 0.8, settle: 0.9 };
const REST = 0.2, FADE = 0.7, MAX_FLIGHT = 12, OFF_MAP_FADE = 1;
// How far landed fabric is drawn toward the camera, in world units. Under the
// orthographic camera this only changes depth, not where it appears on screen.
const DEPTH_LIFT = 1;

// How loose fabric meets the diorama: the ground height under a point (null off the
// map), and where fabric laid out at a point comes to rest, hanging down the
// diorama's side past the edge.
export type Landing = {
  ground: (x: number, z: number) => number | null;
  drape: (x: number, z: number) => THREE.Vector3;
};

// A piece of flag fabric blown loose: it drifts downwind rocking like a falling
// leaf, rides over any hillside it brushes, lies down face up on the terrain,
// rests, and slowly fades. Its pose is tracked by frame (the wind direction it
// left in) → pivot (what it tumbles around) → offset (where its shape sits on
// the pivot), and every vertex is written out in world space so each one can
// meet the ground on its own.
export class LoosePiece {
  readonly offset = new THREE.Object3D();
  // The fabric's shape in its own space, which the mesh's world-space vertices follow.
  readonly source: THREE.BufferGeometry;
  age = Infinity;
  // Reshapes the source each frame while it is still moving.
  shape?: (loose: number, time: number) => void;
  private readonly pivot = new THREE.Object3D();
  private readonly frame = new THREE.Object3D();
  private readonly start = new THREE.Vector3();
  private readonly flat = new THREE.Quaternion();
  private readonly depthLift = { value: 0 };
  private phase: 'flying' | 'settling' | 'resting' = 'resting';
  private phaseAge = 0;
  private touchdownAge = 0;
  private offMap = 0;

  constructor(
    readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
    private readonly style: DriftStyle,
    private readonly landing: Landing,
  ) {
    this.source = mesh.geometry.clone();
    const color = this.source.getAttribute('color');
    if (color) mesh.geometry.setAttribute('color', color);
    this.frame.add(this.pivot);
    this.pivot.add(this.offset);
    mesh.visible = false;
    // Drawn after the route strokes so fabric lying on the trail covers it, and
    // once down, drawn in front of the ground it lies on so no terrain pokes through.
    mesh.renderOrder = 30;
    mesh.material.onBeforeCompile = shader => {
      shader.uniforms.uDepthLift = this.depthLift;
      shader.vertexShader = `uniform float uDepthLift;\n${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  gl_Position = projectionMatrix * (mvPosition + vec4(0.0, 0.0, uDepthLift, 0.0));',
      );
    };
  }

  launch(origin: THREE.Vector3, yaw: number, start: THREE.Vector3) {
    this.frame.position.copy(origin);
    this.frame.rotation.set(0, yaw, 0);
    this.start.copy(start);
    this.offset.position.set(0, 0, 0);
    this.offset.scale.set(1, 1, 1);
    this.shape = undefined;
    this.age = 0;
    this.phase = 'flying';
    this.phaseAge = 0;
    this.offMap = 0;
    this.depthLift.value = 0;
    this.setOpacity(1);
    this.mesh.visible = true;
  }

  update(dt: number, time: number) {
    if (!this.mesh.visible) return;
    this.age += dt;
    this.phaseAge += dt;
    if (this.phase === 'resting') {
      const opacity = 1 - (this.phaseAge - REST) / FADE;
      this.setOpacity(Math.min(1, opacity));
      if (opacity <= 0) this.mesh.visible = false;
      return;
    }
    const settling = this.phase === 'settling';
    const down = settling ? 1 - (1 - Math.min(1, this.phaseAge / this.style.settle)) ** 3 : 0;
    // While lying down it keeps drifting, but eases to a stop.
    const t = settling ? this.touchdownAge + 0.4 * (1 - Math.exp(-this.phaseAge / 0.4)) : this.age;
    const loose = this.pose(t);
    if (settling) this.pivot.quaternion.slerp(this.flat, down);
    this.shape?.(loose * (1 - down), time);
    this.frame.updateMatrixWorld(true);
    this.writeVertices(settling ? down : -1);
    if (settling) {
      this.depthLift.value = DEPTH_LIFT * down;
      if (this.phaseAge >= this.style.settle) {
        this.phase = 'resting';
        this.phaseAge = 0;
      }
      return;
    }
    const center = this.pivot.getWorldPosition(new THREE.Vector3());
    const groundY = this.landing.ground(center.x, center.z);
    // Fabric only lies down while its middle is over the diorama; past the edge
    // it slides off and keeps falling down the cliff, fading as it goes.
    if (groundY !== null && center.y - groundY < this.style.touchdown) {
      this.lieDown();
      return;
    }
    if (groundY === null) this.offMap += dt;
    const opacity = Math.min(1 - this.offMap / OFF_MAP_FADE, MAX_FLIGHT + 1 - this.age);
    this.setOpacity(Math.min(1, opacity));
    if (opacity <= 0) this.mesh.visible = false;
  }

  // Where the falling-leaf path has it after t seconds; returns how loose it has shaken.
  private pose(t: number) {
    const { style } = this;
    const swing = 2 * Math.PI * style.swingsPerSecond * t;
    const loose = Math.min(1, t / 0.4);
    const drift = style.distance * (1 - Math.exp(-t / 1.2)) + 0.25 * t;
    this.pivot.position.set(
      this.start.x + drift + style.sway * Math.sin(swing),
      this.start.y - style.sink * t - style.gravity * t * t / 2 + style.bob * Math.sin(swing) ** 2,
      style.wander * t * Math.sin(swing / 2),
    );
    this.pivot.rotation.set(style.roll * t, loose * style.twist * Math.sin(swing * 0.75), loose * style.rock * Math.cos(swing));
    return loose;
  }

  // Start lying down face up along the way it is heading, so the label reads from above.
  private lieDown() {
    const heading = new THREE.Vector3(1, 0, 0).applyQuaternion(this.pivot.quaternion).setY(0);
    if (heading.lengthSq() < 1e-6) heading.set(1, 0, 0);
    heading.normalize();
    const across = new THREE.Vector3(heading.z, 0, -heading.x);
    this.flat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(heading, across, new THREE.Vector3(0, 1, 0)));
    this.phase = 'settling';
    this.touchdownAge = this.age;
    this.phaseAge = 0;
  }

  // Place each vertex in the world: never below the ground under it, and while
  // lying down (down > 0), sinking onto the terrain or hanging over the edge.
  private writeVertices(down: number) {
    const source = this.source.attributes.position;
    const position = this.mesh.geometry.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < source.count; i++) {
      this.offset.localToWorld(vertex.fromBufferAttribute(source, i));
      const groundY = this.landing.ground(vertex.x, vertex.z);
      if (groundY !== null) vertex.y = Math.max(vertex.y, groundY + 0.05);
      if (down > 0) vertex.lerp(this.landing.drape(vertex.x, vertex.z), down * down);
      position.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    position.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
  }

  private setOpacity(opacity: number) {
    const { material } = this.mesh;
    material.opacity = opacity;
    // A fading piece shouldn't leave a hard-edged hole in the route behind it.
    material.depthWrite = opacity > 0.99;
    // Keep discarding the banner's clear margins as its fabric fades out.
    if (material.alphaTest > 0) material.alphaTest = Math.max(0.001, 0.5 * opacity);
  }
}

function subdividedTriangle(a: [number, number], b: [number, number], c: [number, number], divisions: number) {
  const positions: number[] = [];
  const index: number[] = [];
  const id = (row: number, column: number) => row * (divisions + 1) - row * (row - 1) / 2 + column;
  for (let row = 0; row <= divisions; row++) {
    for (let column = 0; column <= divisions - row; column++) {
      const s = column / divisions, t = row / divisions;
      positions.push(a[0] + (b[0] - a[0]) * s + (c[0] - a[0]) * t, a[1] + (b[1] - a[1]) * s + (c[1] - a[1]) * t, 0);
      if (column < divisions - row) index.push(id(row, column), id(row, column + 1), id(row + 1, column));
      if (column < divisions - row - 1) index.push(id(row, column + 1), id(row + 1, column + 1), id(row + 1, column));
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)).setIndex(index);
}

export function buildPOIs(map: MapData, terrain: Terrain, ridePlaces: POI[] = [], baseElevation = BASE_ELEVATION) {
  const group = new THREE.Group();
  const flags: Flag[] = [];
  // The POI group sits at the scene origin, so its local space is world space.
  const halfWidth = map.widthM / 2 / WORLD_SCALE, halfDepth = map.heightM / 2 / WORLD_SCALE;
  const heightAt = (x: number, z: number) => {
    const mapX = x * WORLD_SCALE + map.widthM / 2, mapY = map.heightM / 2 - z * WORLD_SCALE;
    return toWorld(map, mapX, mapY, terrain.heightAt(mapX, mapY))[1];
  };
  const lift = 0.05;
  const base = (baseElevation - LAKE_LEVEL) / WORLD_SCALE * EXAGGERATION;
  const landing: Landing = {
    ground: (x, z) => Math.abs(x) > halfWidth || Math.abs(z) > halfDepth ? null : heightAt(x, z),
    drape: (x, z) => {
      const edgeX = THREE.MathUtils.clamp(x, -halfWidth, halfWidth);
      const edgeZ = THREE.MathUtils.clamp(z, -halfDepth, halfDepth);
      const over = Math.hypot(x - edgeX, z - edgeZ);
      if (over === 0) return new THREE.Vector3(x, heightAt(x, z) + lift, z);
      // Past the edge, fold over the rim and hang straight down the cliff,
      // gathering at the foot of the diorama if there's more fabric than wall.
      return new THREE.Vector3(
        edgeX + (x - edgeX) / over * lift,
        Math.max(base, heightAt(edgeX, edgeZ) + lift - over),
        edgeZ + (z - edgeZ) / over * lift,
      );
    },
  };
  const metersLon = 111320 * Math.cos((map.bbox.south + map.bbox.north) * Math.PI / 360);
  for (const place of ridePlaces) {
    const x = (place.longitude - map.bbox.west) * metersLon;
    const y = (place.latitude - map.bbox.south) * 111320;
    const marker = new THREE.Group();
    marker.position.set(...toWorld(map, x, y, terrain.heightAt(x, y) + 1));

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, 1, 8),
      new THREE.MeshBasicMaterial({ color: '#463e34', depthTest: true }),
    );
    pole.scale.y = 1.75;
    pole.position.y = 0.875;
    marker.add(pole);

    const pennantGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1.12, -0.28, 0, 0, -0.56, 0,
    ], 3));
    const pennantMaterial = new THREE.MeshBasicMaterial({ color: place.color, side: THREE.DoubleSide, depthTest: true, transparent: true });
    const pennant = new THREE.Mesh(pennantGeometry, pennantMaterial);
    pennant.position.y = 1.75;
    marker.add(pennant);

    // Loose copies of the pennant that blow off the pole like leaves. They sit
    // outside the marker so they keep drifting the way they came loose while the flag turns.
    // Subdivided so a landed leaf can bend over bumps in the terrain.
    const leafGeometry = subdividedTriangle(
      [-PENNANT_CENTER.x, -PENNANT_CENTER.y], [1.12 - PENNANT_CENTER.x, -0.28 - PENNANT_CENTER.y], [-PENNANT_CENTER.x, -0.56 - PENNANT_CENTER.y], 6,
    );
    const leaves = [0, 1].map(() => new LoosePiece(
      new THREE.Mesh(leafGeometry.clone(), pennantMaterial.clone()), LEAF_STYLE, landing,
    ));

    // Subdivided along its length so the banner can ripple like cloth.
    const bannerGeometry = new THREE.PlaneGeometry(1, 1, 48, 8);
    bannerGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(bannerGeometry.attributes.position.count * 3).fill(1), 3));
    // Write depth for the fabric but not its clear margins, so the route strokes
    // drawn afterwards pass behind the banner instead of painting over it.
    const { texture, width: bannerWidth } = labelTexture(place.name, place.color, place.elevationFt, Boolean(place.url));
    const label = new THREE.Mesh(bannerGeometry, new THREE.MeshBasicMaterial({
      map: texture, transparent: true,
      side: THREE.DoubleSide, depthTest: true, depthWrite: true, alphaTest: 0.5, vertexColors: true,
    }));
    label.visible = false;
    marker.add(label);
    const looseBanners = [0, 1, 2].map(() => new LoosePiece(
      new THREE.Mesh(bannerGeometry.clone(), label.material.clone()), BANNER_STYLE, landing,
    ));
    for (const piece of [...leaves, ...looseBanners]) group.add(piece.mesh);
    flags.push({ marker, pole, pennant, label, leaves, looseBanners, bannerWidth, url: place.url });
    group.add(marker);
  }
  return { group, flags };
}

// Lays the banner out from its hoist edge: bunched in tight folds while it is
// still unfurling, then flying flat with a gentle ripple running downwind.
export function shapeBanner(geometry: THREE.BufferGeometry, width: number, height: number, reveal: number, time: number, still: boolean, billow = 0) {
  const { position, color, uv } = geometry.attributes;
  const length = Math.max(width * reveal, 0.001);
  const slack = 1 - reveal;
  const ripple = still ? 0 : 0.08 + 0.55 * slack + billow;
  const cycles = 2.2;
  for (let i = 0; i < position.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    const phase = 2 * Math.PI * (cycles * u - 0.8 * time) + 0.7 * v;
    const amplitude = ripple * u ** 0.8;
    // Shade only the folds turning away, so flat cloth matches the small pennant.
    const slope = amplitude * Math.cos(phase) * 2 * Math.PI * cycles / length;
    const shade = THREE.MathUtils.clamp(1 + 0.3 * slope, 0.62, 1);
    position.setXYZ(i, u * length, (v - 0.5) * height - 0.5 * slack * u * u, amplitude * Math.sin(phase));
    color.setXYZ(i, shade, shade, shade);
  }
  position.needsUpdate = true;
  color.needsUpdate = true;
  geometry.computeBoundingSphere();
}
