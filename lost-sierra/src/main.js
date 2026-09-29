import './style.css';
import './guide.css';
import { Diorama } from './diorama.js';
import { prepareRide, mountRideViewer } from './ride-experience.js';
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const external=(url,label)=>{try{if(!['https:','http:'].includes(new URL(url).protocol))return '';return `<a href="${escape(url)}" target="_blank" rel="noopener">${escape(label)} ↗</a>`;}catch{return '';}};
const number=n=>n==null?'—':Math.round(n).toLocaleString();
let entries=[],kind='ride',selection=0,map,track=null,canSetHome=false;
let closeRide=()=>{};
const regionalControls=$('.map-controls');
$('.masthead').id='masthead';$('.sidebar').id='ride-card';
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3000);}
function filtered(){const query=$('#search').value.toLowerCase().trim(),area=$('#area').value,intensity=$('#intensity').value;return entries.filter(e=>e.kind===kind&&(!area||e.area===area)&&(!intensity||e.intensity===intensity)&&`${e.name} ${e.area} ${e.notes||''} ${e.summary||''}`.toLowerCase().includes(query));}
function renderList(){const rows=filtered().sort((a,b)=>Number(b.hasTrack)-Number(a.hasTrack));$('#result-count').textContent=`${rows.length} ${kind==='ride'?(rows.length===1?'ride':'rides'):(rows.length===1?'adventure':'adventures')}`;$('#clear').hidden=!($('#search').value||$('#area').value||$('#intensity').value);$('#entries').innerHTML=rows.length?rows.map(e=>`<article class="entry-card"><button class="entry-open" data-id="${escape(e.id)}"><span class="area"><i class="dot"></i>${escape(e.area)}</span><h3>${escape(e.name)}</h3><div class="entry-meta">${e.kind==='ride'?`<span>${escape(e.intensity||'Effort not listed')}</span>${e.climbingFt!=null?`<span>·</span><span>↑ ${number(e.climbingFt)} ft</span>`:''}`:`<span>${escape((e.type||'Explore').replaceAll('-',' + '))}</span>`}${e.hasTrack?'<span class="track-tag">· 3D route</span>':''}</div></button></article>`).join(''):'<p class="empty">No places match your search. Try another filter.</p>';for(const b of document.querySelectorAll('[data-id]'))b.onclick=()=>selectEntry(b.dataset.id);map?.setEntries(rows);}
function clearFilters(){for(const id of ['search','area','intensity'])$('#'+id).value='';renderList();}
function reset(push=true){selection++;closeRide();track=null;map?.reset();$('#browse').hidden=false;$('#detail').hidden=true;$('#map-kicker').textContent='NORTHERN CALIFORNIA · 3D FIELD GUIDE';$('#map-title').innerHTML='A little further<br>from the ordinary.';$('#map-status').textContent='Pick a ride. Watch the landscape open up.';if(push)history.pushState({},'','/');renderList();}
async function selectEntry(id,push=true,animate=true){
  const entry=entries.find(e=>e.id===id);if(!entry){toast('That ride is not published.');return;}
  const token=++selection;closeRide();track=null;
  $('#browse').hidden=true;$('#detail').hidden=false;$('#detail').innerHTML='<p class="muted">Opening the ride…</p>';
  if(push)history.pushState({},'',`/?ride=${encodeURIComponent(id)}`);
  if(entry.hasTrack){try{const response=await fetch(`/api/tracks/${id}`);if(!response.ok)throw Error();const loaded=await response.json();if(token!==selection)return;track=loaded;}catch{toast('The track could not load. The ride notes are still available.');}}
  if(token!==selection)return;
  if(track){await openRide(entry,track,token,animate);return;}
  renderDetail(entry);await map?.select(entry,null,animate);
  $('#map-kicker').textContent=entry.area.toUpperCase();$('#map-title').textContent=entry.name;$('#map-status').textContent=track?'A closer look. Drag to explore.': 'Approximate area location · add a GPS track for the full route';
  $('.sidebar').scrollTop=0;
}
async function openRide(entry,rideTrack,token,animate=true){
  const controller=new AbortController();let viewer,canvas,controls,context;
  closeRide=()=>{
    controller.abort();viewer?.dispose();context?.dispose();canvas?.remove();
    controls?.replaceWith(regionalControls);document.body.classList.remove('ride-open');
    if(map){map.suspended=false;map.controls.enabled=true;map.held=null;}
    $('#map-labels').hidden=false;
  };
  $('#detail').innerHTML='<button class="back-button" id="back">← All rides</button><p class="muted" role="status">Opening the ride…</p>';
  $('#back').onclick=()=>reset();
  try{
    const options=await prepareRide(entry,rideTrack,controller.signal);
    if(token!==selection)return;
    const original=entry.id==='beckwourth-peak';
    const climbing=original?'2,083':number(rideTrack.properties.ascentM==null?entry.climbingFt:rideTrack.properties.ascentM*3.28084);
    $('#detail').innerHTML=`<button class="back-button" id="back">← All rides</button><p class="detail-area">${escape(entry.area)}</p><h2>${escape(entry.name)}</h2>
      <div class="stats"><div><strong id="ride-distance">—</strong><span>miles</span></div><div><strong>${climbing}</strong><span>ft climbing</span></div><div><strong>${original?'2:01':number(rideTrack.properties.descentM==null?entry.descendingFt:rideTrack.properties.descentM*3.28084)}</strong><span>${original?'moving time':'ft descending'}</span></div></div>
      <div class="elevation"><div class="elevation-head"><span>Elevation profile</span><output id="elevation-readout">—</output></div><div id="elevation-chart" class="elevation-chart" role="slider" tabindex="0" aria-label="Elevation profile, ride position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><svg id="elevation-svg" viewBox="0 0 280 96" preserveAspectRatio="none" aria-hidden="true"></svg></div><div class="elevation-axis"><span>0 mi</span><span>Hover or drag to explore</span><span id="profile-end">—</span></div></div>
      <div class="playback"><button id="play" type="button" disabled>▶ Play Ride</button></div>
      <div class="detail-links">${external(rideTrack.properties.sourceUrl,'View original ride')}${external(entry.bkxcVideoUrl,'Watch BKXC’s ride')}</div>
      ${entry.notes||entry.summary?`<details class="ride-notes"><summary>Ride notes</summary><p class="detail-copy">${escape(entry.notes||entry.summary)}</p></details>`:''}`;
    $('#back').onclick=()=>reset();
    if(canSetHome){
      const settings=document.createElement('details');settings.className='ride-settings';
      settings.innerHTML='<summary aria-label="Ride settings" title="Ride settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3-.6 2.1-2 .9-2.1-.5-2 3.5 1.5 1.6v2.3L2.3 15l2 3.5 2.1-.5 2 .9L9 21h4l.6-2.1 2-.9 2.1.5 2-3.5-1.5-1.6v-2.3L19.7 9l-2-3.5-2.1.5-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/></svg></summary><div class="ride-settings-menu"><button type="button" id="set-home" disabled>Set current view as home</button><button type="button" id="go-home" disabled>Go to home view</button><p>Saves the default view for everyone.</p></div>';
      $('#detail').prepend(settings);
      $('#set-home').onclick=async()=>{
        const button=$('#set-home'),home=viewer.captureHome();button.disabled=true;button.textContent='Saving…';
        try{
          const response=await fetch(`/api/ride-home/${entry.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:entry.version,home})});
          const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save the home view.');
          Object.assign(entry,result.entry);
          if(token===selection){viewer.setHome(result.entry.viewer.home);settings.open=false;toast('Home view saved for this ride.');}
        }catch(error){toast(error.message);}finally{button.disabled=false;button.textContent='Set current view as home';}
      };
      $('#go-home').onclick=()=>{viewer.goHome();settings.open=false;};
    }
    controls=regionalControls.cloneNode(true);regionalControls.replaceWith(controls);
    canvas=document.createElement('canvas');canvas.id='scene';canvas.className='ride-scene';
    canvas.setAttribute('aria-label',`3D terrain map of ${entry.name}. Hover or tap a flag to reveal its place name.`);
    $('#canvas').append(canvas);
    if(map){
      map.suspended=true;map.controls.enabled=false;map.held=null;map.tween=null;
      if(animate){
        options.entryView=map.rideEntryView(options.data.map,options.scale);
        context=map.rideContext(options.data.map);options.entryContext=context;
      }
    }
    const enableRide=()=>{
      if(token!==selection)return;
      controls.inert=false;$('#play').disabled=false;
      for(const button of document.querySelectorAll('.ride-settings button'))button.disabled=false;
    };
    controls.inert=true;options.onEntryComplete=enableRide;
    viewer=await mountRideViewer(options);
    if(token!==selection){viewer.dispose();canvas.remove();return;}
    $('.sidebar').scrollTop=0;document.body.classList.add('ride-open');
    $('#map-labels').hidden=true;
    canvas.classList.add('ready');
    if(!options.entryView)enableRide();
  }catch(error){
    if(controller.signal.aborted||token!==selection)return;
    closeRide();console.error(error);
    $('#detail').innerHTML='<button class="back-button" id="back">← All rides</button><p>The ride could not load.</p><button class="secondary" id="retry-ride">Try again</button>';
    $('#back').onclick=()=>reset();$('#retry-ride').onclick=()=>selectEntry(entry.id,false,animate);
  }
}
function renderDetail(e){
  const distance='—';
  const stats=e.kind==='ride'?`<div class="stats"><div><b>${distance}</b><span>MILES</span></div><div><b>${number(e.climbingFt)}</b><span>FT CLIMB · PLANNER</span></div><div><b>${number(e.descendingFt)}</b><span>FT DESCENT · PLANNER</span></div></div>`:'';
  $('#detail').innerHTML=`<button class="back-button" id="back">← All ${kind==='ride'?'rides':'adventures'}</button><p class="detail-area">${escape(e.area)}</p><h1 class="detail-title">${escape(e.name)}</h1><div class="entry-meta">${escape(e.intensity||e.type||'Explore')}</div><div class="detail-actions"><button class="secondary" id="share">Copy link ↗</button></div>${stats}<div class="notice">${e.kind==='ride'?'The route’s GPS track has not been added yet. Explore this area in 3D or open the original route below.':'The map shows the location from the original planner.'}</div>
  ${e.notes||e.summary?`<h3>Field notes</h3><p class="detail-copy">${escape(e.notes||e.summary)}</p>`:''}
  <div class="facts">${e.season?`<div class="fact-row"><span>Season</span><b>${escape(e.season)}</b></div>`:''}${e.driveMinutes!=null?`<div class="fact-row"><span>Drive from Everstoke</span><b>~${e.driveMinutes} min</b></div>`:''}${e.shuttleOption&&e.shuttleOption!=='no'?`<div class="fact-row"><span>Shuttle option</span><b>${e.shuttleOption==='partial'?'Partial':'Yes'}</b></div>`:''}${e.ebikeRecommended?'<p class="small muted">The planner recommends an e-bike. Confirm current e-bike access for each trail.</p>':''}</div>
  <div class="detail-links">${external(e.routeUrl,'Open original route')}${external(e.shuttleRouteUrl,'Shuttle route')}${external(e.bkxcVideoUrl,'Watch BKXC’s ride')}</div>${e.incomplete?'<p class="notice">These notes are still being filled in.</p>':''}<p class="track-source">From the Everstoke planner. Locations and seasonal notes need local confirmation; this is not a live trail conditions feed.</p>`;
  $('#back').onclick=()=>reset();
  $('#share').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);toast('Ride link copied. This local link works on this computer.');}catch{toast('Copy this ride’s URL from your address bar.');}};

}
for(const button of document.querySelectorAll('[data-kind]'))button.onclick=()=>{kind=button.dataset.kind;for(const b of document.querySelectorAll('[data-kind]'))b.classList.toggle('active',b===button);$('#intensity').disabled=kind!=='ride';$('#intensity').value='';reset();};
for(const id of ['search','area','intensity'])$('#'+id).addEventListener(id==='search'?'input':'change',renderList);
$('#clear').onclick=clearFilters;
$('#explore').onclick=()=>{clearFilters();reset();};
$('#about').onclick=()=>$('#about-dialog').showModal();$('.dialog-close').onclick=()=>$('#about-dialog').close();$('#north').onclick=()=>map?.north();
for(const [id,action] of [['rotate-left','left'],['rotate-right','right'],['tilt-up','up'],['tilt-down','down']]){const button=$('#'+id);button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);if(map)map.held=action;};for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>{if(map)map.held=null;});button.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();if(map)map.held=action;}};button.onkeyup=()=>{if(map)map.held=null;};button.onblur=()=>{if(map)map.held=null;};}
window.addEventListener('blur',()=>{if(map)map.held=null;});
window.addEventListener('popstate',()=>{const id=new URLSearchParams(location.search).get('ride');id?selectEntry(id,false):reset(false);});
try{
  const [response,session]=await Promise.all([fetch('/api/catalog'),fetch('/api/session').then(r=>r.ok?r.json():null).catch(()=>null)]);canSetHome=!!session?.canSetHome;if(!response.ok)throw Error('The guide database could not be reached.');entries=(await response.json()).entries;
  for(const area of [...new Set(entries.map(e=>e.area))].sort())$('#area').add(new Option(area,area));for(const value of [...new Set(entries.map(e=>e.intensity).filter(Boolean))])$('#intensity').add(new Option(value,value));
  renderList();
  const initial=new URLSearchParams(location.search).get('ride');
  try{map=new Diorama($('#canvas'),$('#map-labels'),{onArea:area=>{$('#area').value=area;renderList();},});await map.init(filtered());if(!initial)$('#loading').hidden=true;}catch(e){$('#loading').textContent='The 3D map could not load. You can still browse every ride on the left.';map=null;console.error(e);}
  if(initial){
    // Shared links and refreshes open at the saved home view, with no overview
    // flash or crumble. Only an in-page ride selection makes the approach.
    await selectEntry(initial,false,false);
    if(map||document.querySelector('.ride-scene.ready'))$('#loading').hidden=true;
  }
}catch(e){$('#loading').textContent=e.message;$('#entries').innerHTML='<p class="empty">Could not load the guide. Refresh to try again.</p>';console.error(e);}
