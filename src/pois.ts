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

// Banner height in world units; its width follows the text on it.
export const BANNER_HEIGHT = 1.97;

function labelTexture(name: string, color: string, elevationFt?: number, linked = false) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const nameFont = `700 ${elevationFt ? 49 : 53}px system-ui, sans-serif`;
  const elevationFont = '700 38px system-ui, sans-serif';
  const elevation = elevationFt ? `${elevationFt.toLocaleString()} ft` : '';
  const textStart = linked ? 99 : 36;
  ctx.font = nameFont;
  const nameEnd = textStart + ctx.measureText(name).width;
  ctx.font = elevationFont;
  const textEnd = elevation ? nameEnd + 30 + ctx.measureText(elevation).width : nameEnd;
  // Size the banner to its text, leaving room for the forked fly end.
  const tip = Math.ceil(textEnd + 82);
  canvas.width = tip + 12;
  canvas.height = 144;
  // A straight-edged fabric banner with a forked fly end, not a text card.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(tip, 8);
  ctx.lineTo(tip - 44, 72);
  ctx.lineTo(tip, 136);
  ctx.lineTo(0, 136);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, .17)';
  ctx.fillRect(0, 8, 17, 128);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fffaf0';
  ctx.font = nameFont;
  ctx.fillText(name, textStart, 72);
  if (elevation) {
    ctx.font = elevationFont;
    ctx.textAlign = 'right';
    ctx.fillText(elevation, textEnd, 72);
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
  texture.anisotropy = 8;
  return { texture, width: canvas.width * BANNER_HEIGHT / canvas.height };
}

export type Flag = {
  marker: THREE.Group;
  pole: THREE.Mesh;
  pennant: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  leaf: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  // Copies of the banner that blow away when it is dismissed, each nested as
  // banner → pivot it tumbles around → frame holding the wind direction it left in.
  looseBanners: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];
  bannerWidth: number;
  url?: string;
};

// The small pennant's centroid, which the loose leaf tumbles around.
export const PENNANT_CENTER = new THREE.Vector3(0.373, -0.28, 0);

export function buildPOIs(map: MapData, terrain: Terrain) {
  const group = new THREE.Group();
  const flags: Flag[] = [];
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

    const pennantGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1.12, -0.28, 0, 0, -0.56, 0,
    ], 3));
    const pennantMaterial = new THREE.MeshBasicMaterial({ color: place.color, side: THREE.DoubleSide, depthTest: true, transparent: true });
    const pennant = new THREE.Mesh(pennantGeometry, pennantMaterial);
    pennant.position.y = 1.75;
    marker.add(pennant);

    // A loose copy of the pennant that blows off the pole like a leaf. It sits
    // outside the marker so it keeps drifting the way it came loose while the flag turns.
    const leaf = new THREE.Mesh(
      pennantGeometry.clone().translate(-PENNANT_CENTER.x, -PENNANT_CENTER.y, 0),
      pennantMaterial.clone(),
    );
    leaf.visible = false;
    const leafDrift = new THREE.Group();
    leafDrift.position.copy(marker.position);
    leafDrift.add(leaf);
    group.add(leafDrift);

    // Subdivided along its length so the banner can ripple like cloth.
    const bannerGeometry = new THREE.PlaneGeometry(1, 1, 48, 4);
    bannerGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(bannerGeometry.attributes.position.count * 3).fill(1), 3));
    // Write depth for the fabric but not its clear margins, so the route strokes
    // drawn afterwards pass behind the banner instead of painting over it.
    const { texture, width: bannerWidth } = labelTexture(place.name, place.color, place.elevationFt, Boolean(place.url));
    const label = new THREE.Mesh(bannerGeometry, new THREE.MeshBasicMaterial({
      map: texture, transparent: true,
      side: THREE.DoubleSide, depthTest: true, depthWrite: true, alphaTest: 0.5, vertexColors: true,
    }));
    label.visible = false;
    marker.add(label);
    const looseBanners = [0, 1].map(() => {
      const banner = new THREE.Mesh(bannerGeometry.clone(), label.material.clone());
      banner.visible = false;
      const pivot = new THREE.Group();
      pivot.add(banner);
      const frame = new THREE.Group();
      frame.position.copy(marker.position);
      frame.add(pivot);
      group.add(frame);
      return banner;
    });
    flags.push({ marker, pole, pennant, leaf, label, looseBanners, bannerWidth, url: place.url });
    group.add(marker);
  }
  return { group, flags };
}

// Lays the banner out from its hoist edge: bunched in tight folds while it is
// still unfurling, then flying flat with a gentle ripple running downwind.
export function shapeBanner(label: Flag['label'], width: number, height: number, reveal: number, time: number, still: boolean, billow = 0) {
  const { position, color, uv } = label.geometry.attributes;
  const length = Math.max(width * reveal, 0.001);
  const slack = 1 - reveal;
  const ripple = still ? 0 : 0.08 + 0.55 * slack + billow;
  const cycles = 2.2;
  for (let i = 0; i < position.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    const phase = 2 * Math.PI * (cycles * u - 0.8 * time) + 0.7 * v;
    const amplitude = ripple * u ** 0.8;
    // Shade only the folds turning away, so flat cloth matches the small pennant.
    const slope = amplitude * Math.cos(phase) * 2 * Math.PI * cycles / length;
    const shade = THREE.MathUtils.clamp(1 + 0.3 * slope, 0.62, 1);
    position.setXYZ(i, u * length, (v - 0.5) * height - 0.5 * slack * u * u, amplitude * Math.sin(phase));
    color.setXYZ(i, shade, shade, shade);
  }
  position.needsUpdate = true;
  color.needsUpdate = true;
  label.geometry.computeBoundingSphere();
}
