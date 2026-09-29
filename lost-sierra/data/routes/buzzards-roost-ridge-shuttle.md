# Buzzard’s Roost Ridge — shuttle option

Configured September 28, 2026, from Brian’s drop-off pin:
https://www.google.com/maps?q=39.800400,+-120.882580

The nearest full-track vertex is index 2035 (zero-based), approximately 1 m
from the pin and 5.85 miles into the repaired loop. The app resolves that
vertex from the coordinates at load time, then follows the remaining track.
It does not draw a new connecting trail. The finish uses the loop’s parking
link: https://maps.app.goo.gl/dMWgUQ9zvk9EmSez5.

- Distance: about 6.5 miles.
- Climbing: about 1,100 ft. The retained GPS elevations, resampled every 10 m
  and smoothed with a centered 21-sample mean, give 1,121 ft of ascent.
- Moving time: approximately 45 minutes. The retained original GPX points
  (from recorded index 1725; the repaired loop adds 310 points) give 46.1
  minutes using the existing moving filter: intervals at most 15 seconds,
  speed at least 1 m/s. Rounded to the nearest five minutes. This is an
  estimate from the recorded e-bike ride, not a universal rider pace.
- Original GPX provenance is documented in buzzards-roost-ridge-moving-time.md.

The CMS can enable this pattern for other rides and edit drop-off coordinates,
Google Maps link, climb, and moving time. A start must match within 200 m of
an interior track point for the public toggle to appear. This currently
supports a shuttle that follows a suffix of the loop track; an independent
shuttle track is not imported by this configuration.

Both modes share terrain, home view, notes and landmarks. Surface segments
are trimmed with track points, retaining rider-confirmed classifications.
Switching modes pauses playback and preserves the current camera pose.
