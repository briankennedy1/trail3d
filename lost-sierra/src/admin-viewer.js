import { BECKWOURTH_VIEW } from '../../src/beckwourth-preset';
import { PEAK_FLAG_COLOR } from '../../src/poi-colors';
import { availableContextLabels } from './admin-labels.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input=(name,label,value,type='number')=>`<label class="field">${label}<input name="${name}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(value)}"></label>`;
let contextSourcePromise;
function loadContextSource(){
  if(!contextSourcePromise)contextSourcePromise=fetch('/terrain/ride-context.geojson').then(response=>{
    if(!response.ok)throw Error('Map context is unavailable.');return response.json();
  }).catch(error=>{contextSourcePromise=null;throw error;});
  return contextSourcePromise;
}
export function viewerEditor(entry){
  const v=entry.viewer||{},defaults=entry.id==='beckwourth-peak'?BECKWOURTH_VIEW:{},home=v.home||defaults.home;
  const heading=home?Math.atan2(home.position[0]-home.target[0],home.position[2]-home.target[2])*180/Math.PI:-155.6;
  const labelMode=v.contextLabels?.mode||'default';
  return `<fieldset class="cms-section"><legend>Diorama & camera</legend><p class="small muted">Defaults come from the ride’s terrain and preset. Enable an override to customize it. You can also set the home view directly in the 3D guide.</p><div class="form-grid">${input('viewer.scale','Terrain scale override',v.scale)}${input('viewer.baseElevation','Terrain base elevation (meters)',v.baseElevation)}</div><label class="field check"><input type="checkbox" id="custom-home" ${v.home?'checked':''}>Custom home camera</label><div id="home-fields" class="form-grid">${['position','target'].flatMap(key=>['X','Y','Z'].map((axis,i)=>input(`home.${key}.${i}`,`${key==='position'?'Camera':'Look-at'} ${axis}`,home?.[key]?.[i]))).join('')}${input('home.zoom','Zoom',home?.zoom)}</div><label class="field check"><input type="checkbox" id="custom-beats" ${v.angleBeats?'checked':''}>Custom helicopter camera angles</label><label class="field">Pairs of ride progress (0–1) and angle in degrees. Leave disabled to use the ride preset or follow from the home direction.<textarea id="camera-beats" class="code-field" spellcheck="false">${esc(JSON.stringify(v.angleBeats||defaults.angleBeats||[[0,heading],[1,heading]],null,2))}</textarea></label></fieldset><fieldset class="cms-section"><legend>Road &amp; waterway labels</legend><p class="small muted">Only names the GPS route touches can appear on the map. Use these controls to hide more labels or choose among those names. Roads, waterways, and start/finish flags stay visible.</p><label class="field">Map labels<select id="context-label-mode"><option value="default" ${labelMode==='default'?'selected':''}>Ride defaults</option><option value="all" ${labelMode==='all'?'selected':''}>Show all route labels</option><option value="none" ${labelMode==='none'?'selected':''}>Hide all labels</option><option value="only" ${labelMode==='only'?'selected':''}>Show only these names</option><option value="hide" ${labelMode==='hide'?'selected':''}>Hide these names</option></select></label><div id="context-label-choices"><p class="small muted" id="context-label-status" role="status">${entry.hasTrack?'Finding names the route touches…':'Add a GPS track to see map label choices.'}</p><div class="context-label-chips" id="context-label-chips" role="group" aria-label="Map label choices"></div></div><label class="field" id="context-label-names-field">Selected names (one per line; you can also type a name)<textarea id="context-label-names" rows="4" spellcheck="false" placeholder="Gray Eagle Creek&#10;Gold Lake Highway">${esc((v.contextLabels?.names||[]).join('\n'))}</textarea></label><p class="small muted" id="context-label-help">Save and open the ride to check the result.</p></fieldset><fieldset class="cms-section"><legend>Diorama flags</legend><label class="field check"><input type="checkbox" id="custom-flags" ${v.pointsOfInterest!=null?'checked':''}>Customize this ride’s flags</label><p class="small muted">${defaults.pointsOfInterest?'Beckwourth’s peak flag is used by default.':'This ride has no default flags.'} Each flag has its own location, color, label, elevation, and clickable link. Route start and trailhead flags use the Start Google Maps link above, or their coordinates in Google Maps when that field is blank.</p><div id="flag-rows"></div><button type="button" class="secondary" id="add-flag">+ Add flag</button></fieldset>`;
}
export function wireViewer(entry,onChange){
  const defaults=entry.id==='beckwourth-peak'?BECKWOURTH_VIEW:{};
  let flags=structuredClone(entry.viewer?.pointsOfInterest??defaults.pointsOfInterest??[]);
  const form=document.querySelector('#entry-form');
  const labelNames=form.querySelector('#context-label-names');
  const selectedNames=()=>labelNames.value.split(/\r?\n/).map(name=>name.trim()).filter(Boolean);
  const syncLabelChips=()=>{
    const selected=new Set(['only','hide'].includes(form.querySelector('#context-label-mode').value)?selectedNames():[]);
    for(const button of form.querySelectorAll('#context-label-chips button')){
      const chosen=selected.has(button.dataset.name);
      button.classList.toggle('selected',chosen);
      button.setAttribute('aria-pressed',String(chosen));
    }
  };
  const collectFlags=()=>[...form.querySelectorAll('[data-flag]')].map(row=>{
    const read=k=>row.querySelector(`[data-key="${k}"]`).value;
    const flag={...flags[Number(row.dataset.flag)],name:read('name'),latitude:Number(read('latitude')),longitude:Number(read('longitude')),color:read('color')};
    delete flag.url;delete flag.elevationFt;
    for(const key of ['url','elevationFt'])if(read(key).trim())flag[key]=key==='url'?read(key):Number(read(key));
    return flag;
  });
  const sync=()=>{
    for(const el of form.querySelectorAll('#home-fields input'))el.disabled=!form.querySelector('#custom-home').checked;
    form.querySelector('#camera-beats').disabled=!form.querySelector('#custom-beats').checked;
    for(const el of form.querySelectorAll('#flag-rows input,#flag-rows button,#add-flag'))el.disabled=!form.querySelector('#custom-flags').checked;
    const needsNames=['only','hide'].includes(form.querySelector('#context-label-mode').value);
    form.querySelector('#context-label-names-field').hidden=!needsNames;
    form.querySelector('#context-label-names').disabled=!needsNames;
    form.querySelector('#context-label-help').hidden=!needsNames;
  };
  const draw=()=>{
    form.querySelector('#flag-rows').innerHTML=flags.map((flag,i)=>`<div class="flag-row" data-flag="${i}"><div class="section-heading"><h3>Flag ${i+1}</h3><button type="button" class="text-button" data-remove="${i}">Remove flag</button></div><div class="form-grid">${[['name','Label','text'],['color','Color','color'],['latitude','Latitude','number'],['longitude','Longitude','number'],['elevationFt','Elevation (feet, optional)','number'],['url','Destination URL','url']].map(([key,label,type])=>`<label class="field">${label}<input data-key="${key}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(flag[key])}" ${['name','latitude','longitude'].includes(key)?'required':''}></label>`).join('')}</div></div>`).join('')||'<p class="small muted">No flags configured.</p>';
    for(const button of form.querySelectorAll('[data-remove]'))button.onclick=()=>{flags=collectFlags();flags.splice(Number(button.dataset.remove),1);draw();onChange();};
    sync();
  };
  draw();
  for(const id of ['custom-home','custom-flags','custom-beats'])form.querySelector('#'+id).onchange=()=>{sync();onChange();};
  form.querySelector('#context-label-mode').onchange=()=>{sync();syncLabelChips();onChange();};
  labelNames.addEventListener('input',syncLabelChips);
  if(entry.id&&entry.hasTrack){
    Promise.all([fetch(`/api/tracks/${encodeURIComponent(entry.id)}`).then(response=>{if(!response.ok)throw Error('Ride track is unavailable.');return response.json();}),loadContextSource()]).then(([track,source])=>{
      if(document.querySelector('#entry-form')!==form)return;
      const names=availableContextLabels(source,track,entry);
      form.querySelector('#context-label-status').textContent=names.length?`${names.length} names touched by the route. Click to add or remove.`:'No named roads or waterways touch this route.';
      const chips=form.querySelector('#context-label-chips');
      chips.innerHTML=names.map(name=>`<button type="button" data-name="${esc(name)}" aria-pressed="false">${esc(name)}</button>`).join('');
      chips.onclick=event=>{
        const button=event.target.closest('button[data-name]');if(!button)return;
        const mode=form.querySelector('#context-label-mode');
        if(!['only','hide'].includes(mode.value)){mode.value='only';labelNames.value='';sync();}
        const selected=new Set(selectedNames());
        if(selected.has(button.dataset.name))selected.delete(button.dataset.name);else selected.add(button.dataset.name);
        labelNames.value=[...selected].join('\n');
        if(!selected.size){mode.value=mode.value==='hide'?'default':'none';sync();}
        syncLabelChips();onChange();
      };
      syncLabelChips();
    }).catch(()=>{if(document.querySelector('#entry-form')===form)form.querySelector('#context-label-status').textContent='Map names could not load. You can still type a name.';});
  }
  form.querySelector('#add-flag').onclick=()=>{flags=collectFlags();flags.push({name:'',color:PEAK_FLAG_COLOR,latitude:entry.coordinates.lat,longitude:entry.coordinates.lng});draw();onChange();};
  return ()=>{
    const viewer={...entry.viewer};
    for(const key of ['scale','baseElevation']){const value=form.elements[`viewer.${key}`].value;if(value.trim())viewer[key]=Number(value);else delete viewer[key];}
    if(form.querySelector('#custom-home').checked){const value=key=>{const raw=form.elements[`home.${key}`].value;if(!raw.trim())throw Error('Fill in every custom home camera field.');return Number(raw);};viewer.home={position:[0,1,2].map(i=>value('position.'+i)),target:[0,1,2].map(i=>value('target.'+i)),zoom:value('zoom')};}
    else delete viewer.home;
    if(form.querySelector('#custom-beats').checked){try{viewer.angleBeats=JSON.parse(form.querySelector('#camera-beats').value);}catch{throw Error('Camera angles must be valid JSON pairs, such as [[0, -155], [1, -155]].');}}
    else delete viewer.angleBeats;
    if(form.querySelector('#custom-flags').checked)viewer.pointsOfInterest=collectFlags();
    else delete viewer.pointsOfInterest;
    const labelMode=form.querySelector('#context-label-mode').value;
    if(labelMode==='default')delete viewer.contextLabels;
    else {
      const names=['only','hide'].includes(labelMode)?form.querySelector('#context-label-names').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean):[];
      if(['only','hide'].includes(labelMode)&&!names.length)throw Error('Add at least one exact map label name.');
      viewer.contextLabels={mode:labelMode,names};
    }
    return viewer;
  };
}
