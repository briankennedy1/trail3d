# Ride The Lost Sierra

A standalone, locally running ride guide: a regional 3D diorama, imported Everstoke field notes, a persistent database, and an admin workshop. This app lives separately from the original Beckwourth app. It has no ChatGPT Sites configuration or hosting dependency.

## Run

Requires Node 24.12 or newer. From this directory:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5318/**. The Node server serves both Vite and the API on the same origin. Reload the browser after frontend edits; hot reload is disabled to avoid a second exposed development port. Restart after backend edits.

For a production-style local preview:

```sh
npm run build
npm start
```

The original Beckwourth deployment is unchanged; its source entry point now uses the same shared viewer as the guide. The regional guide is in this separate directory, backed up in the same Git repository.

## What works

- The original Beckwourth visual language: fullscreen map, Fraunces headings, floating cream ride card, watercolor terrain shaders, and the hold-to-move compass.
- Regional relief from actual AWS Terrarium elevation tiles; no API key needed at runtime.
- Select a ride to break away surrounding terrain and smoothly move into its area. Return to rebuild the regional map.
- Every ride with a GPS track uses the original Beckwourth viewer: terrain, exact green marker, animated linked flags, elevation scrubbing, compass, and the 45-second helicopter playback. Beckwourth retains its detailed terrain and tuned home/camera preset. Playback ignores accidental profile scrubbing. The green rider only appears after interaction.
- 19 rides and 10 off-bike adventures in the active guide, selected from 22 rides and 10 adventures imported from the public Everstoke planner. Search, area/effort filters, and external route/video links.
- Route-specific URLs (`/?ride=beckwourth-peak`). Local links work only on this computer until hosted.
- Username/password admin. Create/edit entries, draft/publish/archive, import GPX/GeoJSON, export structured content, and change the admin password.
- SQLite persistence with source snapshots, version conflicts, sessions, and an audit trail of edits and replaced tracks.
- Responsive layout and reduced-motion support.

## Shared ride architecture

The original Beckwourth code is the baseline for **all** tracked rides. Ride selection mounts it in the guide's existing map/card; it does not load another website or an iframe. The regional renderer handles browsing and the crumble transition. At the start of the zoom, the ride renderer takes over from the matching regional camera framing and borrows the regional terrain chunks. One camera renders both the departing region and the detailed ride; surrounding chunks drop away while nearby chunks dissolve in place. A 3.4-second approach uses multiplicative zoom and keeps the destination on a continuous screen-space path into the saved home view. The regional renderer is suspended for the entire move. GPU setup completes before the first visible approach frame, and controls unlock on actual completion rather than a timer. Returning disposes the ride's frame loop, event listeners, controls, textures, geometry, and WebGL context, and resumes the region.

| Module | Responsibility |
| --- | --- |
| `../src/ride-viewer.ts` | Mount/dispose the shared viewer, playback, scrubbing and compass interaction |
| `../src/ride-flight-plan.ts` | Original smooth helicopter planner and 45-second motion-based pacing |
| `../src/ride-route.ts` | Original gold/overlap strokes, depth testing and green dot |
| `../src/pois.ts` | Reusable flag geometry, labels, links and fabric animations |
| `../src/terrain.ts` | Watercolor terrain, configurable cutout base |
| `../src/ride-profile.css` | Shared elevation/playback styling |
| `../src/beckwourth-preset.ts` | Beckwourth's exact home, flight beats and two named flags |
| `src/ride-data.js` | GPS-to-local-meter adapter, regional terrain cutout and elevation fallback |
| `src/ride-experience.js` | Choose terrain/preset and pass each ride's data into the shared viewer |

`../src/beckwourth.ts` is now a small compatibility entry point for the original standalone app. It loads the original data and mounts the same viewer. The guide reads tracks from its database, including replacement uploads. Other rides receive their own terrain crop and starting camera; they do not inherit Beckwourth's POI locations. Regional terrain is coarser than Beckwourth's detailed cutout, so additional high-resolution ride terrain is a future content improvement.

`mountRideViewer({ data: { map, ride, heights }, home, pointsOfInterest, ... })` returns a controller with `dispose()`. Optional settings are `root` (DOM scope), `homeStorageKey`, `baseElevation`, `scale`, `angleBeats`, and `manageLoading`. The host supplies the original control element IDs. Public guide homes come from ride settings, never a visitor's saved local view.

Entries can persist a validated `viewer` object through the admin API alongside normal content. Supported fields are `home` (`position`, `target`, `zoom`), `pointsOfInterest` (`name`, `latitude`, `longitude`, hex `color`, optional `url`/`elevationFt`), `baseElevation`, `scale`, and `angleBeats` (ordered `[progress, degrees]` pairs from 0 to 1). The CMS exposes these settings in grouped forms, including individual flag fields. Camera angles use JSON pairs; unset overrides retain the ride preset or terrain-derived defaults. The ride card’s cog menu includes **Set current view as home** and **Go to home view**. An empty flag list is valid until a ride's actual POIs are supplied. The public never needs an account.

## Create the admin

The first server startup prints a **one-time admin setup URL**. Open it, keep or change the `admin` username, and choose a password of at least 12 characters. The setup key is generated locally in `.data/setup-token`; it is removed after setup. Do not commit or share the key. The CMS is `/admin.html` (also `/admin`). Search and filter by content type, publication status, or GPS readiness. Select an entry to edit its fields, flags, home camera, terrain settings, and camera angles. Expand the record inspector for every stored entry field, GPS metadata, original imported entry, import provenance, and the last 50 changes with before/after data. GPS geometry can be uploaded or downloaded as GeoJSON. Original source snapshots and computed GPS metadata are read-only. Unsaved edits prompt before leaving; version checks prevent overwriting newer edits. No credentials or sessions are returned by the inspector.

Visitors do not have accounts or saved favorites. The public guide has no admin link; access the admin workshop directly at `/admin.html`. Admin writes require authentication and a matching Origin header. Passwords are hashed with salted scrypt. Session tokens are stored hashed in SQLite and sent in HttpOnly, SameSite=Strict cookies; HTTPS origins additionally set Secure. Sessions expire after 12 hours. Login/setup have a per-IP limit. The app binds only to loopback by default.

## Data and provenance

`data/planner-rides.json` and `data/planner-adventures.json` retain every shipped source field, including null values. `data/planner-settings.json` preserves the eight named towns, default drive times, and Everstoke coordinates. `data/planner-source.json` records the source asset URL, fetch time, SHA-256, and counts. Import uses a restricted literal parser, never executes downloaded JavaScript.

```sh
npm run import:planner
# Or import an already downloaded bundle:
python3 scripts/import-planner.py /path/to/planner.js
```

The importer refreshes the **source snapshot files**, not live admin edits. The database seeds these snapshots only once on its first launch. Subsequent restarts never overwrite edits. Review/diff future source imports before applying changes to existing records.

The planner ships **location pins and external links, not GPS tracks**. Its coordinates are approximate area pins, often repeated for several rides. 18 active rides currently need a GPX/GeoJSON track before their actual route can be rendered. A direct request to the linked Trailforks ridelog returned HTTP 403; no access controls were bypassed. Export accessible GPX files normally and add them through the admin workshop.

The bundled Beckwourth track is the cleaned September 25, 2026 recording (Trailforks `124349783`) from the original diorama. It differs from the planner’s linked ride (`92464225`), and links directly to that recording. Beckwourth retains its original ride statistics. Untracked rides show planner climb/descent values; displayed distance comes from the shown track. Missing source statistics are never guessed. E-bike recommendations do not establish access permission. Current conditions are not tracked yet.

### Geographic coverage

The current terrain covers 39.49–40.20 N, 121.04–120.28 W. Nevada City, Truckee, and Susanville are archived and excluded from the guide; the untouched import snapshots preserve their original records. `data/guide-scope.json` defines this coverage. Uploads outside that region are rejected with an explanation. GPX accepts one continuous track segment or route; GeoJSON accepts one LineString with 2–30,000 points. Gaps longer than 5 km and nonfinite coordinates are rejected. Tracks without elevation are displayed on sampled terrain.

Regenerate elevation assets with `npm run terrain` (requires Internet access). The current script also copies the curated track/terrain from the sibling original Beckwourth app. The generated assets are checked in, so no terrain regeneration is needed. Build from this repository, which contains the shared viewer and original Beckwourth terrain. The production dist directory contains all required assets. Terrain source: https://registry.opendata.aws/terrain-tiles/.

## Database and backups

`server/schema.sql` defines the schema:

- `entries`: ID, kind, area, name, coordinates, publication status, typed content JSON, version, original source JSON.
- `tracks`: GeoJSON, distance/elevation totals, track-specific provenance.
- `sources`: original import metadata and hashes.
- `settings`: imported towns, drive defaults, and the Everstoke base location.
- `users`, `sessions`: admin identity and expiring sessions.
- `audit_log`: content and track changes, with previous values.

Runtime database and credentials live in `.data/` and are intentionally **not in Git**. Source data, generated terrain, code, and schema are in Git. Keep actual database backups separately:

```sh
npm run backup
```

This makes a consistent SQLite backup in `backups/` even while the server is running. The admin content export excludes credentials and sessions. To restore a database backup, stop the server, preserve the existing `.data` directory, and put the chosen backup at `.data/guide.sqlite` in a new data directory. Start with `DATA_DIR=/absolute/path/to/restored-data npm start`. Do not mix a restored database with old `-wal` or `-shm` files.

## Tests

```sh
npm test
npm run build
```

Tests use a temporary database and localhost port 19531. They cover unauthenticated access, setup, session cookies, cross-origin writes, private drafts/tracks, edit conflicts, persistence through restart, publishing, track validation/provenance, content export, and login/logout.

## Hosting later

Use a Node host/container with a **persistent disk** for SQLite. Build assets first, then run `npm start`; this is not a static-only deployment. Set `DATA_DIR` to the persistent disk, `PORT` to the service port, `HOST=0.0.0.0` inside a container, and `APP_ORIGIN=https://your-domain.example`. Put HTTPS in front and preserve the original Host header. Keep a single server instance with SQLite; migrate to Postgres if multiple instances or editors require it. Arrange scheduled off-host database backups before public launch.

No domain, hosting account, live deployment, spending, public registration, or external messaging has been created. The next content milestone is obtaining/reviewing the other 18 GPS tracks and correcting the repeated approximate pins. Before launch, add password recovery/another admin provisioning workflow, operational monitoring, and a review of trail access and seasonal notes. The present admin can change their password after signing in; there is no email-based reset.

Technical references: [Node SQLite](https://nodejs.org/api/sqlite.html), [Vite backend integration](https://vite.dev/guide/backend-integration.html).

### Set a ride home view

Sign in as an admin, open a tracked ride, position the camera, then choose **Ride settings (bottom-right cog) → Set current view as home**. This saves `viewer.home` in SQLite, preserves other ride settings, checks the entry version, and records the change in the audit log. Reloads and other visitors receive this shared default. The compass and helicopter playback use the new home immediately; saving does not move the camera.

The cog is shown only to signed-in admins, and the home-setting API requires a valid admin session on both local and hosted servers. Matching Origin, version checks, and validation remain required.
