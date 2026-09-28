import './setup';
import './beckwourth.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Terrain, toWorld, type MapData } from './data';
import { buildLandscape } from './terrain';
import { POST_FRAG, POST_VERT } from './shaders';

type Ride = { id: number; date: string; points: [number, number, number][] };
type EmbeddedRide = { map: MapData; ride: Ride; terrain: string };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
  scene.add(buildLandscape(terrain).group);

  const points = ride.points.map(([x, y]) => new THREE.Vector3(...toWorld(map, x, y, terrain.heightAt(x, y) + 5)));
  const distances = [0];
  for (let i = 1; i < ride.points.length; i++) {
    const a = ride.points[i - 1], b = ride.points[i];
    distances.push(distances.at(-1)! + Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  const total = distances.at(-1)!;
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
  const preview = routeLine(mat('#fff7e7', 8, 0.9), 20);
  preview.geometry.setPositions(points.flatMap(p => [p.x, p.y, p.z]));
  const previewCore = routeLine(mat('#8a6d5b', 3, 0.85), 21);
  previewCore.geometry.setPositions(points.flatMap(p => [p.x, p.y, p.z]));
  // Keep all route strokes in the transparent pass so renderOrder can put the
  // growing gold line above the full, muted preview.
  const activeHalo = routeLine(mat('#fff9df', 12, 0.99), 22);
  const active = routeLine(mat('#edaa29', 6, 0.99), 23);
  const rider = new THREE.Group();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), new THREE.MeshBasicMaterial({ color: '#cf532e', depthTest: true }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.65, 0.9, 32), new THREE.MeshBasicMaterial({ color: '#fff8e4', side: THREE.DoubleSide, depthTest: true }));
  ring.rotation.x = -Math.PI / 2;
  rider.add(dot, ring);
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
  const slider = $<HTMLInputElement>('progress');
  const play = $<HTMLButtonElement>('play');
  let playing = false, progress = 1, last = performance.now();

  function setProgress(value: number) {
    progress = THREE.MathUtils.clamp(value, 0, 1);
    const distance = progress * total;
    let lo = 0, hi = distances.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (distances[mid] < distance) lo = mid + 1; else hi = mid; }
    const i = Math.max(1, lo);
    const t = THREE.MathUtils.clamp((distance - distances[i - 1]) / Math.max(1, distances[i] - distances[i - 1]), 0, 1);
    const position = points[i - 1].clone().lerp(points[i], t);
    rider.position.copy(position);
    const path = points.slice(0, i).concat(position).flatMap(p => [p.x, p.y, p.z]);
    const visible = path.length >= 6;
    active.visible = activeHalo.visible = visible;
    if (visible) { active.geometry.setPositions(path); activeHalo.geometry.setPositions(path); }
    slider.value = String(Math.round(progress * 1000));
    $<HTMLElement>('mile').textContent = `${(progress * 15).toFixed(1)} / 15.0 mi`;
  }

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
  function home() { controls.target.set(0, -2, 0); camera.position.set(100, 105, 100); camera.zoom = 1.17; camera.updateProjectionMatrix(); controls.update(); }
  home();
  setProgress(1);
  slider.addEventListener('input', () => { playing = false; play.textContent = '▶ Play ride'; setProgress(Number(slider.value) / 1000); });
  play.addEventListener('click', () => {
    if (progress >= 1) setProgress(0);
    playing = !playing;
    play.textContent = playing ? 'Ⅱ Pause' : '▶ Play ride';
  });
  $('home').addEventListener('click', home);
  $('north').addEventListener('click', () => {
    const radius = camera.position.clone().sub(controls.target).length();
    camera.position.copy(controls.target).add(new THREE.Vector3(0, radius * 0.7, radius * 0.7));
    controls.update();
  });
  $('loading').remove();
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) {
      setProgress(progress + dt / 38);
      if (progress >= 1) { playing = false; play.textContent = '↺ Replay ride'; }
    }
    controls.update();
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(postScene, postCamera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(error => { console.error(error); $<HTMLElement>('loading').textContent = 'Could not load the ride map. Check the browser console.'; });
