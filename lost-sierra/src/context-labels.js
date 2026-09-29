// Applies only to context text; line geometry and POI flags stay intact.
export function applyContextLabels(features=[],setting){
  if(!setting)return features;
  const names=new Set(setting.names);
  for(const feature of features){
    if(setting.mode==='all')feature.showLabel=true;
    else if(setting.mode==='none')feature.showLabel=false;
    else if(setting.mode==='only')feature.showLabel=names.has(feature.name);
    else if(setting.mode==='hide'&&names.has(feature.name))feature.showLabel=false;
  }
  return features;
}
