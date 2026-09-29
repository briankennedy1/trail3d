# Curated routes

## Repeatable local GPX import

From `lost-sierra/`, stage a local GPX export with explicit source and identity:

```
npm run stage:ride -- --input /path/to/export.gpx --id my-route --name "My Route" --area "Lakes Basin" --source-url https://example.org/route --source-label "Original route export"
```

Add source-published totals only when verified: `--climbing-ft`, `--descending-ft`, and `--moving-minutes` (plus `--moving-time-estimated` if appropriate). For a confirmed family, provide all three of `--family-id`, `--family-name`, and `--family-option`. The command stages a GeoJSON track, a draft `curated-rides.json` entry, and `review.json` under ignored `.staging/<id>/`. It does not fetch, modify the CMS database, or change any catalog entry. It refuses an existing ride ID or output directory. All-zero GPX elevations are treated as export placeholders and removed; recorded elevations are preserved. Mixed elevation quality, multiple segments, over 30,000 points, or a gap over 5 km stop for review. The curated importer honors the explicit draft status when a new entry is first seeded; legacy entries without a status remain published.

Review the staged track and source terms, then copy the GeoJSON to `data/routes/` and append the draft entry to `data/curated-rides.json`. The draft remains incomplete and unpublished; fill verified route facts and access links. Build its terrain with `node scripts/build-ride-terrain.mjs my-route`, which samples missing elevations, then classify surfaces using a relevant saved Overpass `way[highway];out geom` response:

```
node scripts/build-route-surfaces.mjs /path/to/ways.json --ride my-route
npm run audit:content -- --fail-on-errors
```

Single-ride surface classification preserves the other catalog records and refuses to run without an existing populated surface catalog. It also refuses an Overpass export with no mapped ways matching the route; `--allow-all-unknown` is available after review. A full replacement requires both `--all` and `--confirm-replace-catalog`. The versioned seed audit reports stale surface hashes, incomplete surface ranges, missing tracks/terrain/elevations, terrain bounds, and unresolved editorial items. It merges planner fields with curated fields to reflect first import, and checks archived rides for structural issues while omitting their editorial warnings. It does not inspect the live CMS, so CMS-only edits are not reflected in editorial warnings. Confirm intensity, notes, route shape, parking pins, and permissions before publishing; the importer does not infer any of them.

Lake Davis Loop (Trailforks route 54895) and Haskell Peak Out and Back (60243)
were downloaded through Trailforks' GPX export on September 28, 2026, with
Brian's explicit approval to accept the data-use agreement for both downloads.
The GeoJSON files retain all original GPX positions/elevations, source URLs,
and SHA-256 hashes. Attribution is shown in the public footer and ride links.
Trailforks' policy requires separate consent for commercial use; this import
is not evidence of such consent. See https://www.trailforks.com/about/data/.

`../curated-rides.json` contains editorial details, flags, and initial home views.
`server/curated-rides.mjs` applies these once, with an audit entry, preserving
CMS edits and existing tracks. The existing planner snapshot stays unchanged.
SQLite backups remain local; the versioned files allow fresh databases to
reconstruct the imported rides. Do not edit the migration marker to overwrite CMS work.

Detailed elevation uses AWS Terrain Tiles, zoom 12, sampled at approximately
30 meters. Rebuild from the project root:

```
node lost-sierra/scripts/build-ride-terrain.mjs lake-davis-loop haskell-peak
```

`lake-davis-water.geojson` is the USGS NHD Lake Davis waterbody, including ten
islands, downloaded September 28, 2026 from:
https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12/query

Query: `where=GNIS_NAME = 'Lake Davis'`, envelope
`-120.60,39.86,-120.45,39.96`, inSR/outSR `4326`,
outFields `GNIS_NAME,ELEVATION,AREASQKM`, returnGeometry `true`, format `geojson`.
The recorded 5,775-foot lake level is converted to meters for the renderer.
This is a mapped shoreline, not a live reservoir-level feed.

## Additional import — September 28, 2026

Eleven more original planner links now have tracks and detailed terrain:
Mills Peak; Gold Valley Rim to Pauley Creek; Jamison Creek; Lower Lakes Basin;
Mount Elwell; Buzzards Roost Ridge; Hough–Tollgate; Hough Classic;
Indian Falls–Acorn–Grotto; Graeagle/Smith Creek; and Lakes Basin Explorer.
Their individual GeoJSON properties record exact source URLs and GPX hashes.

Nine tracks came from the linked public ride-log GPX exports. Two came from
BKXC's linked route-plan GPX exports. These exports did not present a data-use
checkbox. This does not establish commercial permission. Only geometry and
altitude were retained: timestamps, device details and other recording metadata
were dropped. The full tracks were preserved, including climbs on recordings
that the original planner also describes as shuttle options.

Route-plan GPX files contained zero elevations throughout. Their XY positions
were retained, and elevations were sampled from the same AWS/USGS terrain as
the viewer. Recorded ride GPS elevations were kept. Public climbing/descent
figures use the source pages' processed totals, since summing raw GPS elevation
noise grossly overstates gain. Displayed mileage comes from the actual imported
polyline and can differ slightly from Trailforks' processed summary.

Each new ride starts with a route-start flag and a fitted home view. Named peak
flags require verified summit locations and are not guessed from GPS high points.

Cal-Ida and Gold Valley Rim to Pauley Creek are now archived.
Still pending: Hough–Taylor Creek, Hough Lower Loops and South Park need
confirmation for the Trailforks data-use checkbox. Lost & Found Half Calf has a
RideWithGPS source rather than Trailforks and was outside this import batch.

## Buzzards Roost missing start repair

The rider confirmed recording began late and requested the existing finish as
both the start and finish. The Trailforks ride note explicitly mentions the
missing road climb; its map identifies La Porte Road at both endpoints:
https://www.trailforks.com/ridelog/view/80488775/
https://www.trailforks.com/map/?lat=39.8406&lon=-120.8625&z=15

`buzzards-roost-ridge-recorded.geojson` preserves the original import.
`buzzards-roost-ridge-start-road.geojson` is the connector geometry following
OpenStreetMap way 10494068 (La Porte Road), verified against the Trailforks map.
OSM contributors are credited in the footer; OSM data is under ODbL:
https://www.openstreetmap.org/copyright

The nearest road projections are 1.35 m from the finish and 3.35 m from the
recording start. The connector follows the road's northern switchback rather
than drawing a straight link. Elevation is estimated from AWS/USGS terrain,
with small endpoint offsets blended to exactly match recorded elevations.
No recorded point or timestamp is invented or changed. The derived track
records its source geometry hash, added point count, distance and estimated gain.

Rebuild: `node lost-sierra/scripts/repair-buzzards-start.mjs`.
For an existing database, first run `npm run backup --prefix lost-sierra`, then
`node lost-sierra/scripts/apply-buzzards-repair.mjs`. This refuses a changed track,
keeps an audit copy, preserves CMS edits, moves the original start flag and
updates the home only if it still matches the imported default. Fresh databases
seed the corrected route directly.

## Downieville family

- `downieville-original`: **Original**, Trailforks plan [785605](https://www.trailforks.com/routeplan/view/785605/), 1,442 points. Source totals: 16.18 miles, 781 ft climbing, 4,973 ft descending, estimated 2h 58m.
- `downieville-adventure-mode`: **Adventure Mode**, plan [785607](https://www.trailforks.com/routeplan/view/785607/), 2,321 points. Source totals: 22.28 miles, 2,028 ft climbing, 6,214 ft descending, estimated 4h 31m.

Both were exported through Trailforks on September 28, 2026. The exports had zero elevations; XY positions were retained and elevation sampled from AWS terrain. Both are point-to-point routes, with independent terrain, tracks, and CMS records under family ID `downieville`. Their shared finish parking link is **39.559603, -120.830308**; that parking pin does not alter the recorded track endpoint.

Rider-confirmed corrections in `../route-surface-overrides.json` mark Original after mile 15.2 as asphalt, and Adventure Mode's previously unverified segments between miles 8 and 16 as singletrack. Other classified segments are preserved. Incidental road/waterway labels are hidden on these ride views; geometry and endpoint flags remain.

## Mills Peak Shuttle replacement

`mills-peak-shuttle` replaces the old full-pedal Mills Peak ride in the public guide, per the owner's request. The old `mills-peak` entry is archived for recovery.

[Trailforks plan 785873](https://www.trailforks.com/routeplan/view/785873/), exported September 29, 2026. All 1,353 XY points are preserved (12.44 miles calculated; Trailforks displays 12.43). Source totals: 1,007 ft climbing, 3,083 ft descending, estimated 2h 45m.

The shuttle GPX contains zero elevation placeholders, replaced with AWS/USGS terrain samples. OSM matching identifies 9.64 miles singletrack, 2.12 dirt road, 0.40 asphalt and 0.29 unverified; this is map-derived classification, not rider confirmation. Start/finish Maps links use the route endpoints, not separately verified parking lots. Challenging intensity is inherited from the previous Mills Peak guide.

### Shuttle From the Top

`mills-peak-shuttle-from-the-top` is the second option in the `mills-peak` family, alongside `mills-peak-shuttle` (**Highway Shuttle**). The archived full-pedal ride remains archived.

Imported from [Trailforks plan 785881](https://www.trailforks.com/routeplan/view/785881/) on September 29, 2026. All 977 XY points are preserved: 9.24 miles calculated, 9.23 displayed by Trailforks; source totals are 171 ft climbing, 3,044 ft descending, estimated 2h 21m. Zero GPX elevations were replaced with AWS/USGS terrain samples. Endpoint Maps links identify the supplied start and finish, not separately verified parking lots. Challenging intensity follows the existing Mills Peak guide. OSM surface matching estimates 8.56 miles singletrack, 0.40 asphalt and 0.29 unverified.

The one-time `curated-family-v2` migration adds missing family metadata to previously imported routes without changing saved camera views, tracks, notes or explicit CMS family choices.

Both Mills Peak options include an orange summit flag at **39.70481, -120.62281**, labeled **Mills Peak · 7,365 ft**. Location and rounded elevation follow [Peakbagger's Mills Peak entry](https://www.peakbagger.com/peak.aspx?pid=89288), which reports a LiDAR summit elevation of 7,364.5 ft NAVD88 (verified September 29, 2026). The flag opens that source and is separate from the route-start marker. Road and waterway nameplates remain hidden.

## Lower Lakes Basin replacement — Lakes Basin Blue

The existing `lower-lakes-basin-loop` guide now uses [Trailforks plan 785884, Lakes Basin Blue](https://www.trailforks.com/routeplan/view/785884/), replacing ridelog 100899059. Exported September 29, 2026: all 1,394 XY points retained, 16.21 miles calculated (16.20 on Trailforks), 2,864 ft climbing, 2,863 ft descending, estimated 2h 43m. The endpoints are about 10.5 m apart and share one Route Start / Finish flag. The Maps link uses the supplied start coordinate rather than a separately verified parking lot.

Zero GPX elevations were replaced with AWS/USGS terrain samples. Detailed terrain was rebuilt for the new bounds. Map-derived surfaces total about 7.43 miles singletrack, 4.51 asphalt, 2.41 dirt road and 1.87 unverified; none of those classifications is rider-confirmed yet. The old imported camera default is cleared so the new route is fitted automatically; custom CMS home views are preserved.

For existing databases, back up first (`npm run backup --prefix lost-sierra`), then run `node lost-sierra/scripts/apply-lower-lakes-replacement.mjs`. It guards against an unexpected track, retains the prior entry and track in audit history, and preserves unrelated CMS settings. Fresh databases seed the replacement directly.
