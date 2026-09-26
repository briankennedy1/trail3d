# Films

Tahoe Trails can turn the map into short movies for presentations: a camera moving over the painted basin while a boat crosses the lake or a mountain biker rides a route, drawing it on in gold. Movies render frame by frame, so they come out smooth at 4K no matter how fast your computer is.

## Rendering a movie

Rendering needs your installed Chrome and `ffmpeg`. Start the map's dev server, then render from a second terminal:

```
npm run dev
npm run film -- armstrong-sidewinder --draft
```

| Command | What you get |
| --- | --- |
| `npm run film -- <name> --draft` | A 1080p, 15 fps preview, in under a minute. Use this to check timing. |
| `npm run film -- <name>` | The final movie: 3840×2160 (4K), 30 fps H.264. Takes a few minutes. |
| `npm run film -- <name> --still 12.5` | One PNG frame at 12.5 seconds, for checking a moment or making a slide. |

Options, which can be combined:

- `--no-captions` leaves off the titles, if your slides or your voice will carry the story.
- `--fps 60` renders smoother motion. It takes twice as long and makes a bigger file.
- `--out path.mp4` writes somewhere other than `renders/`.

Movies land in `renders/`, which isn't checked into git. The H.264 files play in Keynote, PowerPoint, Google Slides, and QuickTime. A 30-second 4K movie is roughly 300 MB.

## The movies so far

| Name | Length | What happens |
| --- | --- | --- |
| `keys-to-stanford-rock` | 34 s | Opens on the whole basin, drops into the Tahoe Keys, follows a wooden runabout up the west shore past Emerald Bay to Obexer's in Homewood, then paints on the Stanford Rock Trail. |
| `fountain-place-corral` | 19 s | Close on Trimmer Peak with east at the top. A rider climbs Fountain Place Road to the top of Corral, pauses, and rides Corral down. 5.2 miles. |
| `armstrong-sidewinder` | 28 s | Up Fountain Place Road to its top, then down Armstrong Connector, Sidewinder, and Incense Cedar, and across Powerline Road to the bottom of Corral. 10.3 miles. |
| `armstrong-pass-star-lake` | 51 s | Up Fountain Place and Armstrong Pass, along the Tahoe Rim Trail to Star Lake, down Star Lake, Cold Creek, and Lower Cold Creek, then over to Railroad Grade and the bottom of Corral. 23 miles. |

## What's in a ride movie

The three ride movies share one recipe:

1. **Opening.** A close-up of Trimmer Peak, with east at the top of the frame. The camera drifts in slightly so the shot doesn't feel frozen.
2. **Reveal.** The camera pulls back to show the whole route. The rest of the map softens so the route stands out, and a faint dashed preview of the route fades in.
3. **The ride.** A little painted mountain biker (teal jersey, vermilion bike, gold helmet) rides the route while the gold line draws on behind them. The camera follows, framed between the rider and the whole route.
   - **Pace:** the rider climbs slower than they descend, so a movie's rhythm follows the terrain.
   - **Stops:** the rider can pause at named places, like "Top of Fountain Place" or "Star Lake".
4. **Summary.** The camera pulls back to the finished route, and the final caption holds for a few seconds.

**Captions.** Each trail gets a caption as the rider starts it: its name, miles, and climb or descent. Stops show their elevation, and the summary gives total miles, climbing, and descent. All the numbers are measured from the map data.

**Speed.** Ride movies play at double speed. The final summary still holds for 3.5 seconds, so it's readable.

**Gaps.** Where one trail ends and the next begins somewhere else, a straight gold line bridges the gap as the rider crosses it. For example, the bottom of the Star Lake Trail doesn't reach the top of Cold Creek in the map data, so the rider crosses about half a mile on a straight connector.

The rider always draws in front of trees and ridges, so it never disappears into the forest.

## Making a new ride movie

A ride movie is a short file in `scripts/films/`. Copy one of the existing rides and change the route:

```js
import { ride } from './lib/ride.mjs';

export const setup = ride({
  title: 'Fountain Place → Incense Cedar', // the summary caption
  route: [
    { name: 'Fountain Place Road', from: [-119.9945, 38.8648], to: [-119.9404, 38.8564] },
    { name: 'Armstrong Connector Trail', to: [-119.9563, 38.8668] },
    { name: 'Sierra Sidewinder', from: [-119.9579, 38.8664], to: [-119.9633, 38.8705] },
    { to: [-119.9776, 38.8813] }, // no name: a straight connector to this point
  ],
  stops: [{ afterLeg: 0, label: 'Top of Fountain Place' }],
});
```

- **Legs.** Each leg names a trail or road exactly as it appears on the map (search the map if you're unsure). `to` is where the rider leaves it, as `[longitude, latitude]`.
- **Joining a trail.** Set `from` for where the rider joins the trail. Leave it out to continue from wherever the previous leg ended.
- **Snapping.** Points snap to the nearest spot on the trail, so they only need to be close. The rider follows the trail's real shape between them.
- **Connectors.** A leg with no `name` is a straight connector to its `to` point. A connector is also added automatically wherever two legs don't touch.
- **Captions.** Add `label: 'Something else'` to a leg to caption it differently from its trail name.
- **Stops.** `stops` pause the rider at the end of a leg (`afterLeg` counts from 0, skipping unnamed connectors). The caption shows the stop's elevation. Add `seconds` to hold longer than the default 1.5.
- **Other settings:** `speed` (default 2), `finalHold` (seconds on the last shot, default 3.5), `secondsPerMile` (riding pace at normal speed, default 3.5), and `riderPx` (rider size, default 44).
- **Roads.** Only roads on the map can be ridden. To add one, list it by its OpenStreetMap name under `CONTEXT_ROADS` in `scripts/build-data.mjs` and run `npm run data`.

Render with `--draft` first. The terminal prints each leg's stats, which makes a bad junction easy to spot.

## Other kinds of movies

`keys-to-stanford-rock.mjs` is written by hand rather than with the ride recipe. It's the example to copy for anything else. A scene file exports `setup({ film, captions })` and returns a `duration` in seconds plus an `at(t)` function that describes each frame.

A frame can set:

- **The camera:** where it looks, how close, and which direction it faces
- **A boat** following lon/lat waypoints across the water, with a wake that fades when it slows
- **A route** being drawn on, with a rider at its head
- **A trail highlight** that paints itself on, from either end
- **Focus:** how much the rest of the map fades back
- **A caption** with a title, a subtitle, and an opacity

To change pacing, the hand-written movie keeps all its beats in a `SHOTS` table at the top of the file.

## How it works

Adding `?film` to the map's address (for example `http://localhost:5317/?film`) opens a frame-by-frame mode with no interface. Nothing animates on its own there: each frame is posed exactly and drawn on request.

`npm run film` opens that page in headless Chrome at 1920×1080. For 4K it renders at double pixel density, so labels and captions keep the same size relative to the frame at any resolution. It then steps through the scene's timeline one frame at a time and streams each capture straight into `ffmpeg`, so nothing piles up on disk.

The code:

- `src/film.ts`: film mode (camera, routes, captions)
- `src/boat.ts` and `src/rider.ts`: the painted boat and rider
- `scripts/film.mjs`: the renderer
- `scripts/films/`: the scenes
