import * as THREE from 'three';
import { Terrain, toWorld, type MapData } from './data';

type POI = { name: string; latitude: number; longitude: number; color: string; elevationFt?: number };

// Summit: lidar-based high point, which is southwest of the older GNIS waypoint.
// https://www.peakbagger.com/peak.aspx?pid=2554
// Park: Sierra Trails trail plan.
// https://sierratrails.org/wp-content/uploads/2024/05/TMP-DRAFT-V3-052223.pdf
const places: POI[] = [
  { name: 'Beckwourth Peak', latitude: 39.7725, longitude: -120.43315, elevationFt: 7267, color: '#c8613d' },
  { name: 'Portola City Park', latitude: 39.80559, longitude: -120.46534, color: '#34877b' },
];

function labelTexture(name: string, color: string, elevationFt?: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 144;
  const ctx = canvas.getContext('2d')!;
  ctx.shadowColor = 'rgba(48, 38, 30, .24)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = '#fff8e9';
  ctx.beginPath();
  ctx.roundRect(12, 11, 744, 119, 24);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(92, 72, 54, .28)';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(67, 70, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#302f29';
  if (elevationFt) {
    const elevation = `${elevationFt.toLocaleString()} ft`;
    ctx.font = '700 39px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(elevation, 720, 72);
    const nameWidth = 720 - ctx.measureText(elevation).width - 25 - 105;
    ctx.font = '600 51px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(name, 105, 72, nameWidth);
  } else {
    ctx.font = '600 55px system-ui, sans-serif';
    ctx.fillText(name, 105, 72);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function buildPOIs(map: MapData, terrain: Terrain) {
  const group = new THREE.Group();
  const flags: { marker: THREE.Group; pole: THREE.Mesh; cap: THREE.Mesh; label: THREE.Sprite; isPeak: boolean }[] = [];
  const metersLon = 111320 * Math.cos((map.bbox.south + map.bbox.north) * Math.PI / 360);
  for (const place of places) {
    const x = (place.longitude - map.bbox.west) * metersLon;
    const y = (place.latitude - map.bbox.south) * 111320;
    const marker = new THREE.Group();
    marker.position.set(...toWorld(map, x, y, terrain.heightAt(x, y) + 1));

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.065, 1, 8),
      new THREE.MeshBasicMaterial({ color: '#463e34', depthTest: true }),
    );
    pole.scale.y = 0.85;
    pole.position.y = 0.425;
    marker.add(pole);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 8),
      new THREE.MeshBasicMaterial({ color: place.color, depthTest: true }),
    );
    cap.position.y = 0.85;
    marker.add(cap);

    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(place.name, place.color, place.elevationFt), transparent: true,
      depthTest: true, depthWrite: false,
    }));
    label.position.set(0, 0.85, 0);
    label.scale.set(10.5, 1.97, 1);
    label.visible = false;
    marker.add(label);
    flags.push({ marker, pole, cap, label, isPeak: place.name === 'Beckwourth Peak' });
    group.add(marker);
  }
  return { group, flags };
}
