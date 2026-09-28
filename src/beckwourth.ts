import './setup';
import './beckwourth.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EXAGGERATION, LAKE_LEVEL, Terrain, WORLD_SCALE, toWorld, type MapData } from './data';
import { buildLandscape } from './terrain';
import { buildPOIs } from './pois';

type Ride = { id: number; date: string; points: [number, number, number][] };
type EmbeddedRide = { map: MapData; ride: Ride; terrain: string };
type HomeView = { position: [number, number, number]; target: [number, number, number]; zoom: number };
const HOME_KEY = 'beckwourth-home-view-v1';
const $ = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;

async function main() {
  const embedded = (window as Window & { __BECKWOURTH__?: EmbeddedRide }).__BECKWOURTH__;
  const [map, ride, heights] = embedded
    ? [embedded.map, embedded.ride, Uint8Array.from(atob(embedded.terrain), c => c.charCodeAt(0)).buffer]
    : await Promise.all([
        fetch('beckwourth/map.json').then(r => r.json() as Promise<MapData>),
        fetch('beckwourth/ride.json').then(r => r.json() as Promise<Ride>),
        fetch('beckwourth/terrain.bin').then(r => r.arrayBuffer()),
      ]);
  const terrain = new Terrain(map, new Uint16Array(heights));
  const renderer = new THREE.WebGLRenderer({ canvas: $<HTMLCanvasElement>('scene'), antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6efe0');
  const landscape = buildLandscape(terrain, { trees: false });
  scene.add(landscape.group);
  const pois = buildPOIs(map, terrain);
  scene.add(pois.group);

  const points = ride.points.map(([x, y]) => new THREE.Vector3(...toWorld(map, x, y, terrain.heightAt(x, y) + 5)));
  const distances = [0];
  for (let i = 1; i < ride.points.length; i++) {
    const a = ride.points[i - 1], b = ride.points[i];
    distances.push(distances.at(-1)! + Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  let sharedStickPoints = 0;
  while (sharedStickPoints < Math.floor(ride.points.length / 2)) {
    const a = ride.points[sharedStickPoints], b = ride.points[ride.points.length - 1 - sharedStickPoints];
    if (a[0] !== b[0] || a[1] !== b[1]) break;
    sharedStickPoints++;
  }
  const returnStart = ride.points.length - sharedStickPoints;
  const total = distances.at(-1)!;
  const totalMiles = total / 1609.344;
  $<HTMLElement>('ride-distance').textContent = totalMiles.toFixed(1);
  $<HTMLElement>('profile-end').textContent = `${totalMiles.toFixed(1)} mi`;
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

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  // Manual navigation tracks input directly; scripted camera moves ease separately.
  controls.enableDamping = false;
  controls.panSpeed = 1.6;
  controls.zoomSpeed = 1.4;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.minZoom = 0.65;
  controls.maxZoom = 22;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.35;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.target.set(0, -2, 0);
  camera.position.set(100, 105, 100);
  camera.lookAt(controls.target);

  const play = $<HTMLButtonElement>('play');
  const followButton = $<HTMLButtonElement>('follow');
  const compassNeedle = $<SVGSVGElement>('compass-needle');
  const compassCenter = $<HTMLButtonElement>('north');
  const chart = $<HTMLDivElement>('elevation-chart');
  const chartSvg = $<SVGSVGElement>('elevation-svg');
  const elevationReadout = $<HTMLOutputElement>('elevation-readout');
  const elevations = ride.points.map(point => point[2]);
  const minElevation = Math.min(...elevations) - 12;
  const maxElevation = Math.max(...elevations) + 12;
  const chartX = (distance: number) => 280 * distance / total;
  const chartY = (elevation: number) => 86 - 76 * (elevation - minElevation) / (maxElevation - minElevation);
  const profile = ride.points.map((point, i) => `${i ? 'L' : 'M'}${chartX(distances[i]).toFixed(2)},${chartY(point[2]).toFixed(2)}`).join('');
  const svg = (name: string, attributes: Record<string, string>) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    chartSvg.append(node);
    return node;
  };
  svg('path', { d: `${profile}L280,96L0,96Z`, fill: '#c6d8bd', opacity: '.8' });
  svg('path', { d: profile, fill: 'none', stroke: '#477365', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' });
  const progressLine = svg('line', { y1: '0', y2: '96', stroke: '#b55d35', 'stroke-width': '1.5', 'vector-effect': 'non-scaling-stroke' });
  const progressDot = svg('circle', { r: '4', fill: '#b55d35', stroke: '#fffaf0', 'stroke-width': '1.5', 'vector-effect': 'non-scaling-stroke' });
  let playing = false, progress = 1, last = performance.now();
  let following = true;
  const orbitRadius = 90;
  const flightSteps = 192;
  const followDuration = 45;
  const introEnd = 0.25;
  type Shot = { center: THREE.Vector3; angle: number; height: number };
  type CameraPose = { position: THREE.Vector3; target: THREE.Vector3; zoom: number; offsetX: number; offsetY: number };
  type CameraTransition = {
    from: CameraPose; to: CameraPose; elapsed: number; duration: number; leadTime: number;
    startAngle: number; turn: number; startRadius: number; trackFollow: boolean;
  };
  let flightPath: Shot[] | null = null;
  let flightTimes: number[] = [];
  let playbackTime = 0;
  let cameraTransition: CameraTransition | null = null;
  function splineValue(v0: number, v1: number, v2: number, v3: number, t: number) {
    const u = 1 - t;
    return (u * u * u * v0 + (3 * t * t * t - 6 * t * t + 4) * v1
      + (-3 * t * t * t + 3 * t * t + 3 * t + 1) * v2 + t * t * t * v3) / 6;
  }

  function sampleAt(value: number) {
    const distance = THREE.MathUtils.clamp(value, 0, 1) * total;
    let lo = 0, hi = distances.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (distances[mid] < distance) lo = mid + 1; else hi = mid; }
    const i = Math.max(1, lo);
    const t = THREE.MathUtils.clamp((distance - distances[i - 1]) / Math.max(1, distances[i] - distances[i - 1]), 0, 1);
    return { i, t, elevation: THREE.MathUtils.lerp(elevations[i - 1], elevations[i], t) };
  }
  function routePoint(distance: number) {
    const { i, t } = sampleAt(distance / total);
    return points[i - 1].clone().lerp(points[i], t);
  }
  function followFocus(distance: number) {
    // Keep the helicopter ahead of the rider and above the broad route, rather
    // than tracking each switchback or phone GPS wobble.
    const focus = new THREE.Vector3();
    for (const [offset, weight] of [[-2100, 0.07], [-1050, 0.12], [0, 0.2],
      [1050, 0.24], [2100, 0.22], [3150, 0.15]]) {
      focus.addScaledVector(routePoint(distance + offset), weight);
    }
    focus.x *= 0.75;
    focus.z *= 0.75;
    return focus;
  }
  const feet = (meters: number) => `${Math.round(meters * 3.28084).toLocaleString()} ft`;
  const readout = (value: number, elevation: number) => `${feet(elevation)} · ${(value * totalMiles).toFixed(1)} mi`;
  function clearSightHeight(marker: THREE.Vector3, cameraX: number, cameraZ: number) {
    const dx = cameraX - marker.x, dz = cameraZ - marker.z;
    const distance = Math.hypot(dx, dz);
    let required = 0;
    // Follow the sightline across the height field, including ridges near the rider.
    for (let along = 1.25; along < distance; along += 1.25) {
      const x = marker.x + dx * along / distance;
      const z = marker.z + dz * along / distance;
      const mapX = x * WORLD_SCALE + map.widthM / 2;
      const mapY = map.heightM / 2 - z * WORLD_SCALE;
      if (mapX < 0 || mapX > map.widthM || mapY < 0 || mapY > map.heightM) continue;
      const groundY = (terrain.heightAt(mapX, mapY) - LAKE_LEVEL) * EXAGGERATION / WORLD_SCALE;
      required = Math.max(required, (groundY + 0.12 - marker.y) * distance / along);
    }
    return required;
  }
  function viewHeight(center: THREE.Vector3, angle: number, distance: number) {
    const x = center.x + Math.sin(angle) * orbitRadius;
    const z = center.z + Math.cos(angle) * orbitRadius;
    const subjects = [routePoint(distance), routePoint(distance + 500)];
    return Math.max(center.y + 34, ...subjects.map(p => p.y + clearSightHeight(p, x, z) + 2.5));
  }
  function plannedAngle(value: number) {
    // One continuous clockwise helicopter orbit. These beats keep the rider on
    // the visible side of the summit without searching for a new view in flight.
    const beats = [[0, -155.6], [0.44, -20], [0.54, 0], [0.60, 75],
      [0.72, 120], [0.85, 170], [1, 170]];
    for (let i = 1; i < beats.length; i++) {
      const [end, endAngle] = beats[i];
      if (value > end) continue;
      const [start, startAngle] = beats[i - 1];
      const t = THREE.MathUtils.smoothstep(value, start, end);
      return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(startAngle, endAngle, t));
    }
    return THREE.MathUtils.degToRad(170);
  }
  function buildFlightPath() {
    const rawCenters = Array.from({ length: flightSteps + 1 }, (_, i) => followFocus(total * i / flightSteps));
    // The camera follows the broad course of the ride, not individual GPS bends.
    const centers = rawCenters.map((_, i) => {
      const center = new THREE.Vector3();
      let weightSum = 0;
      for (let j = Math.max(0, i - 20); j <= Math.min(flightSteps, i + 20); j++) {
        const weight = 21 - Math.abs(i - j);
        center.addScaledVector(rawCenters[j], weight);
        weightSum += weight;
      }
      return center.divideScalar(weightSum);
    });
    const rawAngles = centers.map((_, i) => plannedAngle(i / flightSteps));
    // Spread quick direction changes across more of the ride, so the camera
    // can make its turn without nearly stopping the rider at one point.
    const plannedAngles = rawAngles.map((_, i) => {
      let angle = 0, weightSum = 0;
      for (let j = Math.max(0, i - 10); j <= Math.min(flightSteps, i + 10); j++) {
        const weight = 11 - Math.abs(i - j);
        angle += rawAngles[j] * weight;
        weightSum += weight;
      }
      return angle / weightSum;
    });
    const required = centers.map((center, i) => viewHeight(center, plannedAngles[i], total * i / flightSteps));
    // Raise and lower at a controlled rate, planning high ground far in advance.
    const heights = required.slice();
    for (let i = flightSteps - 1; i >= 0; i--) heights[i] = Math.max(heights[i], heights[i + 1] - 0.75);
    for (let i = 1; i <= flightSteps; i++) heights[i] = Math.max(heights[i], heights[i - 1] - 0.75);
    flightPath = centers.map((center, i) => ({ center, angle: plannedAngles[i], height: heights[i] + 3 }));
    buildFlightTimes();
  }
  function buildFlightTimes() {
    const view = savedHome ?? defaultHome;
    const homePosition = new THREE.Vector3(...view.position);
    const homeTarget = new THREE.Vector3(...view.target);
    const cameraPose = (i: number) => {
      const progress = i / flightSteps;
      const shot = flightShot(progress);
      const intro = THREE.MathUtils.smootherstep(progress, 0, introEnd);
      const target = homeTarget.clone().lerp(shot.center, intro);
      const position = homePosition.clone().lerp(new THREE.Vector3(
        shot.center.x + Math.sin(shot.angle) * orbitRadius,
        shot.height, shot.center.z + Math.cos(shot.angle) * orbitRadius), intro);
      return { position, target, direction: position.clone().sub(target).normalize() };
    };
    const motion: number[] = [];
    let previous = cameraPose(0);
    for (let i = 1; i <= flightSteps; i++) {
      const next = cameraPose(i);
      const turn = Math.acos(THREE.MathUtils.clamp(previous.direction.dot(next.direction), -1, 1));
      motion.push(Math.hypot(previous.position.distanceTo(next.position),
        previous.target.distanceTo(next.target) * 1.5, turn * 45, 3));
      previous = next;
    }
    // Fly the planned camera course at a near-uniform speed. The rider's
    // progress adapts to that course; neither GPS timing nor bend-by-bend
    // camera corrections can change the helicopter's motion.
    flightTimes = [0];
    for (let i = 0; i < flightSteps; i++) {
      let distance = 0, weightSum = 0;
      for (let j = Math.max(0, i - 12); j <= Math.min(flightSteps - 1, i + 12); j++) {
        const weight = 13 - Math.abs(i - j);
        distance += motion[j] * weight;
        weightSum += weight;
      }
      flightTimes.push(flightTimes[i] + distance / weightSum);
    }
    // Preserve the relative pacing while fitting the complete flight into 45 seconds.
    const totalMotion = flightTimes[flightSteps];
    flightTimes = flightTimes.map(time => time / totalMotion * followDuration);
  }
  function timeAtProgress(value: number) {
    if (!flightPath) buildFlightPath();
    if (value <= 0) return 0;
    if (value >= 1) return flightTimes[flightSteps];
    const at = THREE.MathUtils.clamp(value, 0, 1) * flightSteps;
    const i = Math.min(flightSteps - 1, Math.floor(at));
    const sample = (j: number) => j < 0 ? -flightTimes[1]
      : j > flightSteps ? 2 * flightTimes[flightSteps] - flightTimes[flightSteps - 1]
      : flightTimes[j];
    return splineValue(sample(i - 1), sample(i), sample(i + 1), sample(i + 2), at - i);
  }
  function progressAtTime(seconds: number) {
    if (seconds <= 0) return 0;
    if (seconds >= flightTimes[flightSteps]) return 1;
    let lo = 0, hi = 1;
    for (let step = 0; step < 20; step++) {
      const mid = (lo + hi) / 2;
      if (timeAtProgress(mid) < seconds) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  function flightShot(value: number) {
    if (!flightPath) buildFlightPath();
    const path = flightPath!;
    const at = THREE.MathUtils.clamp(value, 0, 1) * flightSteps;
    const i = Math.min(flightSteps - 1, Math.floor(at));
    const t = at - i;
    // A cubic B-spline keeps camera position, speed, and acceleration continuous.
    const a = path[Math.max(0, i - 1)], b = path[i];
    const c = path[i + 1], d = path[Math.min(flightSteps, i + 2)];
    const cubic = (v0: number, v1: number, v2: number, v3: number) => splineValue(v0, v1, v2, v3, t);
    return {
      center: new THREE.Vector3(
        cubic(a.center.x, b.center.x, c.center.x, d.center.x),
        cubic(a.center.y, b.center.y, c.center.y, d.center.y),
        cubic(a.center.z, b.center.z, c.center.z, d.center.z),
      ),
      angle: cubic(a.angle, b.angle, c.angle, d.angle),
      height: cubic(a.height, b.height, c.height, d.height),
    };
  }
  function followViewOffset() {
    const intro = THREE.MathUtils.smootherstep(progress, 0, introEnd);
    if (innerWidth > 700) {
      const cardLeft = $<HTMLElement>('ride-card').getBoundingClientRect().left;
      const returnLeg = 1 - 0.65 * THREE.MathUtils.smootherstep(progress, 0.72, 1);
      return { x: (innerWidth - cardLeft) * 0.6 * intro * returnLeg, y: 0 };
    }
    const clearBottom = Math.min($<HTMLElement>('compass').getBoundingClientRect().top,
      $<HTMLElement>('ride-card').getBoundingClientRect().top);
    const clearTop = $<HTMLElement>('masthead').getBoundingClientRect().bottom;
    const riderY = Math.min(innerHeight / 2, Math.max(clearTop + 24, (clearTop + clearBottom) / 2));
    return { x: 0, y: Math.max(0, innerHeight / 2 - riderY) * intro };
  }
  function frameRiderForMobile() {
    const offset = followViewOffset();
    camera.setViewOffset(innerWidth, innerHeight, offset.x, offset.y, innerWidth, innerHeight);
  }
  function followCameraPose(): CameraPose {
    const shot = flightShot(progress);
    const view = savedHome ?? defaultHome;
    const intro = THREE.MathUtils.smootherstep(progress, 0, introEnd);
    const offset = followViewOffset();
    return {
      target: new THREE.Vector3(...view.target).lerp(shot.center, intro),
      position: new THREE.Vector3(...view.position).lerp(new THREE.Vector3(
        shot.center.x + Math.sin(shot.angle) * orbitRadius,
        shot.height, shot.center.z + Math.cos(shot.angle) * orbitRadius), intro),
      zoom: THREE.MathUtils.lerp(view.zoom, 1.1, intro),
      offsetX: offset.x, offsetY: offset.y,
    };
  }
  function applyCameraPose(pose: CameraPose) {
    controls.target.copy(pose.target);
    camera.position.copy(pose.position);
    camera.zoom = pose.zoom;
    camera.setViewOffset(innerWidth, innerHeight, pose.offsetX, pose.offsetY, innerWidth, innerHeight);
    camera.updateProjectionMatrix();
    controls.update();
  }
  function positionFollowCamera() { applyCameraPose(followCameraPose()); }
  function startCameraTransition(to = followCameraPose(), trackFollow = true) {
    const from: CameraPose = {
      position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom,
      offsetX: camera.view?.enabled ? camera.view.offsetX : 0,
      offsetY: camera.view?.enabled ? camera.view.offsetY : 0,
    };
    // Drain manual inertia without moving the rendered starting pose.
    controls.enableDamping = false;
    controls.update();
    applyCameraPose(from);
    const fromOffset = from.position.clone().sub(from.target);
    const toOffset = to.position.clone().sub(to.target);
    const startAngle = Math.atan2(fromOffset.x, fromOffset.z);
    const endAngle = Math.atan2(toOffset.x, toOffset.z);
    const turn = Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle));
    const startRadius = Math.hypot(fromOffset.x, fromOffset.z);
    const distance = from.position.distanceTo(to.position);
    if (distance < 1e-6 && from.target.distanceTo(to.target) < 1e-6
      && Math.abs(from.zoom - to.zoom) < 1e-6
      && Math.hypot(from.offsetX - to.offsetX, from.offsetY - to.offsetY) < 1e-6) {
      cameraTransition = null;
      controls.enableDamping = false;
      return;
    }
    const duration = THREE.MathUtils.clamp(Math.max(Math.abs(turn) / 0.7, distance / 48), 1.2, 4.5);
    cameraTransition = { from, to, elapsed: 0, duration, leadTime: Math.min(1.4, duration * 0.4),
      startAngle, turn, startRadius, trackFollow };
  }
  function advanceCameraTransition(dt: number) {
    const transition = cameraTransition!;
    const before = transition.elapsed;
    transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
    // Let the rider start during the final part of the flight. The camera
    // blends into a moving target, so it never settles and restarts abruptly.
    const leadStart = transition.duration - transition.leadTime;
    const rideTime = Math.max(0, transition.elapsed - leadStart) - Math.max(0, before - leadStart);
    if (rideTime > 0 && transition.trackFollow && following && playing) {
      playbackTime += rideTime;
      setProgress(progressAtTime(playbackTime));
      play.textContent = 'Ⅱ Pause';
    }
    const to = transition.trackFollow && following && playing ? followCameraPose() : transition.to;
    const originalOffset = transition.to.position.clone().sub(transition.to.target);
    const toOffset = to.position.clone().sub(to.target);
    const originalAngle = Math.atan2(originalOffset.x, originalOffset.z);
    const toAngle = Math.atan2(toOffset.x, toOffset.z);
    const movingTurn = transition.turn + Math.atan2(
      Math.sin(toAngle - originalAngle), Math.cos(toAngle - originalAngle));
    const t = THREE.MathUtils.smootherstep(transition.elapsed / transition.duration, 0, 1);
    const target = transition.from.target.clone().lerp(to.target, t);
    const angle = transition.startAngle + movingTurn * t;
    const radius = THREE.MathUtils.lerp(transition.startRadius, Math.hypot(toOffset.x, toOffset.z), t);
    const height = THREE.MathUtils.lerp(
      transition.from.position.y - transition.from.target.y,
      to.position.y - to.target.y, t);
    applyCameraPose({
      target,
      position: target.clone().add(new THREE.Vector3(Math.sin(angle) * radius, height, Math.cos(angle) * radius)),
      zoom: THREE.MathUtils.lerp(transition.from.zoom, to.zoom, t),
      offsetX: THREE.MathUtils.lerp(transition.from.offsetX, to.offsetX, t),
      offsetY: THREE.MathUtils.lerp(transition.from.offsetY, to.offsetY, t),
    });
    if (transition.elapsed >= transition.duration) {
      cameraTransition = null;
      controls.enableDamping = false;
      if (playing) play.textContent = 'Ⅱ Pause';
    }
  }
  function setFollowing(enabled: boolean) {
    cameraTransition = null;
    controls.enableDamping = false;
    if (following === enabled) return;
    if (playing) play.textContent = 'Ⅱ Pause';
    following = enabled;
    followButton.setAttribute('aria-pressed', String(enabled));
    if (enabled) {
      flightPath = null;
      setProgress(0);
      playbackTime = 0;
      startCameraTransition();
    } else if (camera.view?.enabled) {
      // Bake the follow composition into the camera before removing the view
      // offset, so switching Follow off leaves the exact same pixels in place.
      camera.updateMatrixWorld();
      const before = new THREE.Vector3().unproject(camera);
      camera.clearViewOffset();
      const shift = before.sub(new THREE.Vector3().unproject(camera));
      camera.position.add(shift);
      controls.target.add(shift);
    }
  }
  function setProgress(value: number, revealRider = true) {
    progress = THREE.MathUtils.clamp(value, 0, 1);
    if (revealRider) rider.visible = true;
    const distance = progress * total;
    const { i, t, elevation } = sampleAt(progress);
    const position = points[i - 1].clone().lerp(points[i], t);
    rider.position.copy(position);
    rider.position.y += 0.1;
    const path = points.slice(0, i).concat(position).flatMap(p => [p.x, p.y, p.z]);
    const visible = path.length >= 6;
    active.visible = activeHalo.visible = visible;
    if (visible) { active.geometry.setPositions(path); activeHalo.geometry.setPositions(path); }
    overlap.visible = sharedStickPoints > 1 && i > returnStart;
    if (overlap.visible) {
      overlap.geometry.setPositions(points.slice(returnStart, i).concat(position).flatMap(p => [p.x, p.y, p.z]));
    }
    const x = chartX(distance).toFixed(2);
    progressLine.setAttribute('x1', x); progressLine.setAttribute('x2', x);
    progressDot.setAttribute('cx', x); progressDot.setAttribute('cy', chartY(elevation).toFixed(2));
    chart.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    chart.setAttribute('aria-valuetext', readout(progress, elevation));
    elevationReadout.textContent = readout(progress, elevation);
  }

  function valueAtPointer(event: PointerEvent) {
    const bounds = chart.getBoundingClientRect();
    return THREE.MathUtils.clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
  }
  chart.addEventListener('pointermove', event => {
    playing = false; cameraTransition = null; play.textContent = '▶ Play ride';
    setProgress(valueAtPointer(event));
  });
  chart.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    chart.setPointerCapture(event.pointerId);
    playing = false; cameraTransition = null; play.textContent = '▶ Play ride';
    setProgress(valueAtPointer(event));
  });
  chart.addEventListener('keydown', event => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? progress + step
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? progress - step
      : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null;
    if (next === null) return;
    event.preventDefault();
    playing = false; cameraTransition = null; play.textContent = '▶ Play ride';
    setProgress(next);
  });

  function resize() {
    const w = innerWidth, h = innerHeight, aspect = w / h;
    renderer.setSize(w, h, false);
    const pixelWidth = Math.round(w * renderer.getPixelRatio());
    const pixelHeight = Math.round(h * renderer.getPixelRatio());
    camera.left = -58 * aspect / 2; camera.right = 58 * aspect / 2;
    camera.top = 29; camera.bottom = -29; camera.updateProjectionMatrix();
    if (following && !cameraTransition) frameRiderForMobile();
    for (const line of [preview, previewCore, active, activeHalo, overlap]) line.material.resolution.set(pixelWidth, pixelHeight);
  }
  addEventListener('resize', resize);
  resize();
  const defaultHome: HomeView = {
    position: [-73.69087860310381, 69.64247192938878, -153.77908766318367],
    target: [-7.2191607049007676, -1.9999999999999996, -7.33110929236435],
    zoom: 1.273332761095871,
  };
  function readHome(): HomeView | null {
    try {
      const value = JSON.parse(localStorage.getItem(HOME_KEY) || 'null') as HomeView | null;
      if (!value || !Array.isArray(value.position) || !Array.isArray(value.target)) return null;
      if (value.position.length !== 3 || value.target.length !== 3 ||
          ![...value.position, ...value.target, value.zoom].every(Number.isFinite) ||
          value.zoom < controls.minZoom || value.zoom > controls.maxZoom) return null;
      return value;
    } catch { return null; }
  }
  const savedHome = readHome();
  function applyHome(view: HomeView, animate = true) {
    const pose: CameraPose = {
      position: new THREE.Vector3(...view.position), target: new THREE.Vector3(...view.target),
      zoom: view.zoom, offsetX: 0, offsetY: 0,
    };
    if (animate) startCameraTransition(pose, false);
    else applyCameraPose(pose);
  }
  function home() { applyHome(savedHome ?? defaultHome); }
  applyHome(savedHome ?? defaultHome, false);
  setProgress(1, false);
  followButton.addEventListener('click', () => setFollowing(!following));
  controls.addEventListener('start', () => setFollowing(false));
  play.addEventListener('click', () => {
    if (!playing) {
      if (progress >= 1) setProgress(0);
      if (following) {
        playbackTime = timeAtProgress(progress);
        startCameraTransition();
      }
    } else cameraTransition = null;
    playing = !playing;
    play.textContent = playing ? cameraTransition ? 'Ⅱ Positioning…' : 'Ⅱ Pause' : '▶ Play ride';
  });
  type ViewMotion = 'left' | 'right' | 'up' | 'down';
  let heldMotion: ViewMotion | null = null;
  let heldButton: HTMLButtonElement | null = null;
  let heldPointerId: number | null = null;
  function stopViewMotion(button?: HTMLButtonElement) {
    if (button && heldButton !== button) return;
    heldButton?.classList.remove('is-pressed');
    heldButton = null;
    heldMotion = null;
    heldPointerId = null;
  }
  function startViewMotion(button: HTMLButtonElement, motion: ViewMotion) {
    setFollowing(false);
    stopViewMotion();
    heldButton = button;
    heldMotion = motion;
    button.classList.add('is-pressed');
  }
  function moveView(motion: ViewMotion, seconds: number) {
    const angle = THREE.MathUtils.degToRad((motion === 'left' || motion === 'right' ? 65 : 40) * seconds);
    if (motion === 'left') controls.rotateLeft(angle);
    else if (motion === 'right') controls.rotateLeft(-angle);
    else if (motion === 'up') controls.rotateUp(angle);
    else controls.rotateUp(-angle);
  }
  for (const [id, motion] of [
    ['rotate-left', 'left'], ['rotate-right', 'right'], ['tilt-up', 'up'], ['tilt-down', 'down'],
  ] as const) {
    const button = $<HTMLButtonElement>(id);
    let lastKeyboardRelease = -Infinity;
    button.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      startViewMotion(button, motion);
      heldPointerId = event.pointerId;
    });
    button.addEventListener('pointerup', event => {
      if (heldPointerId === event.pointerId) stopViewMotion(button);
    });
    button.addEventListener('pointercancel', () => stopViewMotion(button));
    button.addEventListener('lostpointercapture', () => stopViewMotion(button));
    button.addEventListener('keydown', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (!event.repeat) startViewMotion(button, motion);
    });
    button.addEventListener('keyup', event => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        lastKeyboardRelease = performance.now();
        stopViewMotion(button);
      }
    });
    button.addEventListener('blur', () => stopViewMotion(button));
    // Assistive technology can activate a button without a held pointer or key.
    button.addEventListener('click', event => {
      if (event.detail === 0 && performance.now() - lastKeyboardRelease > 250) moveView(motion, 0.25);
    });
  }
  window.addEventListener('blur', () => stopViewMotion());
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopViewMotion(); });
  function compassPointsNorth() {
    const destination = cameraTransition && !cameraTransition.trackFollow ? cameraTransition.to : null;
    const offset = (destination?.position ?? camera.position).clone().sub(destination?.target ?? controls.target);
    return Math.abs(Math.atan2(offset.x, offset.z)) < THREE.MathUtils.degToRad(1);
  }
  compassCenter.addEventListener('click', () => {
    const returnHome = compassPointsNorth();
    setFollowing(false);
    if (returnHome) {
      home();
      return;
    }
    const radius = camera.position.clone().sub(controls.target).length();
    startCameraTransition({
      position: controls.target.clone().add(new THREE.Vector3(0, radius * 0.7, radius * 0.7)),
      target: controls.target.clone(), zoom: camera.zoom, offsetX: 0, offsetY: 0,
    }, false);
  });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealProgress = pois.flags.map(() => 0);
  let hoveredFlag = -1;
  let selectedFlag = -1;
  const flagRaycaster = new THREE.Raycaster();
  const flagPointer = new THREE.Vector2();
  function labelAt(clientX: number, clientY: number) {
    const bounds = renderer.domElement.getBoundingClientRect();
    flagPointer.set(2 * (clientX - bounds.left) / bounds.width - 1, 1 - 2 * (clientY - bounds.top) / bounds.height);
    flagRaycaster.setFromCamera(flagPointer, camera);
    for (let i = 0; i < pois.flags.length; i++) {
      const { label } = pois.flags[i];
      if (!label.visible) continue;
      const hit = flagRaycaster.intersectObject(label)[0];
      if (!hit) continue;
      // The flag can be hidden by the terrain even while its mesh is visible.
      const terrainHit = flagRaycaster.intersectObject(landscape.group.children[0])[0];
      if (!terrainHit || terrainHit.distance >= hit.distance) return i;
    }
    return -1;
  }
  function flagAt(clientX: number, clientY: number) {
    const bounds = renderer.domElement.getBoundingClientRect();
    const x = clientX - bounds.left, y = clientY - bounds.top;
    for (let i = 0; i < pois.flags.length; i++) {
      const p = pois.flags[i].marker.position.clone().add(new THREE.Vector3(0, 1.2, 0)).project(camera);
      const sx = (p.x + 1) * bounds.width / 2;
      const sy = (1 - p.y) * bounds.height / 2;
      if (Math.hypot(x - sx, y - sy) < 32) return i;
    }
    return -1;
  }
  function hoveredFlagAt(clientX: number, clientY: number) {
    const labelIndex = labelAt(clientX, clientY);
    return labelIndex >= 0 ? labelIndex : flagAt(clientX, clientY);
  }
  renderer.domElement.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const index = hoveredFlagAt(event.clientX, event.clientY);
    hoveredFlag = index;
    renderer.domElement.style.cursor = index >= 0 ? 'pointer' : '';
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    hoveredFlag = -1;
    renderer.domElement.style.cursor = '';
  });
  let pressedFlag = -1;
  let pressedX = 0, pressedY = 0;
  renderer.domElement.addEventListener('pointerdown', event => {
    const index = hoveredFlagAt(event.clientX, event.clientY);
    if (index >= 0 && revealProgress[index] >= 0.98 && pois.flags[index].url) {
      pressedFlag = index;
      pressedX = event.clientX;
      pressedY = event.clientY;
      return;
    }
    if (event.pointerType !== 'mouse' && index >= 0) selectedFlag = index === selectedFlag ? -1 : index;
  });
  renderer.domElement.addEventListener('pointerup', event => {
    if (pressedFlag >= 0 && Math.hypot(event.clientX - pressedX, event.clientY - pressedY) < 8
      && hoveredFlagAt(event.clientX, event.clientY) === pressedFlag) {
      window.open(pois.flags[pressedFlag].url!, '_blank', 'noopener,noreferrer');
    }
    pressedFlag = -1;
  });
  renderer.domElement.addEventListener('pointercancel', () => { pressedFlag = -1; });
  $('loading').remove();
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const transitioning = cameraTransition !== null;
    if (transitioning) advanceCameraTransition(dt);
    if (playing && !(transitioning && following)) {
      if (following) {
        playbackTime += dt;
        setProgress(progressAtTime(playbackTime));
      } else setProgress(progress + dt / 38);
      if (progress >= 1) { playing = false; play.textContent = '↺ Replay ride'; }
    }
    if (!transitioning && following && playing) {
      positionFollowCamera();
    } else if (!transitioning) {
      if (heldMotion) moveView(heldMotion, dt);
      controls.update();
    }
    // Keep the diorama names readable without letting them fill the screen when zoomed in.
    const labelScale = Math.min(1, 1.8 / camera.zoom);
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    compassNeedle.style.transform = `rotate(${Math.atan2(-screenRight.z, -screenUp.z)}rad)`;
    const compassAction = compassPointsNorth() ? 'Go to home view' : 'Face north';
    if (compassCenter.title !== compassAction) {
      compassCenter.title = compassAction;
      compassCenter.setAttribute('aria-label', compassAction);
    }
    for (let i = 0; i < pois.flags.length; i++) {
      const { pole, pennant, label, isPeak } = pois.flags[i];
      const active = hoveredFlag === i || selectedFlag === i;
      revealProgress[i] = reducedMotion ? Number(active) : THREE.MathUtils.clamp(
        revealProgress[i] + (active ? 1 : -1) * dt / 1.25, 0, 1,
      );
      // The small flag returns only after the pole has finished lowering.
      const detached = 1 - (1 - THREE.MathUtils.clamp(revealProgress[i] / 0.35, 0, 1)) ** 2;
      const smallFlagReveal = 1 - detached;
      pennant.visible = smallFlagReveal > 0.001;
      pennant.quaternion.copy(camera.quaternion);
      pennant.position.copy(screenRight).multiplyScalar(2.1 * detached).addScaledVector(screenUp, 1.0 * detached);
      pennant.position.y += 1.75;
      pennant.scale.x = smallFlagReveal;
      (pennant.material as THREE.MeshBasicMaterial).opacity = smallFlagReveal;
      const raised = 1 - (1 - THREE.MathUtils.clamp((revealProgress[i] - 0.35) / 0.27, 0, 1)) ** 3;
      const poleHeight = 1.75 + 1.45 * raised;
      pole.scale.y = poleHeight;
      pole.position.y = poleHeight / 2;
      const unfurl = THREE.MathUtils.clamp((revealProgress[i] - 0.64) / 0.36, 0, 1);
      const reveal = 1 - (1 - unfurl) ** 3;
      const width = (isPeak ? 11.6 : 10.5) * labelScale;
      const height = 1.97 * labelScale;
      label.visible = reveal > 0.001;
      label.quaternion.copy(camera.quaternion);
      // Grow the new banner from its hoist edge at the raised pole.
      label.material.map!.repeat.x = reveal;
      label.material.map!.updateMatrix();
      label.scale.set(width * reveal, height, 1);
      label.position.copy(screenRight).multiplyScalar(0.12 + width * reveal / 2).addScaledVector(screenUp, -height / 2);
      label.position.y += poleHeight;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(error => { console.error(error); $<HTMLElement>('loading').textContent = 'Could not load the ride map. Check the browser console.'; });
