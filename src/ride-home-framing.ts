import * as THREE from 'three';

type View = { position: [number, number, number]; target: [number, number, number]; zoom: number };
type Frame = { width: number; height: number; left: number; right: number; top: number; bottom: number };

/** Fit an unconfigured ride into the space left by the card and masthead. */
export function fitRideHome(home: View, points: THREE.Vector3[], scale: number, frame: Frame): View {
  if (!points.length || frame.right <= frame.left || frame.bottom <= frame.top) return home;
  const position = new THREE.Vector3(...home.position), target = new THREE.Vector3(...home.target);
  const basis = new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0));
  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0), up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    const x = point.dot(right), y = point.dot(up);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const frustumHeight = 58 * scale, frustumWidth = frustumHeight * frame.width / frame.height;
  const zoom = Math.max(.08, Math.min(home.zoom,
    .9 * frustumWidth * (frame.right - frame.left) / frame.width / Math.max(.01, maxX - minX),
    .9 * frustumHeight * (frame.bottom - frame.top) / frame.height / Math.max(.01, maxY - minY)));
  const centerX = (frame.left + frame.right) / frame.width - 1;
  const centerY = 1 - (frame.top + frame.bottom) / frame.height;
  const shift = right.clone().multiplyScalar((minX + maxX) / 2 - target.dot(right) - centerX * frustumWidth / (2 * zoom))
    .addScaledVector(up, (minY + maxY) / 2 - target.dot(up) - centerY * frustumHeight / (2 * zoom));
  return { position: position.add(shift).toArray(), target: target.add(shift).toArray(), zoom };
}
