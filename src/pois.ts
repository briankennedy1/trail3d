import * as THREE from 'three';
import { Terrain, toWorld, type MapData } from './data';

type POI = { name: string; latitude: number; longitude: number; color: string };

// Summit: USGS/GNIS coordinate via TopoQuest. Park: Sierra Trails trail plan.
// https://www.topoquest.com/place/california/populated-place/beckwourth/1658022
// https://sierratrails.org/wp-content/uploads/2024/05/TMP-DRAFT-V3-052223.pdf
const places: POI[] = [
  { name: 'Beckwourth Peak', latitude: 39.7735129, longitude: -120.4321572, color: '#c8613d' },
  { name: 'Portola City Park', latitude: 39.80559, longitude: -120.46534, color: '#34877b' },
];

function labelTexture(name: string, color: string) {
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
  ctx.font = '600 55px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#302f29';
  ctx.fillText(name, 105, 72);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function buildPOIs(map: MapData, terrain: Terrain) {
  const group = new THREE.Group();
  const billboards: THREE.Sprite[] = [];
  const metersLon = 111320 * Math.cos((map.bbox.south + map.bbox.north) * Math.PI / 360);
  for (const place of places) {
    const x = (place.longitude - map.bbox.west) * metersLon;
    const y = (place.latitude - map.bbox.south) * 111320;
    const marker = new THREE.Group();
    marker.position.set(...toWorld(map, x, y, terrain.heightAt(x, y) + 1));

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, 1.75, 8),
      new THREE.MeshBasicMaterial({ color: '#463e34', depthTest: true }),
    );
    pole.position.y = 0.875;
    marker.add(pole);

    const pennant = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
        0, 1.75, 0, 1.12, 1.47, 0, 0, 1.19, 0,
      ], 3)),
      new THREE.MeshBasicMaterial({ color: place.color, side: THREE.DoubleSide, depthTest: true }),
    );
    marker.add(pennant);

    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(place.name, place.color), transparent: true,
      depthTest: true, depthWrite: false,
    }));
    label.position.set(0, 2.65, 0);
    label.scale.set(10.5, 1.97, 1);
    label.userData.isPeak = place.name === 'Beckwourth Peak';
    marker.add(label);
    billboards.push(label);
    group.add(marker);
  }
  return { group, billboards };
}
