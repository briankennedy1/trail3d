import './setup';
import './beckwourth.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Terrain, toWorld, type MapData } from './data';
import { buildLandscape } from './terrain';
import { buildPOIs } from './pois';
import { POST_FRAG, POST_VERT } from './shaders';

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
  const renderer = new THREE.WebGLRenderer({ canvas: $<HTMLCanvasElement>('scene'), antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6efe0');
  const landscape = buildLandscape(terrain, { trees: false });
  scene.add(landscape.group);
  const pois = buildPOIs(map, terrain);
  // Render POIs after the watercolor pass so their type and edges stay crisp.
  // Reuse the terrain geometry as depth-only occluders in that final pass.
  const poiScene = new THREE.Scene();
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  for (const mesh of landscape.group.children as THREE.Mesh[]) {
    poiScene.add(new THREE.Mesh(mesh.geometry, depthOnly));
  }
  poiScene.add(pois.group);

  const points = ride.points.map(([x, y]) => new THREE.Vector3(...toWorld(map, x, y, terrain.heightAt(x, y) + 5)));
  const distances = [0];
  for (let i = 1; i < ride.points.length; i++) {
    const a = ride.points[i - 1], b = ride.points[i];
    distances.push(distances.at(-1)! + Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
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
  const rider = new THREE.Group();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.196, 16, 12), new THREE.MeshBasicMaterial({ color: '#0ba86b', depthTest: true }));
  rider.add(dot);
  rider.renderOrder = 24;
  scene.add(rider);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
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

  const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const post = new THREE.ShaderMaterial({ vertexShader: POST_VERT, fragmentShader: POST_FRAG, uniforms: {
    tColor: { value: target.texture }, uResolution: { value: new THREE.Vector2() }, uPixelRatio: { value: renderer.getPixelRatio() },
  }, depthTest: false, depthWrite: false });
  const postScene = new THREE.Scene();
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const play = $<HTMLButtonElement>('play');
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

  function sampleAt(value: number) {
    const distance = THREE.MathUtils.clamp(value, 0, 1) * total;
    let lo = 0, hi = distances.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (distances[mid] < distance) lo = mid + 1; else hi = mid; }
    const i = Math.max(1, lo);
    const t = THREE.MathUtils.clamp((distance - distances[i - 1]) / Math.max(1, distances[i] - distances[i - 1]), 0, 1);
    return { i, t, elevation: THREE.MathUtils.lerp(elevations[i - 1], elevations[i], t) };
  }
  const feet = (meters: number) => `${Math.round(meters * 3.28084).toLocaleString()} ft`;
  const readout = (value: number, elevation: number) => `${feet(elevation)} · ${(value * totalMiles).toFixed(1)} mi`;
  function setProgress(value: number) {
    progress = THREE.MathUtils.clamp(value, 0, 1);
    const distance = progress * total;
    const { i, t, elevation } = sampleAt(progress);
    const position = points[i - 1].clone().lerp(points[i], t);
    rider.position.copy(position);
    const path = points.slice(0, i).concat(position).flatMap(p => [p.x, p.y, p.z]);
    const visible = path.length >= 6;
    active.visible = activeHalo.visible = visible;
    if (visible) { active.geometry.setPositions(path); activeHalo.geometry.setPositions(path); }
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
    playing = false; play.textContent = '▶ Play ride';
    setProgress(valueAtPointer(event));
  });
  chart.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    chart.setPointerCapture(event.pointerId);
    playing = false; play.textContent = '▶ Play ride';
    setProgress(valueAtPointer(event));
  });
  chart.addEventListener('keydown', event => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? progress + step
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? progress - step
      : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null;
    if (next === null) return;
    event.preventDefault();
    playing = false; play.textContent = '▶ Play ride';
    setProgress(next);
  });

  function resize() {
    const w = innerWidth, h = innerHeight, aspect = w / h;
    renderer.setSize(w, h, false);
    target.setSize(Math.round(w * renderer.getPixelRatio()), Math.round(h * renderer.getPixelRatio()));
    post.uniforms.uResolution.value.set(target.width, target.height);
    camera.left = -58 * aspect / 2; camera.right = 58 * aspect / 2;
    camera.top = 29; camera.bottom = -29; camera.updateProjectionMatrix();
    for (const line of [preview, previewCore, active, activeHalo]) line.material.resolution.set(target.width, target.height);
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
  let savedHome = readHome();
  const settingsButton = $<HTMLButtonElement>('settings');
  const settingsMenu = $<HTMLDivElement>('view-settings');
  const setHomeButton = $<HTMLButtonElement>('set-home');
  const clearHomeButton = $<HTMLButtonElement>('clear-home');
  const homeStatus = $<HTMLSpanElement>('home-status');
  function setSettingsOpen(open: boolean) {
    settingsMenu.hidden = !open;
    settingsButton.setAttribute('aria-expanded', String(open));
    if (open) homeStatus.hidden = true;
  }
  settingsButton.addEventListener('click', () => setSettingsOpen(settingsMenu.hasAttribute('hidden')));
  document.addEventListener('pointerdown', event => {
    if (!settingsMenu.hidden && !settingsButton.closest('.map-controls')?.contains(event.target as Node)) setSettingsOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !settingsMenu.hidden) {
      setSettingsOpen(false);
      settingsButton.focus();
    }
  });
  let statusTimer = 0;
  function status(message: string) {
    homeStatus.textContent = message;
    homeStatus.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => { homeStatus.hidden = true; }, 2200);
  }
  function applyHome(view: HomeView) {
    controls.enableDamping = false;
    controls.target.fromArray(view.target);
    camera.position.fromArray(view.position);
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
    controls.update();
    controls.enableDamping = true;
  }
  function home() { applyHome(savedHome ?? defaultHome); }
  clearHomeButton.hidden = !savedHome;
  home();
  setProgress(1);
  play.addEventListener('click', () => {
    if (progress >= 1) setProgress(0);
    playing = !playing;
    play.textContent = playing ? 'Ⅱ Pause' : '▶ Play ride';
  });
  $('home').addEventListener('click', () => { setSettingsOpen(false); home(); });
  setHomeButton.addEventListener('click', () => {
    savedHome = {
      position: camera.position.toArray() as HomeView['position'],
      target: controls.target.toArray() as HomeView['target'],
      zoom: camera.zoom,
    };
    setSettingsOpen(false);
    try { localStorage.setItem(HOME_KEY, JSON.stringify(savedHome)); status('Home view saved'); }
    catch { status('Home saved for this session'); }
    clearHomeButton.hidden = false;
  });
  clearHomeButton.addEventListener('click', () => {
    savedHome = null;
    setSettingsOpen(false);
    try { localStorage.removeItem(HOME_KEY); } catch { /* session-only home */ }
    clearHomeButton.hidden = true;
    applyHome(defaultHome);
    status('Default home restored');
  });
  $('north').addEventListener('click', () => {
    setSettingsOpen(false);
    const radius = camera.position.clone().sub(controls.target).length();
    camera.position.copy(controls.target).add(new THREE.Vector3(0, radius * 0.7, radius * 0.7));
    controls.update();
  });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealAt = pois.flags.map((_, i) => performance.now() + i * 260);
  let hoveredFlag = -1;
  function flagAt(clientX: number, clientY: number) {
    const bounds = renderer.domElement.getBoundingClientRect();
    const x = clientX - bounds.left, y = clientY - bounds.top;
    for (let i = 0; i < pois.flags.length; i++) {
      const p = pois.flags[i].marker.position.clone().add(new THREE.Vector3(0, 1.25, 0)).project(camera);
      const sx = (p.x + 1) * bounds.width / 2;
      const sy = (1 - p.y) * bounds.height / 2;
      if (Math.hypot(x - sx, y - sy) < 28) return i;
    }
    return -1;
  }
  renderer.domElement.addEventListener('pointermove', event => {
    const index = flagAt(event.clientX, event.clientY);
    if (index !== hoveredFlag) {
      hoveredFlag = index;
      if (index >= 0) revealAt[index] = performance.now();
    }
    renderer.domElement.style.cursor = index >= 0 ? 'pointer' : '';
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    hoveredFlag = -1;
    renderer.domElement.style.cursor = '';
  });
  renderer.domElement.addEventListener('pointerdown', event => {
    const index = flagAt(event.clientX, event.clientY);
    if (index >= 0) revealAt[index] = performance.now();
  });
  $('loading').remove();
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) {
      setProgress(progress + dt / 38);
      if (progress >= 1) { playing = false; play.textContent = '↺ Replay ride'; }
    }
    controls.update();
    // Keep the diorama names readable without letting them fill the screen when zoomed in.
    const labelScale = Math.min(1, 1.8 / camera.zoom);
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    for (let i = 0; i < pois.flags.length; i++) {
      const { label, isPeak } = pois.flags[i];
      const elapsed = THREE.MathUtils.clamp((now - revealAt[i]) / 700, 0, 1);
      const reveal = reducedMotion ? 1 : 1 - (1 - elapsed) ** 3;
      const width = 10.5 * labelScale;
      label.visible = reveal > 0.001;
      // Grow the visible strip and its UV range together: text is uncovered,
      // never stretched, and the edge nearest the flag stays in place.
      label.material.map!.repeat.x = reveal;
      label.material.map!.updateMatrix();
      label.scale.set(width * reveal, 1.97 * labelScale, 1);
      const fullCenter = (isPeak ? (innerWidth < 700 ? 6 : 7) : 6) * labelScale;
      label.position.copy(screenRight).multiplyScalar(fullCenter - width * (1 - reveal) / 2);
      label.position.y += isPeak && innerWidth < 700 ? 0.3 : 2.65;
    }
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(postScene, postCamera);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(poiScene, camera);
    renderer.autoClear = true;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(error => { console.error(error); $<HTMLElement>('loading').textContent = 'Could not load the ride map. Check the browser console.'; });
