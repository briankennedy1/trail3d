// Tahoe Keys → Obexer's → Stanford Rock Trail
//
// Opens on the whole basin, drops into the Tahoe Keys, follows a wooden runabout up the
// west shore past Emerald Bay to Obexer's in Homewood, then paints on the Stanford Rock Trail.
//
// Every beat's timing lives in SHOTS below; nudge those numbers to re-pace the film.

import fs from 'node:fs';
import path from 'node:path';

const SHOTS = {
  holdHome: [0, 2.5], // the whole basin
  toKeys: [2.5, 6.5], // camera drops into the Tahoe Keys
  boatRide: [7.5, 21], // Keys → Obexer's
  toTrail: [22, 26], // camera rises to frame the trail
  drawTrail: [25.5, 31], // the trail paints itself on
  end: 34,
};

// Keys channel mouth → around Emerald Bay and Rubicon Point → Obexer's dock in Homewood.
// Every point stays about a kilometer offshore (checked against the lake outline).
const ROUTE = [
  [-120.004, 38.9385],
  [-120.007, 38.95],
  [-120.04, 38.958],
  [-120.075, 38.963],
  [-120.083, 38.99],
  [-120.09, 39.015],
  [-120.098, 39.04],
  [-120.103, 39.06],
  [-120.12, 39.0725],
  [-120.145, 39.081],
  [-120.1568, 39.0842],
];

const TRAIL = 'Stanford Rock Trail';
const BOAT_PX = 46; // boat length on screen, in 1080p pixels

// --- easing and interpolation
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeSpeed = (x) => (x < 0.5 ? 12 * x * x : 3 * Math.pow(-2 * x + 2, 2)); // derivative of ease, 0–3
const smooth = (x) => x * x * (3 - 2 * x);
const progress = ([a, b], t) => clamp01((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const lerpView = (a, b, k, hop = 0) => ({
  target: a.target.map((v, i) => lerp(v, b.target[i], k)),
  // zoom interpolates in log space (feels even), with an optional pull-back mid-move
  zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), k) - hop * Math.sin(Math.PI * k)),
  azimuth: lerp(a.azimuth, b.azimuth, k),
  polar: lerp(a.polar, b.polar, k),
});
const fade = (t, [a, b], inDur = 0.6, outDur = 0.6) => clamp01((t - a) / inDur) * clamp01((b - t) / outDur);

export async function setup({ film, captions }) {
  const home = await film('homeView');
  home.zoom *= 0.9; // a little breathing room around the whole diorama
  const keys = await film('pointView', -120.012, 38.947, 7);
  const { dry } = await film('setBoatRoute', ROUTE);
  if (dry.some((u) => u > 0.02)) console.warn(`warning: boat route crosses land near u=${dry.filter((u) => u > 0.02)[0]}`);
  const trailView = await film('trailView', TRAIL, { left: 140, right: 140, top: 110, bottom: 260 });

  // Draw the trail from its lakeside end, near where the boat docks
  const ends = await film('trailEnds', TRAIL);
  const reverse = ends.end[1] < ends.start[1];

  const trails = JSON.parse(fs.readFileSync(path.resolve('public/data/trails.json'), 'utf8'));
  const trail = trails.find((t) => t.name === TRAIL);
  // stats are measured in the data's direction; we draw it from the lake end up
  const climbFt = reverse ? trail.lossFt : trail.gainFt;

  // Camera during the ride: centered on the boat, pulled back mid-trip to show the west shore
  const rideView = async (u) => {
    const target = await film('boatTarget', u);
    return { target, azimuth: home.azimuth, polar: home.polar };
  };
  // Pre-sample the boat's path so the timeline is pure math (no page calls per frame)
  const samples = [];
  for (let i = 0; i <= 400; i++) samples.push((await rideView(i / 400)).target);
  const boatTargetAt = (u) => {
    const f = clamp01(u) * 400;
    const i = Math.min(399, Math.floor(f));
    return samples[i].map((v, k) => lerp(v, samples[i + 1][k], f - i));
  };
  const rideZoom = (u) => Math.exp(lerp(Math.log(7), Math.log(2.6), Math.pow(Math.sin(Math.PI * clamp01(u)), 0.8)));
  const rideStart = { target: boatTargetAt(0), zoom: rideZoom(0), azimuth: home.azimuth, polar: home.polar };
  const rideEnd = { target: boatTargetAt(1), zoom: rideZoom(1), azimuth: home.azimuth, polar: home.polar };

  const boatU = (t) => ease(progress(SHOTS.boatRide, t));

  return {
    duration: SHOTS.end,
    at(t) {
      // --- camera
      let view;
      if (t < SHOTS.toKeys[0]) {
        // a slow drift-in on the opening shot so it doesn't feel frozen
        view = { ...home, zoom: home.zoom * (1 + 0.03 * smooth(t / SHOTS.toKeys[0])) };
      } else if (t < SHOTS.toKeys[1]) {
        view = lerpView({ ...home, zoom: home.zoom * 1.03 }, keys, ease(progress(SHOTS.toKeys, t)), 0);
      } else if (t < SHOTS.boatRide[0]) {
        view = lerpView(keys, rideStart, ease(progress([SHOTS.toKeys[1], SHOTS.boatRide[0]], t)));
      } else if (t < SHOTS.toTrail[0]) {
        const u = boatU(t);
        view = { target: boatTargetAt(u), zoom: rideZoom(u), azimuth: home.azimuth, polar: home.polar };
      } else {
        view = lerpView(rideEnd, trailView, ease(progress(SHOTS.toTrail, t)), 0.25);
      }

      // --- boat: appears in the Keys, idles at Obexer's, then shrinks away as the trail shot arrives
      const shrink = 1 - smooth(progress([SHOTS.toTrail[1] - 1.2, SHOTS.toTrail[1]], t));
      const speed = easeSpeed(progress(SHOTS.boatRide, t)); // 0 at rest, 3 at full tilt
      const boat =
        t >= SHOTS.toKeys[1] - 0.5 ? { u: boatU(t), sizePx: BOAT_PX * shrink, wake: clamp01(speed / 1.2) } : undefined;

      // --- trail
      const reveal = ease(progress(SHOTS.drawTrail, t));
      const focus = smooth(progress([SHOTS.drawTrail[0] - 0.5, SHOTS.drawTrail[0] + 1.5], t));

      // --- captions
      let caption;
      if (captions) {
        const c = [
          { span: [SHOTS.toKeys[1] - 0.8, SHOTS.boatRide[0] + 2.5], title: 'Tahoe Keys', subtitle: 'South Lake Tahoe' },
          { span: [SHOTS.boatRide[1] - 0.3, SHOTS.toTrail[0] + 1.2], title: 'Obexer’s', subtitle: 'Homewood, on the west shore' },
          {
            span: [SHOTS.drawTrail[0] + 1, SHOTS.end + 1],
            title: TRAIL,
            subtitle: `${trail.lengthMi} miles · ${climbFt.toLocaleString()}′ of climbing · up to ${trail.maxFt.toLocaleString()}′`,
          },
        ].find((c) => t >= c.span[0] && t <= c.span[1]);
        if (c) caption = { title: c.title, subtitle: c.subtitle, opacity: fade(t, c.span, 0.7, 0.7) };
      }

      return {
        time: t,
        view,
        boat,
        trail: reveal > 0 ? { name: TRAIL, reveal, reverse } : undefined,
        focus,
        caption,
      };
    },
  };
}
