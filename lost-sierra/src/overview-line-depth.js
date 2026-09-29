// Overview strokes have a cosmetic width in pixels. Test them slightly in
// front of their centerline so the nearby slope cannot cut through that width.
// The margin follows zoom; farther hills still occlude the route normally.
export function overviewLineDepth(material){
  const compile=material.onBeforeCompile,cacheKey=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=function(shader,...args){
    compile.call(this,shader,...args);
    shader.vertexShader=shader.vertexShader.replace('gl_Position = clip;',`
      clip.z += 2.0 * linewidth * projectionMatrix[2][2] / (resolution.y * projectionMatrix[1][1]) * clip.w;
      gl_Position = clip;`);
  };
  material.customProgramCacheKey=()=>`${cacheKey()}-overview-depth`;
  return material;
}
