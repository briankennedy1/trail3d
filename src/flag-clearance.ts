type Point = { x: number; y: number; z: number };

// Orthographic sightlines are parallel. Find a pole height that keeps the
// entire banner above the ground and the terrain between it and the viewer.
export function flagClearanceHeight(
  anchor: Point, width: number, bannerHeight: number, yaw: number,
  towardViewer: Point, ground: (x: number, z: number) => number | null,
  reach: number, step: number,
) {
  let height = 3.2;
  const horizontal = Math.hypot(towardViewer.x, towardViewer.z);
  const dx = horizontal > 1e-5 ? towardViewer.x / horizontal : 0;
  const dz = horizontal > 1e-5 ? towardViewer.z / horizontal : 0;
  const rise = horizontal > 1e-5 ? towardViewer.y / horizontal : 0;
  const samples = Math.max(8, Math.ceil(width / step));
  for (let i = 0; i <= samples; i++) {
    const offset = 0.12 + width * i / samples;
    const x = anchor.x + Math.cos(yaw) * offset;
    const z = anchor.z - Math.sin(yaw) * offset;
    for (let distance = 0; distance <= (horizontal > 1e-5 ? reach : 0); distance += step) {
      const y = ground(x + dx * distance, z + dz * distance);
      if (y !== null) height = Math.max(height, y - anchor.y - rise * distance + bannerHeight + 0.45);
    }
  }
  return height;
}
