import { BECKWOURTH_VIEW } from '../../src/beckwourth-preset';
import { PEAK_FLAG_COLOR } from '../../src/poi-colors';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input=(name,label,value,type='number')=>`<label class="field">${label}<input name="${name}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(value)}"></label>`;
export function viewerEditor(entry){
  const v=entry.viewer||{},defaults=entry.id==='beckwourth-peak'?BECKWOURTH_VIEW:{},home=v.home||defaults.home;
  return `<fieldset class="cms-section"><legend>Diorama & camera</legend><p class="small muted">Defaults come from the ride’s terrain and preset. Enable an override to customize it. You can also set the home view directly in the 3D guide.</p><div class="form-grid">${input('viewer.scale','Terrain scale override',v.scale)}${input('viewer.baseElevation','Terrain base elevation (meters)',v.baseElevation)}</div><label class="field check"><input type="checkbox" id="custom-home" ${v.home?'checked':''}>Custom home camera</label><div id="home-fields" class="form-grid">${['position','target'].flatMap(key=>['X','Y','Z'].map((axis,i)=>input(`home.${key}.${i}`,`${key==='position'?'Camera':'Look-at'} ${axis}`,home?.[key]?.[i]))).join('')}${input('home.zoom','Zoom',home?.zoom)}</div><label class="field check"><input type="checkbox" id="custom-beats" ${v.angleBeats?'checked':''}>Custom helicopter camera angles</label><label class="field">Pairs of ride progress (0–1) and angle in degrees<textarea id="camera-beats" class="code-field" spellcheck="false">${esc(JSON.stringify(v.angleBeats||defaults.angleBeats||[[0,-155.6],[1,170]],null,2))}</textarea></label></fieldset><fieldset class="cms-section"><legend>Diorama flags</legend><label class="field check"><input type="checkbox" id="custom-flags" ${v.pointsOfInterest!=null?'checked':''}>Customize this ride’s flags</label><p class="small muted">${defaults.pointsOfInterest?'Beckwourth’s original two flags are used by default.':'This ride has no default flags.'} Each flag has its own location, color, label, elevation, and clickable link.</p><div id="flag-rows"></div><button type="button" class="secondary" id="add-flag">+ Add flag</button></fieldset>`;
}
export function wireViewer(entry,onChange){
  const defaults=entry.id==='beckwourth-peak'?BECKWOURTH_VIEW:{};
  let flags=structuredClone(entry.viewer?.pointsOfInterest??defaults.pointsOfInterest??[]);
  const form=document.querySelector('#entry-form');
  const collectFlags=()=>[...form.querySelectorAll('[data-flag]')].map(row=>{
    const read=k=>row.querySelector(`[data-key="${k}"]`).value;
    const flag={name:read('name'),latitude:Number(read('latitude')),longitude:Number(read('longitude')),color:read('color')};
    for(const key of ['url','elevationFt'])if(read(key).trim())flag[key]=key==='url'?read(key):Number(read(key));
    return flag;
  });
  const sync=()=>{
    for(const el of form.querySelectorAll('#home-fields input'))el.disabled=!form.querySelector('#custom-home').checked;
    form.querySelector('#camera-beats').disabled=!form.querySelector('#custom-beats').checked;
    for(const el of form.querySelectorAll('#flag-rows input,#flag-rows button,#add-flag'))el.disabled=!form.querySelector('#custom-flags').checked;
  };
  const draw=()=>{
    form.querySelector('#flag-rows').innerHTML=flags.map((flag,i)=>`<div class="flag-row" data-flag="${i}"><div class="section-heading"><h3>Flag ${i+1}</h3><button type="button" class="text-button" data-remove="${i}">Remove flag</button></div><div class="form-grid">${[['name','Label','text'],['color','Color','color'],['latitude','Latitude','number'],['longitude','Longitude','number'],['elevationFt','Elevation (feet, optional)','number'],['url','Destination URL','url']].map(([key,label,type])=>`<label class="field">${label}<input data-key="${key}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(flag[key])}" ${['name','latitude','longitude'].includes(key)?'required':''}></label>`).join('')}</div></div>`).join('')||'<p class="small muted">No flags configured.</p>';
    for(const button of form.querySelectorAll('[data-remove]'))button.onclick=()=>{flags=collectFlags();flags.splice(Number(button.dataset.remove),1);draw();onChange();};
    sync();
  };
  draw();
  for(const id of ['custom-home','custom-flags','custom-beats'])form.querySelector('#'+id).onchange=()=>{sync();onChange();};
  form.querySelector('#add-flag').onclick=()=>{flags=collectFlags();flags.push({name:'',color:PEAK_FLAG_COLOR,latitude:entry.coordinates.lat,longitude:entry.coordinates.lng});draw();onChange();};
  return ()=>{
    const viewer={};
    for(const key of ['scale','baseElevation']){const value=form.elements[`viewer.${key}`].value;if(value.trim())viewer[key]=Number(value);}
    if(form.querySelector('#custom-home').checked){const value=key=>{const raw=form.elements[`home.${key}`].value;if(!raw.trim())throw Error('Fill in every custom home camera field.');return Number(raw);};viewer.home={position:[0,1,2].map(i=>value('position.'+i)),target:[0,1,2].map(i=>value('target.'+i)),zoom:value('zoom')};}
    if(form.querySelector('#custom-beats').checked){try{viewer.angleBeats=JSON.parse(form.querySelector('#camera-beats').value);}catch{throw Error('Camera angles must be valid JSON pairs, such as [[0, -155], [1, 170]].');}}
    if(form.querySelector('#custom-flags').checked)viewer.pointsOfInterest=collectFlags();
    return viewer;
  };
}
