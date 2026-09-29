import * as THREE from 'three';

// Only the geographic difference is animated. Shared terrain is separate mesh
// geometry with its original shader, so it cannot fall, tilt or fade.
export function crumbleLandscape(group: THREE.Group, departing = false) {
  const amount = { value: 0 };
  return Object.assign((value: number) => { amount.value = value; }, {
    preserve(bounds: [number, number, number, number]) {
      for (const child of [...group.children]) {
        const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
        const source = mesh.geometry;
        const flat = source.index ? source.toNonIndexed() : source.clone();
        const positions = flat.getAttribute('position');
        const shared: number[] = [], changed: number[] = [];
        // Test whole triangles, with one grid-cell tolerance at the seam.
        const epsilon = .35;
        for (let i = 0; i < positions.count; i += 3) {
          let common = true;
          for (let j = 0; j < 3; j++) {
            const x = positions.getX(i+j) + group.position.x;
            const z = positions.getZ(i+j) + group.position.z;
            common &&= x >= bounds[0]-epsilon && x <= bounds[1]+epsilon
              && z >= bounds[2]-epsilon && z <= bounds[3]+epsilon;
          }
          (common ? shared : changed).push(i,i+1,i+2);
        }
        function subset(indices: number[]) {
          const geometry = new THREE.BufferGeometry();
          for (const [name, attribute] of Object.entries(flat.attributes)) {
            const values = new Float32Array(indices.length * attribute.itemSize);
            indices.forEach((index, i) => {
              for (let k=0;k<attribute.itemSize;k++) values[i*attribute.itemSize+k]=attribute.array[index*attribute.itemSize+k];
            });
            geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));
          }
          return geometry;
        }
        if (!departing && shared.length) {
          const fixed = new THREE.Mesh(subset(shared), mesh.material.clone());
          group.add(fixed);
        }
        mesh.geometry = subset(changed); source.dispose(); flat.dispose();
        if (!changed.length) { mesh.visible=false; continue; }
        const p = mesh.geometry.getAttribute('position');
        const pieces = new Float32Array(p.count*3);
        for(let i=0;i<p.count;i+=3){
          const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3;
          const z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
          const cx=(Math.floor(x/7)+.5)*7,cz=(Math.floor(z/7)+.5)*7;
          const phase=Math.abs(Math.sin(cx*12.9898+cz*78.233)*43758.5453)%1;
          for(let j=0;j<3;j++)pieces.set([cx,cz,phase],(i+j)*3);
        }
        mesh.geometry.setAttribute('aPiece',new THREE.BufferAttribute(pieces,3));
        mesh.frustumCulled=false;
        const material=mesh.material;material.uniforms.uCrumble=amount;
        material.vertexShader='attribute vec3 aPiece; uniform float uCrumble; varying float vPieceFade;\n'+material.vertexShader.replace(
          'gl_Position = projectionMatrix * viewMatrix * world;',
          `float t = smoothstep(aPiece.z * .22, .78 + aPiece.z * .22, uCrumble);
           vec2 d = position.xz - aPiece.xy;
           world.y -= t * (6.0 + aPiece.z * 4.0);
           world.y += t * (d.x - d.y) * (aPiece.z - .5) * .15;
           vPieceFade = 1.0 - smoothstep(.55, 1.0, t);
           gl_Position = projectionMatrix * viewMatrix * world;`);
        material.fragmentShader='varying float vPieceFade;\n'+material.fragmentShader.replace(/}\s*$/,'gl_FragColor.a *= vPieceFade; if (gl_FragColor.a < 0.001) discard;\n}');
        material.transparent=true;material.needsUpdate=true;
      }
    },
  });
}
