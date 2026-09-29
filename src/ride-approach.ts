import * as THREE from 'three';

/** Keep a destination on its screen-space path while camera zoom/orbit change. */
export function frameApproachTarget(
  target: THREE.Vector3, offset: THREE.Vector3, zoom: number, progress: number,
  from: { position: THREE.Vector3; target: THREE.Vector3; zoom: number },
  destination: THREE.Vector3, up: THREE.Vector3,
) {
  const basis = (position: THREE.Vector3, target: THREE.Vector3) => {
    const rotation = new THREE.Matrix4().lookAt(position, target, up);
    return [new THREE.Vector3().setFromMatrixColumn(rotation, 0), new THREE.Vector3().setFromMatrixColumn(rotation, 1)];
  };
  const fromBasis = basis(from.position, from.target);
  const currentBasis = basis(target.clone().add(offset), target);
  const fromFocus = destination.clone().sub(from.target);
  for (let axis = 0; axis < 2; axis++) {
    const screenDistance = fromFocus.dot(fromBasis[axis]) * from.zoom * (1 - progress) / zoom;
    const correction = destination.clone().sub(target).dot(currentBasis[axis]) - screenDistance;
    target.addScaledVector(currentBasis[axis], correction);
  }
  return target;
}
