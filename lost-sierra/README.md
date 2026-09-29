# Ride The Lost Sierra — guide and CMS

A local Node/SQLite ride guide with a regional Three.js diorama and a private admin CMS. All tracked rides use the shared Beckwourth viewer within the guide’s existing page. Public visitors have no accounts, favorites, or saved personal views.

## Run locally

Requires **Node.js 24.12 or newer**. Install dependencies in both the repository root and this directory:

```sh
# From the repository root
npm ci
npm ci --prefix lost-sierra
npm run dev --prefix lost-sierra
```

Open **http://127.0.0.1:5318/**. The same server serves the frontend and API. Reload after frontend changes; restart after backend changes. Hot reload is disabled to avoid a separate development port.

Production-style preview, from this directory:

```sh
npm run build
npm start
```

The footer version follows the Git commit count (uncommitted work counts as the next revision). Hover it for the build timestamp and source commit. Rebuilding an unchanged revision keeps its number and updates the timestamp.

Build outputs go to `lost-sierra/dist/`. The root package builds the separate standalone Beckwourth app.

## Public ride experience

- Selecting a ride moves from the overview into its detailed terrain, with surrounding terrain crumbling away. Direct `/?ride=<id>` links load the ride intact.
- **All rides** rebuilds the overview. The ride card fades out fully, and the overview card fades in at 80% of the return animation.
- Switching route options keeps the camera moving between their views and dissolves the outgoing frame; it does not return to the overview or rebuild the whole terrain with a crumble animation.
- **Play Ride** always uses the smooth helicopter follow camera, with a 45-second playback timeline independent of recorded ride speed. Camera positioning is eased, profile scrubbing is ignored while playing, and completion returns to the route home view.
- Scrubbing the elevation profile moves the route highlight and green dot without moving the camera. The dot is hidden until interaction.
- The compass supports held rotate/tilt controls. Its center faces north, then returns home on a subsequent click from north.
- Flags remain occluded by terrain and unfurl labels on hover. Start/finish flags link to Google Maps parking. Loops have a combined start/finish flag; point-to-point rides have a green start and red finish.
- The stats line displays miles, climbing feet, and moving time (`1h 25m`, with one `~` for estimates). Distance comes from the displayed geometry.
- Route and profile surfaces share colors: singletrack yellow, asphalt dark gray, dirt road brown, unverified gray. Rider-confirmed corrections override mapped estimates.
- Ride notes expand through the book icon. Intensity and Must Ride have dedicated displays. Roads and waterways can remain visible while their labels are hidden per ride.

## CMS and shared home views

The CMS is **`/admin.html`** (also `/admin`). The first server startup prints a one-time setup URL. Choose an admin username and a password of 12–256 characters. The local `.data/setup-token` is removed after setup; keep it private. Existing databases retain their admin accounts.

The CMS supports:

- Create, edit, draft, publish, and archive rides or off-bike adventures.
- **Effort / intensity dropdown:** Not rated, Mellow-ish, Moderate, Challenging, Intense.
- Must Ride, notes, season, climbing/descent totals, moving minutes, and estimated-time status.
- Editable public Trailforks and video URLs; start/finish Google Maps links and a same-start/finish setting.
- Route family ID, family name, option name, and ordering; independent Loop/Shuttle settings where applicable.
- GPX/GeoJSON uploads, track downloads, provenance, original source records, and before/after audit history.
- Viewer home, named POIs/flags, and camera/terrain settings.

The bottom-right settings cog appears only for signed-in admins. Frame the overview or a ride, then use **Set current view as home** to save the shared default. Other visitors receive that framing. The ride cog also offers editing the current route. Home changes are version-checked and audited.

Writes require an authenticated session and matching Origin. Passwords use salted scrypt; session tokens are hashed in SQLite, with HttpOnly/SameSite cookies and a 12-hour lifetime. HTTPS origins set Secure cookies. There is no public admin link or email password-reset flow.

## Route families

Each option is an independent entry, linked by `rideFamily: { id, name, option, order }`. Published options appear in the family selector; each keeps its own track, stats, notes, parking, home, and ride modes.

| Family | Option | Entry ID | Trailforks plan |
| --- | --- | --- | --- |
| Mt. Elwell | The Hard Way | `mt-elwell-hard-way` | 785580 |
| Mt. Elwell | The Not So Easy Way | `mt-elwell-not-so-easy` | 785598 |
| Downieville | Original | `downieville-original` | 785605 |
| Downieville | Adventure Mode | `downieville-adventure-mode` | 785607 |

The old `mt-elwell` URL resolves to The Hard Way. Both Downieville options use finish parking at **39.559603, -120.830308**. Their incidental map labels are hidden. The former `gold-valley-rim-pauley-creek-dh` and `cal-ida-trail` entries are archived.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/main.js` | Guide cards, selection, route families, CMS-aware settings, transitions |
| `src/ride-card.css` | Ride detail card typography and layout |
| `src/ride-experience.js` | Assemble terrain, surfaces, flags, and ride-specific label rules |
| `src/ride-data.js` | Geographic track projection, terrain crops, elevation sampling |
| `src/ride-families.js` | Group route options without merging tracks or modes |
| `src/ride-variants.js` | Loop/Shuttle geometry and statistics |
| `src/ride-access.js` | Endpoint flags and parking links |
| `../src/ride-viewer.ts` | Shared viewer lifecycle, interaction, camera transitions |
| `../src/ride-flight-plan.ts` | Helicopter playback planning |
| `../src/ride-route.ts` | Terrain-occluded route rendering and rider dot |
| `../src/pois.ts` | Flag geometry, unfurling, labels, and links |
| `../src/terrain.ts` | Watercolor terrain and cutout base |
| `server/store.mjs` | SQLite records, validation, initialization and migrations |

The standalone `../src/beckwourth.ts` mounts the same viewer. Guide tracks come from SQLite. Detailed terrain is selected from the curated manifest; other tracks use a crop of the regional terrain. Public home views come from saved ride settings, not visitor local storage.

## Data and import workflow

`data/planner-*.json` preserves the original Everstoke source snapshots. `data/curated-rides.json` supplies curated entries, track paths, detailed terrain paths, and initial editorial settings. Track GeoJSON properties record source URLs, GPX hashes, and relevant repair/elevation provenance.

On first startup the database imports planner records. Curated imports and corrections run with one-time markers and audit entries. **Editing a seed file does not overwrite an existing CMS record.** Update an existing ride through the CMS or an explicit audited migration; preserve unrelated CMS edits and saved home views.

For an imported route:

1. Export the authorized GPX from its source and retain provenance.
2. Store a continuous GeoJSON LineString in `data/routes/` and add/update the curated manifest entry.
3. Preserve recorded elevations. For exports containing only zero elevations, omit those invalid elevation values before generating detailed terrain so the builder samples the DEM.
4. Build detailed terrain using the track filename stem:

   ```sh
   node scripts/build-ride-terrain.mjs downieville-original
   ```

5. Classify surfaces and review the profile, parking, endpoint flags, statistics, and home view.
6. Apply the import to the live database, build the frontend, and verify the ride in the guide.

The terrain builder caches AWS Terrarium tiles and produces roughly 30-meter grids. Generated assets are checked in; normal startup does not download terrain or call Trailforks. Some rides intentionally share terrain (the Elwell variants use `/terrain/mt-elwell`); honor the manifest rather than assuming the terrain folder always matches the entry ID.

Source pages provide processed climbing/descent and moving-time estimates. Raw GPS/DEM elevation sums can exaggerate climbing. Missing intensity remains Not rated until set in the CMS. Source snapshots contain some rides without tracks; those cannot show a traced route until imported.

### Surface corrections

- `data/route-surface-overrides.json`: confirmed ranges bound to the track’s coordinate SHA-256.
- `public/terrain/route-surfaces.json`: generated classifications consumed by both map and elevation profile.
- Ranges use segment indices `[from, to)`. Convert mile boundaries using the same projected geometry as the viewer.

```sh
node scripts/build-route-surfaces.mjs /absolute/path/to/cached-overpass-ways.json
```

The input is a cached Overpass response with highway ways and geometry. The builder rejects corrections whose coordinate hash no longer matches. After replacing a track, review and remap its corrections. For a correction to one ride, preserve other rides’ generated records rather than unintentionally reclassifying the entire catalog.

Recent Downieville corrections: Original is asphalt after mile 15.2; Adventure Mode’s previously unverified sections between miles 8 and 16 are singletrack. Existing classified sections in that Adventure Mode interval remain unchanged.

### Coverage and provenance

The regional terrain covers 39.49–40.20 N, 121.04–120.28 W. `data/guide-scope.json` lists excluded areas and archived entries. Nevada City, Truckee, and Susanville are excluded from the guide.

Uploads accept one GPX track segment/route or a GeoJSON LineString with 2–30,000 points, within the regional bounds, without gaps longer than 5 km. Coordinates must be finite. Source recordings and repairs are documented in [data/routes/README.md](data/routes/README.md) and [the Elwell family notes](data/routes/mt-elwell-options.md).

The Credits modal attributes Tahoe Trails, Trailforks, terrain and map data providers. Watercolor styling is rendered on the terrain; the fullscreen watercolor postprocessing effect is disabled. Current trail conditions and access permissions are not a live data feed.

## Database and backups

Runtime data lives in **`.data/guide.sqlite`**, including CMS edits, shared homes, accounts, sessions, and audit history. These are **not committed to Git**. Checked-in seeds are a reproducible starting point, not a backup of current editorial work.

```sh
npm run backup
```

This creates a consistent SQLite snapshot in `backups/`, including while the server runs. Keep separate off-machine backups. The admin content export excludes credentials and sessions.

For restoration, stop the server, preserve the existing data directory, and put the selected backup at `guide.sqlite` in a new directory. Start with `DATA_DIR=/absolute/path/to/restored-data npm start`. Do not mix a restored database with old `-wal` or `-shm` files.

## Validation

From this directory:

```sh
npm test
npm run build
```

From the repository root:

```sh
npx tsc --noEmit
```

Tests cover authentication, publication and edit conflicts, track validation, curated import preservation, terrain coverage, families, access links, and route behavior. Browser review is still needed for camera motion, flags, layout, and transitions.

## Hosting later

The guide has no ChatGPT Sites hosting dependency. It needs a Node host with persistent storage, rather than static-only hosting:

- Build the guide, then run `npm start`.
- Set `DATA_DIR` to persistent storage, `PORT` to the service port, `HOST=0.0.0.0` when needed in a container, and `APP_ORIGIN` to the exact public HTTPS origin.
- Preserve the original Host header through the proxy; serve HTTPS.
- Keep a single SQLite server instance and arrange off-host backups.
- Before public launch, finish operational monitoring, admin recovery, and content/access review.

Local links at `127.0.0.1:5318` work only on the computer running the server.
