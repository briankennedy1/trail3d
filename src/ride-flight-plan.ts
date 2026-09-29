import * as THREE from 'three';

type HomeView = { position: [number, number, number]; target: [number, number, number]; zoom: number };
type Shot = { center: THREE.Vector3; angle: number; height: number };
type FlightOptions = {
  total: number;
  routePoint: (distance: number) => THREE.Vector3;
  clearSightHeight: (marker: THREE.Vector3, cameraX: number, cameraZ: number) => number;
  getHome: () => HomeView;
  orbitRadius: number;
  viewScale: number;
  introEnd: number;
  angleBeats?: [number, number][];
};

// Shared preview pace: 10 miles in 7 seconds, independent of recorded ride speed.
const metersPerPlaybackSecond = 1609.344 / 0.7;

// The original helicopter planner: precompute a smooth course and adapt the
// rider's pacing to it. No DOM or live camera corrections are needed here.
export function createFlightPlan({ total, routePoint, clearSightHeight, getHome,
  orbitRadius, viewScale, introEnd, angleBeats }: FlightOptions) {
  const flightSteps = 192, followDuration = total / metersPerPlaybackSecond;
  let flightPath: Shot[] | null = null;
  let flightTimes: number[] = [];
  function splineValue(v0: number, v1: number, v2: number, v3: number, t: number) {
    const u = 1 - t;
    return (u * u * u * v0 + (3 * t * t * t - 6 * t * t + 4) * v1
      + (-3 * t * t * t + 3 * t * t + 3 * t + 1) * v2 + t * t * t * v3) / 6;
  }

  function followFocus(distance: number) {
    // Keep the helicopter ahead of the rider and above the broad route, rather
    // than tracking each switchback or phone GPS wobble.
    const focus = new THREE.Vector3();
    for (const [offset, weight] of [[-2100, 0.07], [-1050, 0.12], [0, 0.2],
      [1050, 0.24], [2100, 0.22], [3150, 0.15]]) {
      focus.addScaledVector(routePoint(distance + offset * viewScale), weight);
    }
    focus.x *= 0.75;
    focus.z *= 0.75;
    return focus;
  }
  function viewHeight(center: THREE.Vector3, angle: number, distance: number) {
    const x = center.x + Math.sin(angle) * orbitRadius;
    const z = center.z + Math.cos(angle) * orbitRadius;
    const subjects = [routePoint(distance), routePoint(distance + 500)];
    return Math.max(center.y + 34 * viewScale, ...subjects.map(p => p.y + clearSightHeight(p, x, z) + 2.5));
  }
  function plannedAngle(value: number) {
    // Follow from the home direction unless this ride has deliberate camera
    // angles for terrain visibility (as Beckwourth does).
    if (!angleBeats?.length) {
      const home = getHome();
      return Math.atan2(home.position[0] - home.target[0], home.position[2] - home.target[2]);
    }
    const beats = angleBeats;
    for (let i = 1; i < beats.length; i++) {
      const [end, endAngle] = beats[i];
      if (value > end) continue;
      const [start, startAngle] = beats[i - 1];
      const t = THREE.MathUtils.smoothstep(value, start, end);
      return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(startAngle, endAngle, t));
    }
    return THREE.MathUtils.degToRad(beats.at(-1)![1]);
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
    const view = getHome();
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
    // Preserve smooth camera pacing; total preview time scales with ride distance.
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
    if (!flightPath) buildFlightPath();
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
  return { flightShot, timeAtProgress, progressAtTime, invalidate() { flightPath = null; flightTimes = []; } };
}
