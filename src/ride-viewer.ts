import './setup';
import { createFlightPlan } from './ride-flight-plan';
import { frameApproachTarget } from './ride-approach';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRideRoute } from './ride-route';
import { EXAGGERATION, LAKE_LEVEL, Terrain, WORLD_SCALE, toWorld, type MapData } from './data';
import { buildLandscape } from './terrain';
import { BANNER_HEIGHT, PENNANT_CENTER, buildPOIs, shapeBanner, type LoosePiece, type POI } from './pois';

type Ride = { id: number; date: string; points: [number, number, number][] };
type HomeView = { position: [number, number, number]; target: [number, number, number]; zoom: number };

export type RideViewerOptions = {
  root?: ParentNode;
  data: { map: MapData; ride: Ride; heights: ArrayBuffer };
  home: HomeView;
  entryView?: HomeView;
  entryContext?: { group: THREE.Group; update(progress: number): void; dispose(): void };
  onEntryComplete?: () => void;
  homeStorageKey?: string | null;
  pointsOfInterest?: POI[];
  baseElevation?: number;
  scale?: number;
  angleBeats?: [number, number][];
  manageLoading?: boolean;
};

// Both the standalone Beckwourth app and the regional guide mount this renderer.
export async function mountRideViewer(options: RideViewerOptions) {
  const root = options.root ?? document;
  const $ = <T extends Element>(id: string) => root.querySelector(`[id="${id}"]`) as T;
  const lifecycle = new AbortController();
  const on = <K extends keyof (GlobalEventHandlersEventMap & DocumentEventMap)>(target: EventTarget, type: K,
    listener: (event: (GlobalEventHandlersEventMap & DocumentEventMap)[K]) => void) =>
    target.addEventListener(type, listener as EventListener, { signal: lifecycle.signal });
  const { map, ride, heights } = options.data;
  const terrain = new Terrain(map, new Uint16Array(heights));
  const renderer = new THREE.WebGLRenderer({ canvas: $<HTMLCanvasElement>('scene'), antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6efe0');
  const entryDuration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 3.4;
  let entryElapsed = 0, entering = !!options.entryView;
  if (options.entryContext) scene.add(options.entryContext.group);
  const landscape = buildLandscape(terrain, { trees: false, baseElevation: options.baseElevation });
  scene.add(landscape.group);
  // Reveal the detailed ground at the same location as the departing regional
  // surface, without dissolving the entire canvas into an empty background.
  const groundMaterials = landscape.group.children.map(child => (child as THREE.Mesh).material as THREE.ShaderMaterial);
  if (options.entryContext) for (const material of groundMaterials) {
    material.uniforms.uArrival = { value: 0 };
    material.fragmentShader = 'uniform float uArrival;\n' + material.fragmentShader.replace(/}\s*$/, 'gl_FragColor.a *= uArrival;\n}');
    material.transparent = true;
  }
  const pois = buildPOIs(map, terrain, options.pointsOfInterest, options.baseElevation);
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
  const { preview, previewCore, activeHalo, active, overlap, rider } = createRideRoute(scene, points);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  // Manual navigation tracks input directly; scripted camera moves ease separately.
  controls.enableDamping = false;
  controls.panSpeed = 1.6;
  controls.zoomSpeed = 1.4;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.minZoom = Math.min(0.65, options.entryView?.zoom ?? 0.65);
  controls.maxZoom = 22;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.35;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.target.set(0, -2, 0);
  camera.position.set(100, 105, 100);
  camera.lookAt(controls.target);

  const play = $<HTMLButtonElement>('play');
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
  const viewScale = options.scale ?? 1;
  const orbitRadius = 90 * viewScale;
  const introEnd = 0.25;
  type CameraPose = { position: THREE.Vector3; target: THREE.Vector3; zoom: number; offsetX: number; offsetY: number };
  type CameraTransition = {
    from: CameraPose; to: CameraPose; elapsed: number; duration: number; leadTime: number;
    startAngle: number; turn: number; startRadius: number; trackFollow: boolean;
  };
  let playbackTime = 0;
  let cameraTransition: CameraTransition | null = null;
  const { flightShot, timeAtProgress, progressAtTime, invalidate } = createFlightPlan({
    total, routePoint, clearSightHeight, orbitRadius, viewScale, introEnd,
    getHome: () => savedHome ?? defaultHome, angleBeats: options.angleBeats,
  });
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
  function startCameraTransition(to = followCameraPose(), trackFollow = true, durationOverride?: number) {
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
    const duration = durationOverride ?? THREE.MathUtils.clamp(Math.max(Math.abs(turn) / 0.7, distance / 48), 1.2, 4.5);
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
    if (rideTime > 0 && transition.trackFollow && playing) {
      playbackTime += rideTime;
      setProgress(progressAtTime(playbackTime));
      play.textContent = 'Ⅱ Pause';
    }
    const to = transition.trackFollow && playing ? followCameraPose() : transition.to;
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
    const zoom = entering ? Math.exp(THREE.MathUtils.lerp(Math.log(transition.from.zoom), Math.log(to.zoom), t))
      : THREE.MathUtils.lerp(transition.from.zoom, to.zoom, t);
    const offset = new THREE.Vector3(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
    if (entering) {
      // Interpolate the destination's SCREEN position as we magnify it. A
      // world-space target lerp lets the mountain leave the viewport mid-flight
      // because magnification overtakes the pan (especially on a tall screen).
      frameApproachTarget(target, offset, zoom, t, transition.from, to.target, camera.up);
    }
    applyCameraPose({
      target,
      position: target.clone().add(offset),
      // Constant multiplicative zoom avoids rushing most of the magnification
      // into the first part of a regional-to-ride approach.
      zoom,
      offsetX: THREE.MathUtils.lerp(transition.from.offsetX, to.offsetX, t),
      offsetY: THREE.MathUtils.lerp(transition.from.offsetY, to.offsetY, t),
    });
    if (transition.elapsed >= transition.duration) {
      cameraTransition = null;
      controls.enableDamping = false;
      controls.minZoom = 0.65;
      if (playing) play.textContent = 'Ⅱ Pause';
    }
  }
  function pauseForManualView() {
    playing = false;
    cameraTransition = null;
    play.textContent = '▶ Play Ride';
    if (camera.view?.enabled) {
      // Preserve the current composition when handing control back to the viewer.
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
  on(chart, 'pointermove', event => {
    if (playing || entering) return;
    playing = false; cameraTransition = null; play.textContent = '▶ Play Ride';
    setProgress(valueAtPointer(event));
  });
  on(chart, 'pointerdown', event => {
    if (playing || entering || event.button !== 0) return;
    event.preventDefault();
    chart.setPointerCapture(event.pointerId);
    playing = false; cameraTransition = null; play.textContent = '▶ Play Ride';
    setProgress(valueAtPointer(event));
  });
  on(chart, 'keydown', event => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? progress + step
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? progress - step
      : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null;
    if (next === null) return;
    event.preventDefault();
    if (playing || entering) return;
    playing = false; cameraTransition = null; play.textContent = '▶ Play Ride';
    setProgress(next);
  });

  function resize() {
    const w = innerWidth, h = innerHeight, aspect = w / h;
    renderer.setSize(w, h, false);
    const pixelWidth = Math.round(w * renderer.getPixelRatio());
    const pixelHeight = Math.round(h * renderer.getPixelRatio());
    camera.left = -58 * viewScale * aspect / 2; camera.right = 58 * viewScale * aspect / 2;
    camera.top = 29 * viewScale; camera.bottom = -29 * viewScale; camera.updateProjectionMatrix();
    if (playing && !cameraTransition) frameRiderForMobile();
    for (const line of [preview, previewCore, active, activeHalo, overlap]) line.material.resolution.set(pixelWidth, pixelHeight);
  }
  on(window, 'resize', resize);
  resize();
  const defaultHome = options.home;
  function readHome(): HomeView | null {
    try {
      const value = JSON.parse(localStorage.getItem(options.homeStorageKey!) || 'null') as HomeView | null;
      if (!value || !Array.isArray(value.position) || !Array.isArray(value.target)) return null;
      if (value.position.length !== 3 || value.target.length !== 3 ||
          ![...value.position, ...value.target, value.zoom].every(Number.isFinite) ||
          value.zoom < controls.minZoom || value.zoom > controls.maxZoom) return null;
      return value;
    } catch { return null; }
  }
  let savedHome = options.homeStorageKey ? readHome() : null;
  function applyHome(view: HomeView, animate = true) {
    const pose: CameraPose = {
      position: new THREE.Vector3(...view.position), target: new THREE.Vector3(...view.target),
      zoom: view.zoom, offsetX: 0, offsetY: 0,
    };
    if (animate) startCameraTransition(pose, false);
    else applyCameraPose(pose);
  }
  function home() { applyHome(savedHome ?? defaultHome); }
  applyHome(options.entryView ?? savedHome ?? defaultHome, false);
  if (options.entryView) {
    const view = savedHome ?? defaultHome;
    startCameraTransition({ position: new THREE.Vector3(...view.position), target: new THREE.Vector3(...view.target),
      zoom: view.zoom, offsetX: 0, offsetY: 0 }, false, entryDuration);
  }
  controls.enabled = !entering;
  setProgress(1, false);
  controls.addEventListener('start', pauseForManualView);
  on(play, 'click', () => {
    if (!playing) {
      if (progress >= 1) setProgress(0);
      stopViewMotion();
      playbackTime = timeAtProgress(progress);
      startCameraTransition();
    } else cameraTransition = null;
    playing = !playing;
    play.textContent = playing ? 'Ⅱ Pause' : '▶ Play Ride';
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
    pauseForManualView();
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
    on(button, 'pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      startViewMotion(button, motion);
      heldPointerId = event.pointerId;
    });
    on(button, 'pointerup', event => {
      if (heldPointerId === event.pointerId) stopViewMotion(button);
    });
    on(button, 'pointercancel', () => stopViewMotion(button));
    on(button, 'lostpointercapture', () => stopViewMotion(button));
    on(button, 'keydown', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (!event.repeat) startViewMotion(button, motion);
    });
    on(button, 'keyup', event => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        lastKeyboardRelease = performance.now();
        stopViewMotion(button);
      }
    });
    on(button, 'blur', () => stopViewMotion(button));
    // Assistive technology can activate a button without a held pointer or key.
    on(button, 'click', event => {
      if (event.detail === 0 && performance.now() - lastKeyboardRelease > 250) moveView(motion, 0.25);
    });
  }
  on(window, 'blur', () => stopViewMotion());
  on(document, 'visibilitychange', () => { if (document.hidden) stopViewMotion(); });
  function compassPointsNorth() {
    const destination = cameraTransition && !cameraTransition.trackFollow ? cameraTransition.to : null;
    const offset = (destination?.position ?? camera.position).clone().sub(destination?.target ?? controls.target);
    return Math.abs(Math.atan2(offset.x, offset.z)) < THREE.MathUtils.degToRad(1);
  }
  on(compassCenter, 'click', () => {
    const returnHome = compassPointsNorth();
    pauseForManualView();
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
  // Hovering blows the small pennant off like a leaf; it regrows once the pole is back down.
  const pennantGrowth = pois.flags.map(() => 1);
  // Moving off a flag blows its banner away too, while the pole drops and the pennant regrows.
  const bannerGone = pois.flags.map(() => false);
  // Reuse whichever loose piece has been out the longest (idle ones count as forever).
  const idlest = (pieces: LoosePiece[]) => pieces.reduce((a, b) => b.age > a.age ? b : a);
  let flagsFacing = false;
  const toViewer = new THREE.Vector3();
  const easeOutBack = (x: number, overshoot = 1.4) => 1 + (overshoot + 1) * (x - 1) ** 3 + overshoot * (x - 1) ** 2;
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
  on(renderer.domElement, 'pointermove', event => {
    if (event.pointerType === 'touch') return;
    const index = hoveredFlagAt(event.clientX, event.clientY);
    hoveredFlag = index;
    renderer.domElement.style.cursor = index >= 0 ? 'pointer' : '';
  });
  on(renderer.domElement, 'pointerleave', () => {
    hoveredFlag = -1;
    renderer.domElement.style.cursor = '';
  });
  let pressedFlag = -1;
  let pressedX = 0, pressedY = 0;
  on(renderer.domElement, 'pointerdown', event => {
    const index = hoveredFlagAt(event.clientX, event.clientY);
    if (index >= 0 && revealProgress[index] >= 0.98 && pois.flags[index].url) {
      pressedFlag = index;
      pressedX = event.clientX;
      pressedY = event.clientY;
      return;
    }
    if (event.pointerType !== 'mouse' && index >= 0) selectedFlag = index === selectedFlag ? -1 : index;
  });
  on(renderer.domElement, 'pointerup', event => {
    if (pressedFlag >= 0 && Math.hypot(event.clientX - pressedX, event.clientY - pressedY) < 8
      && hoveredFlagAt(event.clientX, event.clientY) === pressedFlag) {
      window.open(pois.flags[pressedFlag].url!, '_blank', 'noopener,noreferrer');
    }
    pressedFlag = -1;
  });
  on(renderer.domElement, 'pointercancel', () => { pressedFlag = -1; });
  if (options.manageLoading !== false) $('loading').remove();
  let disposed = false, animation = 0;
  function frame(now: number) {
    if (disposed) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (entering) {
      entryElapsed = Math.min(entryDuration, entryElapsed + dt);
      const progress = entryElapsed / entryDuration;
      options.entryContext?.update(progress);
      if (options.entryContext) for (const material of groundMaterials) material.uniforms.uArrival.value = THREE.MathUtils.smootherstep(progress, 0, 0.22);
    }
    const transitioning = cameraTransition !== null;
    if (transitioning) advanceCameraTransition(dt);
    if (entering && entryElapsed >= entryDuration) {
      entering = false; controls.enabled = true;
      options.entryContext?.dispose();
      if (options.entryContext) for (const material of groundMaterials) material.transparent = false;
      options.onEntryComplete?.();
    }
    if (playing && !transitioning) {
      playbackTime += dt;
      setProgress(progressAtTime(playbackTime));
      if (progress >= 1) { playing = false; play.textContent = '↺ Replay Ride'; }
    }
    if (!transitioning && playing) {
      positionFollowCamera();
    } else if (!transitioning) {
      if (heldMotion) moveView(heldMotion, dt);
      controls.update();
    }
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    compassNeedle.style.transform = `rotate(${Math.atan2(-screenRight.z, -screenUp.z)}rad)`;
    const compassAction = compassPointsNorth() ? 'Go to home view' : 'Face north';
    if (compassCenter.title !== compassAction) {
      compassCenter.title = compassAction;
      compassCenter.setAttribute('aria-label', compassAction);
    }
    // Flags turn their faces toward the viewer like slow weathervanes, snapping
    // straight to it on the first frame.
    camera.getWorldDirection(toViewer).negate();
    const viewerYaw = Math.hypot(toViewer.x, toViewer.z) > 1e-3 ? Math.atan2(toViewer.x, toViewer.z) : null;
    for (let i = 0; i < pois.flags.length; i++) {
      const { marker, pole, pennant, label, leaves, looseBanners, bannerWidth: width } = pois.flags[i];
      const active = hoveredFlag === i || selectedFlag === i;
      if (viewerYaw !== null) {
        const turn = Math.atan2(Math.sin(viewerYaw - marker.rotation.y), Math.cos(viewerYaw - marker.rotation.y));
        // Swing round quickly while the big flag is out so its label reads straight on.
        marker.rotation.y += reducedMotion || !flagsFacing ? turn : turn * (1 - Math.exp(-dt / (active ? 0.18 : 1.6)));
      }
      if (active && pennantGrowth[i] > 0) {
        if (!reducedMotion) {
          const leaf = idlest(leaves);
          leaf.launch(marker.position, marker.rotation.y, new THREE.Vector3(PENNANT_CENTER.x * pennant.scale.x, 1.75 + PENNANT_CENTER.y, 0));
          leaf.offset.scale.x = pennant.scale.x;
        }
        pennantGrowth[i] = 0;
      }
      if (active && bannerGone[i]) {
        // Unfurl a fresh banner from the top of the pole, which is still raised here.
        revealProgress[i] = Math.min(revealProgress[i], 0.25);
        bannerGone[i] = false;
      }
      revealProgress[i] = reducedMotion ? Number(active) : THREE.MathUtils.clamp(
        revealProgress[i] + (active ? dt / 0.9 : -dt / 1.1), 0, 1,
      );
      if (!active && revealProgress[i] === 0 && pennantGrowth[i] < 1) {
        pennantGrowth[i] = reducedMotion ? 1 : Math.min(1, pennantGrowth[i] + dt / 0.5);
      }
      pennant.visible = pennantGrowth[i] > 0.001;
      pennant.scale.x = easeOutBack(pennantGrowth[i]);
      pennant.material.opacity = Math.min(1, pennantGrowth[i] * 3);

      for (const leaf of leaves) leaf.update(dt, now / 1000);

      const raised = easeOutBack(THREE.MathUtils.clamp((revealProgress[i] - 0.05) / 0.35, 0, 1), 1.1);
      const poleHeight = 1.75 + 1.45 * raised;
      pole.scale.y = poleHeight;
      pole.position.y = poleHeight / 2;
      const unfurl = THREE.MathUtils.clamp((revealProgress[i] - 0.25) / 0.75, 0, 1);
      const reveal = 1 - (1 - unfurl) ** 3;
      const height = BANNER_HEIGHT;
      if (!active && label.visible && !bannerGone[i] && !reducedMotion) {
        const banner = idlest(looseBanners);
        const length = width * reveal;
        banner.launch(marker.position, marker.rotation.y, new THREE.Vector3(0.12 + length / 2, poleHeight - height / 2, 0));
        banner.offset.position.x = -length / 2;
        banner.shape = (loose, time) => shapeBanner(banner.source, width, height, reveal, time, false, 0.35 * loose);
        bannerGone[i] = true;
        // Skip furling: the pole starts lowering as soon as the banner is gone.
        revealProgress[i] = Math.min(revealProgress[i], 0.4);
      }
      if (bannerGone[i] && revealProgress[i] <= 0.25) bannerGone[i] = false;
      for (const banner of looseBanners) banner.update(dt, now / 1000);
      label.visible = reveal > 0.001 && !bannerGone[i];
      if (label.visible) {
        shapeBanner(label.geometry, width, height, reveal, now / 1000, reducedMotion);
        label.material.opacity = Math.min(1, reveal * 5);
        label.position.set(0.12, poleHeight - height / 2, 0);
      }
    }
    flagsFacing = true;
    renderer.render(scene, camera);
    animation = requestAnimationFrame(frame);
  }
  // Compile and draw the exact starting view before the host reveals this canvas.
  // Loading GPU programs must not consume the approach animation's first beats.
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  last = performance.now();
  animation = requestAnimationFrame(frame);
  return {
    captureHome(): HomeView {
      // Clear playback framing without changing the visible camera composition.
      pauseForManualView();
      return { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom };
    },
    setHome(view: HomeView) {
      savedHome = { position: [...view.position], target: [...view.target], zoom: view.zoom };
      invalidate();
    },
    goHome() { pauseForManualView(); home(); },
    dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animation);
    lifecycle.abort();
    controls.dispose();
    // The regional meshes are borrowed, so detach them before disposing ride assets.
    options.entryContext?.dispose();
    const textures = new Set<THREE.Texture>();
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      for (const material of mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        if (material instanceof THREE.ShaderMaterial) for (const uniform of Object.values(material.uniforms)) {
          if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
        }
        material.dispose();
      }
    });
    textures.forEach(texture => texture.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  }};
}
