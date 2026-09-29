import { PEAK_FLAG_COLOR } from './poi-colors';
import type { RideViewerOptions } from './ride-viewer';

// Brian's tuned Beckwourth settings. Other rides provide their own data/settings
// to the same viewer; they never inherit Beckwourth's landmarks or camera beats.
export const BECKWOURTH_VIEW: Omit<RideViewerOptions, 'data'> = {
  home: {
    position: [-73.69087860310381, 69.64247192938878, -153.77908766318367],
    target: [-7.2191607049007676, -1.9999999999999996, -7.33110929236435],
    zoom: 1.273332761095871,
  },
  homeStorageKey: 'beckwourth-home-view-v1',
  baseElevation: 1350,
  angleBeats: [[0, -155.6], [0.44, -20], [0.54, 0], [0.60, 75], [0.72, 120], [0.85, 170], [1, 170]],
  pointsOfInterest: [
    // Lidar summit southwest of the older GNIS waypoint; park from Sierra Trails' plan.
    { name: 'Beckwourth Peak', latitude: 39.7725, longitude: -120.43315, elevationFt: 7267, color: PEAK_FLAG_COLOR, url: 'https://www.peakbagger.com/peak.aspx?pid=2554' },
    { name: 'Portola City Park', latitude: 39.80559, longitude: -120.46534, color: '#34877b', url: 'https://maps.app.goo.gl/hbWBTh69hicjwSwB6' },
  ],
};
