# Buzzards Roost Ridge elevation review

Reviewed September 28, 2026 for the repaired 12.3-mile loop.

Public estimate: **3,600 ft climbing and 3,600 ft descending**. Equal ascent
and descent reflects the route's identical start and finish.

The previous 4,156 / 4,170 ft figures combined Trailforks' processed partial
recording totals with the reconstructed road segment's unsmoothed terrain gain.
Simply summing every rise in the full phone recording gives 6,328 ft; small
GPS fluctuations make that unsuitable as a public climbing estimate.

## Method and cross-check

- Input: `buzzards-roost-ridge.geojson`, including the reconstructed road climb.
- Resample elevation at 10 m intervals along the track (local horizontal
  distance using 85,500 m/degree longitude and 111,320 m/degree latitude).
- Apply a centered moving average with a 50 m radius (approximately 100 m
  window), retaining the shared endpoint elevation.
- Accumulate climbs and descents between extrema, accepting reversals only
  after at least 5 m of vertical change. Include both endpoints.
- Recorded elevations yield **3,574 ft** ascent and descent.
- Independently sample the existing AWS/USGS terrain grid at those same
  locations and apply the same filter: **3,538 ft** ascent and descent.
- Round the recorded-elevation estimate to the nearest 100 ft: **3,600 ft**.

Using 30–100 m smoothing radii gives roughly 3,400–3,700 ft. This remains
an estimate, not a surveyed total. The route geometry, recorded elevations,
elevation chart, and original import metadata are retained unchanged.

Terrain source: https://registry.opendata.aws/terrain-tiles/
Recording source: https://www.trailforks.com/ridelog/view/80488775/
