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

The original Beckwourth site and its existing server are unchanged. The regional guide is in this separate directory, backed up in the same Git repository.

## What works

- The original Beckwourth visual language: fullscreen map, Fraunces headings, floating cream ride card, watercolor terrain shaders, and the hold-to-move compass.
- Regional relief from actual AWS Terrarium elevation tiles; no API key needed at runtime.
- Select a ride to break away surrounding terrain and smoothly move into its area. Return to rebuild the regional map.
- The curated Beckwourth route has its own detailed terrain, elevation scrubbing, and a 45-second orbit playback. Playback ignores accidental profile scrubbing. The green rider only appears after interaction.
- 19 rides and 10 off-bike adventures in the active guide, selected from 22 rides and 10 adventures imported from the public Everstoke planner. Search, area/effort filters, external route/video links, and favorites stored on each visitor’s device.
- Route-specific URLs (`/?ride=beckwourth-peak`). Local links work only on this computer until hosted.
- Username/password admin. Create/edit entries, draft/publish/archive, import GPX/GeoJSON, export structured content, and change the admin password.
- SQLite persistence with source snapshots, version conflicts, sessions, and an audit trail of edits and replaced tracks.
- Responsive layout and reduced-motion support.

## Create the admin

The first server startup prints a **one-time admin setup URL**. Open it, keep or change the `admin` username, and choose a password of at least 12 characters. The setup key is generated locally in `.data/setup-token`; it is removed after setup. Do not commit or share the key. The admin workshop is `/admin.html`.

Visitors do not have accounts. Admin writes require authentication and a matching Origin header. Passwords are hashed with salted scrypt. Session tokens are stored hashed in SQLite and sent in HttpOnly, SameSite=Strict cookies; HTTPS origins additionally set Secure. Sessions expire after 12 hours. Login/setup have a per-IP limit. The app binds only to loopback by default.

## Data and provenance

`data/planner-rides.json` and `data/planner-adventures.json` retain every shipped source field, including null values. `data/planner-settings.json` preserves the eight named towns, default drive times, and Everstoke coordinates. `data/planner-source.json` records the source asset URL, fetch time, SHA-256, and counts. Import uses a restricted literal parser, never executes downloaded JavaScript.

```sh
npm run import:planner
# Or import an already downloaded bundle:
python3 scripts/import-planner.py /path/to/planner.js
```

The importer refreshes the **source snapshot files**, not live admin edits. The database seeds these snapshots only once on its first launch. Subsequent restarts never overwrite edits. Review/diff future source imports before applying changes to existing records.

The planner ships **location pins and external links, not GPS tracks**. Its coordinates are approximate area pins, often repeated for several rides. 18 active rides currently need a GPX/GeoJSON track before their actual route can be rendered. A direct request to the linked Trailforks ridelog returned HTTP 403; no access controls were bypassed. Export accessible GPX files normally and add them through the admin workshop.

The bundled Beckwourth track is the cleaned September 25, 2026 recording (Trailforks `124349783`) from the original diorama. It differs from the planner’s linked ride (`92464225`), and the UI labels this distinction. Imported climb/descent values remain marked as planner values; displayed distance comes from the shown track. Missing source statistics are never guessed. E-bike recommendations do not establish access permission. Current conditions are not tracked yet.

### Geographic coverage

The current terrain covers 39.49–40.20 N, 121.04–120.28 W. Nevada City, Truckee, and Susanville are archived and excluded from the guide; the untouched import snapshots preserve their original records. `data/guide-scope.json` defines this coverage. Uploads outside that region are rejected with an explanation. GPX accepts one continuous track segment or route; GeoJSON accepts one LineString with 2–30,000 points. Gaps longer than 5 km and nonfinite coordinates are rejected. Tracks without elevation are displayed on sampled terrain.

Regenerate elevation assets with `npm run terrain` (requires Internet access). The current script also copies the curated track/terrain from the sibling original Beckwourth app. The generated assets are checked in, so the app runs independently without regeneration. Terrain source: https://registry.opendata.aws/terrain-tiles/.

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
