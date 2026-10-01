// Shared by the regional diorama and the ride viewer: the detailed ride
// terrain blooms in through the regional painting like a spreading wash.
// Both surfaces stay opaque and depth-tested; at every pixel exactly one of
// them is kept, so the swap never shows the background or a sorting seam.

// Ride-entry progress (0..1) at which the detailed terrain owns the ride area.
export function arrivalAt(progress: number): number {
  const t = Math.min(1, Math.max(0, (progress - 0.02) / 0.4));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export const ARRIVAL_BLOOM = /* glsl */ `
uniform float uArrival;
float arrivalHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float arrivalNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(arrivalHash(i), arrivalHash(i + vec2(1.0, 0.0)), u.x),
             mix(arrivalHash(i + vec2(0.0, 1.0)), arrivalHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Sample along the camera's parallel view rays, projected to one plane, so
// two surfaces at different heights under the same pixel agree exactly.
float arrivalField(vec3 world) {
  vec3 back = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 q = (world.xz - back.xz * (world.y / max(back.y, 0.05))) / 7.0;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  return 0.5 * arrivalNoise(q) + 0.32 * arrivalNoise(r * q * 2.07 + 11.3) + 0.18 * arrivalNoise(r * r * q * 4.41 + 3.7);
}
float arrivalReach() { return mix(-0.1, 1.1, uArrival); }
bool arrived(vec3 world) { return uArrival >= 1.0 || arrivalField(world) < arrivalReach(); }
// Darker pigment pooled along the spreading edge of the wash.
float arrivalEdge(vec3 world) {
  if (uArrival >= 1.0) return 0.0;
  return 1.0 - smoothstep(0.0, 0.045, arrivalReach() - arrivalField(world));
}
`;
