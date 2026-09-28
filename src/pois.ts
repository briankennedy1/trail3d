import * as THREE from 'three';
import { Terrain, toWorld, type MapData } from './data';

type POI = { name: string; latitude: number; longitude: number; color: string; elevationFt?: number; url?: string };

// Summit: lidar-based high point, which is southwest of the older GNIS waypoint.
// https://www.peakbagger.com/peak.aspx?pid=2554
// Park: Sierra Trails trail plan.
// https://sierratrails.org/wp-content/uploads/2024/05/TMP-DRAFT-V3-052223.pdf
const places: POI[] = [
  { name: 'Beckwourth Peak', latitude: 39.7725, longitude: -120.43315, elevationFt: 7267, color: '#c8613d', url: 'https://www.peakbagger.com/peak.aspx?pid=2554' },
  { name: 'Portola City Park', latitude: 39.80559, longitude: -120.46534, color: '#34877b', url: 'https://maps.app.goo.gl/hbWBTh69hicjwSwB6' },
];

function labelTexture(name: string, color: string, elevationFt?: number, linked = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 144;
  const ctx = canvas.getContext('2d')!;
  // A straight-edged fabric banner with a forked fly end, not a text card.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(756, 8);
  ctx.lineTo(712, 72);
  ctx.lineTo(756, 136);
  ctx.lineTo(0, 136);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, .17)';
  ctx.fillRect(0, 8, 17, 128);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fffaf0';
  const textStart = linked ? 99 : 36;
  if (elevationFt) {
    const elevation = `${elevationFt.toLocaleString()} ft`;
    ctx.font = '700 38px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(elevation, linked ? 645 : 674, 72);
    const nameWidth = (linked ? 645 : 674) - ctx.measureText(elevation).width - 30 - textStart;
    ctx.font = '700 49px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(name, textStart, 72, nameWidth);
  } else {
    ctx.font = '700 53px system-ui, sans-serif';
    ctx.fillText(name, textStart, 72, linked ? 537 : 640);
  }
  if (linked) {
    // Standard external-link mark, drawn on the fabric rather than overlaid on it.
    ctx.strokeStyle = '#fffaf0';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(65, 68);
    ctx.lineTo(65, 91);
    ctx.lineTo(39, 91);
    ctx.lineTo(39, 65);
    ctx.lineTo(62, 65);
    ctx.moveTo(55, 76);
    ctx.lineTo(81, 50);
    ctx.moveTo(67, 50);
    ctx.lineTo(81, 50);
    ctx.lineTo(81, 64);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function buildPOIs(map: MapData, terrain: Terrain) {
  const group = new THREE.Group();
  const flags: { marker: THREE.Group; pole: THREE.Mesh; pennant: THREE.Mesh; label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; isPeak: boolean; url?: string }[] = [];
  const metersLon = 111320 * Math.cos((map.bbox.south + map.bbox.north) * Math.PI / 360);
  for (const place of places) {
    const x = (place.longitude - map.bbox.west) * metersLon;
    const y = (place.latitude - map.bbox.south) * 111320;
    const marker = new THREE.Group();
    marker.position.set(...toWorld(map, x, y, terrain.heightAt(x, y) + 1));

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, 1, 8),
      new THREE.MeshBasicMaterial({ color: '#463e34', depthTest: true }),
    );
    pole.scale.y = 1.75;
    pole.position.y = 0.875;
    marker.add(pole);

    const pennant = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0, 1.12, -0.28, 0, 0, -0.56, 0,
      ], 3)),
      new THREE.MeshBasicMaterial({ color: place.color, side: THREE.DoubleSide, depthTest: true, transparent: true }),
    );
    pennant.position.y = 1.75;
    marker.add(pennant);

    const label = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: labelTexture(place.name, place.color, place.elevationFt, Boolean(place.url)), transparent: true,
      side: THREE.DoubleSide, depthTest: true, depthWrite: false,
    }));
    label.scale.set(10.5, 1.97, 1);
    label.visible = false;
    marker.add(label);
    flags.push({ marker, pole, pennant, label, isPeak: place.name === 'Beckwourth Peak', url: place.url });
    group.add(marker);
  }
  return { group, flags };
}
