# Ride The Lost Sierra

An interactive ride guide for California’s Lost Sierra, built around a watercolor 3D terrain diorama. Explore the region, select a ride, scrub its elevation profile, or watch a smooth helicopter-style playback. A private CMS manages routes and editorial content; visitors need no account.

The active guide lives in **[`lost-sierra/`](lost-sierra/)**. It reuses the original Beckwourth Peak viewer in the same page. The root app remains the standalone Beckwourth project.

## Start the guide

Requires **Node.js 24.12 or newer**. From the repository root:

```sh
npm ci
npm ci --prefix lost-sierra
npm run dev --prefix lost-sierra
```

- Guide: **http://127.0.0.1:5318/**
- CMS: **http://127.0.0.1:5318/admin.html**
- First launch prints a one-time admin setup URL. Existing installations use their saved admin credentials.

Use the server to open the guide; it depends on its API and SQLite database. Reload after frontend edits; restart after backend edits. Development hot reload is disabled.

For a production-style local preview:

```sh
npm run build --prefix lost-sierra
npm start --prefix lost-sierra
```

## Current experience

- Regional overview with route highlighting and a terrain crumble transition into individual rides.
- Shared overview trails alternate their route colors in stationary stripes with one cream outline. Hovering a ride highlights its complete path in a solid color.
- Shared ride viewer with depth-tested routes, animated linked flags, elevation scrubbing, and hold-to-move compass controls.
- **Play Ride** uses a smooth 45-second follow camera. Scrubbing is ignored during playback; playback ends by returning to the ride’s home view.
- Route families: **Mt. Elwell** (The Hard Way / The Not So Easy Way) and **Downieville** (Original / Adventure Mode). Options have independent tracks, stats, notes, and camera settings.
- Loop/Shuttle modes where configured. Separate green start and red finish flags for point-to-point rides; one combined flag for loops.
- Surface colors on the route and profile: yellow singletrack, dark gray asphalt, brown dirt road, and gray unverified sections.
- Miles, climbing feet, and moving time; intensity banners; Must Ride ribbons; ride notes; parking, Trailforks, and video links.
- Admin-only settings cog for shared home views and current-route editing. CMS intensity dropdown, route-family fields, track uploads, publishing, and audit history.
- CMS map-label choices and coordinate-to-parking links; automatic terrain framing for rides without a saved home.
- Safe GPX staging, per-ride surface rebuilds, seed-content audits, and automated GitHub validation.

## Project map

| Location | Purpose |
| --- | --- |
| [`lost-sierra/README.md`](lost-sierra/README.md) | Guide setup, CMS, data workflow, backups, and hosting |
| `lost-sierra/src/` | Public guide and CMS frontend |
| `lost-sierra/server/` | Node API, SQLite storage, authentication, migrations, tests |
| `lost-sierra/data/` | Source snapshots, curated route metadata, tracks, surface corrections |
| `lost-sierra/public/terrain/` | Checked-in regional and detailed ride terrain |
| `src/` | Shared Three.js terrain, ride viewer, helicopter camera, route and flag rendering |
| `public/beckwourth/` | Original Beckwourth terrain and reconstructed recording |
| [`lost-sierra/data/routes/README.md`](lost-sierra/data/routes/README.md) | Import provenance and route repair notes |
| `docs/` | Earlier rendering/reference documentation |

## Validation and backup

```sh
npm test --prefix lost-sierra
npm run build --prefix lost-sierra
npx tsc --noEmit
npm run backup --prefix lost-sierra
```

**Git does not back up the live CMS database.** `lost-sierra/.data/guide.sqlite` contains current edits, home views, admin accounts, and audit history. `npm run backup` writes a consistent SQLite snapshot to `lost-sierra/backups/`; both directories are ignored by Git. Preserve database backups separately.

## Standalone Beckwourth app

The original static app is still available from the repository root:

```sh
npm run dev
# Open /app.html at the URL printed by Vite.
npm run build
```

That build produces the standalone root `index.html` and root `dist/`. It does **not** build or publish the regional guide. The guide is being developed locally for a future conventional Node/SQLite deployment, with no ChatGPT Sites hosting dependency.

## Credits

Inspired by [Tahoe Trails](https://github.com/kneath/tahoe-trails). Route sources include [Trailforks](https://www.trailforks.com/), with source URLs recorded per ride. Terrain uses [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/); roads, waterways, and surface estimates use OpenStreetMap data; Lake Davis water geometry uses USGS NHD. Initial editorial content came from the [Everstoke planner](https://everstokeplanner.netlify.app/). The guide’s Credits modal contains additional attribution.
