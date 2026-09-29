# Curated routes

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
