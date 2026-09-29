import * as THREE from 'three';

// Give neighboring terrain triangles a shared falling-block motion. Keep their
// original world coordinates for the watercolor shader as the pieces move.
export function crumbleLandscape(group: THREE.Group, departing = false) {
  const amounts: THREE.IUniform<number>[] = [];
  const shared = { value: new THREE.Vector4(1, -1, 1, -1) };
  for (const child of group.children) {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const source = mesh.geometry;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    const positions = geometry.getAttribute('position');
    const pieces = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i += 3) {
      const x = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
      const z = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3;
      const cx = (Math.floor(x / 7) + .5) * 7, cz = (Math.floor(z / 7) + .5) * 7;
      const phase = Math.abs(Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453) % 1;
      for (let j = 0; j < 3; j++) pieces.set([cx, cz, phase], (i + j) * 3);
    }
    geometry.setAttribute('aPiece', new THREE.BufferAttribute(pieces, 3));
    mesh.geometry = geometry; source.dispose(); mesh.frustumCulled = false;
    const material = mesh.material, amount = { value: 0 }; amounts.push(amount);
    material.uniforms.uCrumble = amount;
    material.uniforms.uSharedTerrain = shared;
    material.vertexShader = 'attribute vec3 aPiece; uniform float uCrumble; uniform vec4 uSharedTerrain; varying float vPieceFade;\n' + material.vertexShader.replace(
      'gl_Position = projectionMatrix * viewMatrix * world;',
      `float t = smoothstep(aPiece.z * .22, .78 + aPiece.z * .22, uCrumble);
       bool common = world.x >= uSharedTerrain.x && world.x <= uSharedTerrain.y
         && world.z >= uSharedTerrain.z && world.z <= uSharedTerrain.w;
       if (common) t = 0.0;
       vec2 d = position.xz - aPiece.xy;
       world.y -= t * (10.0 + aPiece.z * 6.0);
       world.y += t * (d.x - d.y) * (aPiece.z - .5) * .35;
       world.x += t * (aPiece.z - .5) * 3.0;
       vPieceFade = 1.0 - smoothstep(.55, 1.0, t);
       if (common) vPieceFade = ${departing ? '0.0' : '1.0'};
       gl_Position = projectionMatrix * viewMatrix * world;`);
    material.fragmentShader = 'varying float vPieceFade;\n' + material.fragmentShader.replace(/}\s*$/, 'gl_FragColor.a *= vPieceFade; if (gl_FragColor.a < 0.001) discard;\n}');
    material.transparent = true; material.needsUpdate = true;
  }
  return Object.assign((amount: number) => { for (const uniform of amounts) uniform.value = amount; }, {
    preserve(bounds: [number, number, number, number]) { shared.value.set(...bounds); },
  });
}
