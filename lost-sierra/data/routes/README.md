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
reconstruct the two rides. Do not edit the migration marker to overwrite CMS work.

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
