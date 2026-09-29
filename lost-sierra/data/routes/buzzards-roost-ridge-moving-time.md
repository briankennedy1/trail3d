# Buzzards Roost Ridge moving time

Reviewed September 28, 2026. Display **approximately 1:25 (85 minutes)**
for the repaired loop, based on this rider's **e-bike** recording.

## Source

Trailforks ride log https://www.trailforks.com/ridelog/view/80488775/
shows **01:09:36 moving time**, **01:49:35 total time**, and activity **E-Bike**.
The rider's note says the beginning of the road climb was not recorded.

The original GPX has 5,832 timestamped points. Its SHA-256 matches the
original import: `2f6910710ad5074457edaaf723e57869f2ec79fde2b2d8ee2bbd60ad73141810`.
The reconstructed section has no invented timestamps.

## Calculation

- Missing road: **1.96 miles**, roughly **1,125 ft net elevation gain**.
- Reference road: the first **3.89 recorded miles** on La Porte Road
  (full repaired track indexes 310 through 2038), before the long stop and
  departure from the mapped asphalt road.
- Use the GPX timestamps to measure movement on this reference climb.
  Exclude intervals longer than 15 seconds and speeds below 1 m/s.
  This yields **26:10** moving on the recorded reference road.
- Resample elevation every 10 m and smooth with a centered 11-sample mean.
  Divide the road into 100 m sections. Match the missing climb to observed
  road paces in grade bins: downhill, 0–4%, 4–8%, 8–12%, and 12% or steeper.
- Those recorded paces are approximately **4.79, 5.43, 7.53, 7.63,
  and 8.39 minutes/mile**, respectively.
- Applying them to the missing road gives **14:54 additional moving time**.
- **1:09:36 + 0:14:54 = approximately 1:24:30**, rounded to the nearest
  five minutes for the public estimate: **1:25**.

Changing the movement threshold to 0.75 or 1.25 m/s estimates 15:05 or
13:56 for the missing climb, respectively. This sensitivity does not include
all uncertainty in grade, assist level, rider effort, or terrain data.
This is an extrapolation of the recorded e-bike ride, not a promised duration
for every rider or a reconstruction of elapsed time including stops.

The CMS stores `movingMinutes: 85` and `movingTimeEstimated: true`.
The estimate marker remains editable in the CMS.
