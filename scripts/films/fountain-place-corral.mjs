// Fountain Place Road → Corral Trail
//
// Opens close on Trimmer Peak with east at the top of the frame, pulls back to show the ride,
// then a mountain biker climbs Fountain Place Road from its bottom to the top of Corral,
// pauses, and rides Corral all the way down. Ends on the whole route.
//
// Every beat's timing lives in SHOTS below, written at 1× speed; nudge those numbers to re-pace
// the film. SPEED then plays the whole thing faster (2 = twice as fast), except the final
// hold, which stays FINAL_HOLD seconds so the summary caption can be read.

const SPEED = 2;
const FINAL_HOLD = 3.5; // seconds on the last shot, after the pull-back finishes

const SHOTS = {
  holdPeak: [0, 2.5], // Trimmer Peak close-up
  toRoute: [2.5, 6.5], // pull back to show the whole route
  climb: [7.5, 19.5], // up Fountain Place Road
  descend: [21, 28.5], // down Corral (the gap before it is the pause at the top)
  pullBack: [28.5, 31.5], // back out to the whole route
  end: 35,
};

const EAST_UP = -Math.PI / 2; // camera to the west, looking east
const TRIMMER_PEAK = [-119.923, 38.8716];
const ROUTE = [
  // from the bottom of Fountain Place Road (near Oneidas) up to where Corral leaves it
  { name: 'Fountain Place Road', from: [-119.9945, 38.8648], to: [-119.9564, 38.8668] },
  // and down Corral to its bottom, at Powerline Road
  { name: 'Corral Trail', from: [-119.9564, 38.8668], to: [-119.9776, 38.8813] },
];
const RIDER_PX = 44; // rider size on screen (wheel to wheel), in 1080p pixels
const PAD = { left: 140, right: 140, top: 90, bottom: 250 }; // leaves room for captions

// --- easing and interpolation
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeInOut = (x) => x * x * (3 - 2 * x);
const progress = ([a, b], t) => clamp01((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const lerpView = (a, b, k, hop = 0) => ({
  target: a.target.map((v, i) => lerp(v, b.target[i], k)),
  zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), k) - hop * Math.sin(Math.PI * k)),
  azimuth: lerp(a.azimuth, b.azimuth, k),
  polar: lerp(a.polar, b.polar, k),
});
const fade = (t, [a, b], inDur = 0.6, outDur = 0.6) => clamp01((t - a) / inDur) * clamp01((b - t) / outDur);
const fmt = (n) => n.toLocaleString();

export async function setup({ film, captions }) {
  const stats = await film('setRoute', ROUTE);
  const [road, corral] = stats.legs;
  const peak = await film('pointView', ...TRIMMER_PEAK, 7, EAST_UP);
  const whole = await film('routeView', PAD, EAST_UP);

  // Pre-sample the route so the timeline is pure math
  const samples = [];
  for (let i = 0; i <= 400; i++) samples.push(await film('routeTarget', i / 400));
  const routeTarget = (u) => {
    const f = clamp01(u) * 400;
    const i = Math.min(399, Math.floor(f));
    return samples[i].map((v, k) => lerp(v, samples[i + 1][k], f - i));
  };

  // While riding, frame halfway between the whole route and the rider, a bit closer in
  const rideView = (u) => ({
    target: whole.target.map((v, i) => lerp(v, routeTarget(u)[i], 0.6)),
    zoom: whole.zoom * 1.9,
    azimuth: EAST_UP,
    polar: whole.polar,
  });

  // Where the rider is (0–1 along the route) at time t
  const uJunction = road.uEnd;
  const riderU = (t) =>
    t < SHOTS.descend[0]
      ? uJunction * ease(progress(SHOTS.climb, t))
      : lerp(uJunction, 1, ease(progress(SHOTS.descend, t)));

  const scene = (t) => {
    const u = riderU(t);

    // --- camera
    let view;
    if (t < SHOTS.toRoute[0]) {
      view = { ...peak, zoom: peak.zoom * (1 + 0.04 * easeInOut(t / SHOTS.toRoute[0])) };
    } else if (t < SHOTS.climb[0]) {
      view = lerpView({ ...peak, zoom: peak.zoom * 1.04 }, whole, ease(progress(SHOTS.toRoute, t)));
    } else if (t < SHOTS.pullBack[0]) {
      // ease from the whole-route view into following the rider
      view = lerpView(whole, rideView(u), easeInOut(progress([SHOTS.climb[0], SHOTS.climb[0] + 2], t)));
    } else {
      view = lerpView(rideView(1), whole, ease(progress(SHOTS.pullBack, t)));
    }

    // --- route and rider
    const preview = easeInOut(progress([SHOTS.toRoute[1] - 1.5, SHOTS.toRoute[1]], t));
    const riderIn = easeInOut(progress([SHOTS.climb[0] - 0.6, SHOTS.climb[0]], t));
    const riderOut = 1 - easeInOut(progress([SHOTS.pullBack[1] - 0.5, SHOTS.pullBack[1] + 0.5], t));
    const route = { reveal: u, preview, riderPx: RIDER_PX * riderIn * riderOut };
    const focus = 0.5 * easeInOut(progress([SHOTS.toRoute[0] + 1, SHOTS.toRoute[1]], t));

    // --- captions
    let caption;
    if (captions) {
      const c = [
        {
          span: [SHOTS.climb[0] - 0.4, SHOTS.climb[0] + 4],
          title: 'Fountain Place Road',
          subtitle: `${road.miles} miles up · ↗ ${fmt(road.gainFt)}′ of climbing`,
        },
        { span: [SHOTS.climb[1] - 0.3, SHOTS.descend[0] + 1.6], title: 'Top of Corral', subtitle: `${fmt(road.endFt)}′` },
        {
          span: [SHOTS.descend[0] + 1.8, SHOTS.descend[1] - 0.2],
          title: 'Corral Trail',
          subtitle: `${corral.miles} miles down · ↘ ${fmt(corral.lossFt)}′ of descent`,
        },
        {
          span: [SHOTS.pullBack[0] + 0.6, SHOTS.end + 1],
          title: 'Fountain Place → Corral',
          subtitle: `${stats.miles} miles · ↗ ${fmt(stats.gainFt)}′ up · ↘ ${fmt(stats.lossFt)}′ down`,
        },
      ].find((c) => t >= c.span[0] && t <= c.span[1]);
      if (c) caption = { title: c.title, subtitle: c.subtitle, opacity: fade(t, c.span, 0.6, 0.6) };
    }

    return { time: t, view, route, focus, caption };
  };

  // Play the scene at SPEED, then hold on its last moment
  const playEnd = SHOTS.pullBack[1] / SPEED;
  return {
    duration: playEnd + FINAL_HOLD,
    at: (t) => scene(Math.min(t * SPEED, SHOTS.end)),
  };
}
