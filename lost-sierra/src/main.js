import './style.css';
import { Diorama } from './diorama.js';
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const external=(url,label)=>{try{if(!['https:','http:'].includes(new URL(url).protocol))return '';return `<a href="${escape(url)}" target="_blank" rel="noopener">${escape(label)} ↗</a>`;}catch{return '';}};
const number=n=>n==null?'—':Math.round(n).toLocaleString();
let entries=[],kind='ride',savedOnly=false,selected=null,selection=0,map,track=null;
let saved;try{saved=new Set(JSON.parse(localStorage.getItem('lost-sierra-saved')||'[]'));}catch{saved=new Set();}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3000);}
function toggleSaved(id){saved.has(id)?saved.delete(id):saved.add(id);try{localStorage.setItem('lost-sierra-saved',JSON.stringify([...saved]));}catch{toast('Saved for this visit; browser storage is unavailable.');}$('#saved-count').textContent=saved.size;renderList();if(selected)updateSaved();}
function updateSaved(){const button=$('#detail-save');if(button){button.textContent=saved.has(selected.id)?'♥ Saved':'♡ Save ride';button.ariaPressed=String(saved.has(selected.id));}}
function filtered(){const query=$('#search').value.toLowerCase().trim(),area=$('#area').value,intensity=$('#intensity').value;return entries.filter(e=>e.kind===kind&&(!savedOnly||saved.has(e.id))&&(!area||e.area===area)&&(!intensity||e.intensity===intensity)&&`${e.name} ${e.area} ${e.notes||''} ${e.summary||''}`.toLowerCase().includes(query));}
function renderList(){const rows=filtered().sort((a,b)=>Number(b.hasTrack)-Number(a.hasTrack));$('#result-count').textContent=`${rows.length} ${kind==='ride'?(rows.length===1?'ride':'rides'):(rows.length===1?'adventure':'adventures')}${savedOnly?' saved':''}`;$('#clear').hidden=!($('#search').value||$('#area').value||$('#intensity').value);$('#entries').innerHTML=rows.length?rows.map(e=>`<article class="entry-card"><button class="entry-open" data-id="${escape(e.id)}"><span class="area"><i class="dot"></i>${escape(e.area)}</span><h3>${escape(e.name)}</h3><div class="entry-meta">${e.kind==='ride'?`<span>${escape(e.intensity||'Effort not listed')}</span>${e.climbingFt!=null?`<span>·</span><span>↑ ${number(e.climbingFt)} ft</span>`:''}`:`<span>${escape((e.type||'Explore').replaceAll('-',' + '))}</span>`}${e.hasTrack?'<span class="track-tag">· 3D route</span>':''}</div></button><button class="save-icon ${saved.has(e.id)?'saved':''}" data-save="${escape(e.id)}" aria-label="${saved.has(e.id)?'Unsave':'Save'} ${escape(e.name)}" aria-pressed="${saved.has(e.id)}">${saved.has(e.id)?'♥':'♡'}</button></article>`).join(''):'<p class="empty">No places here yet. Try another filter, or save a few favorites for your next day out.</p>';for(const b of document.querySelectorAll('[data-id]'))b.onclick=()=>selectEntry(b.dataset.id);for(const b of document.querySelectorAll('[data-save]'))b.onclick=()=>toggleSaved(b.dataset.save);map?.setEntries(rows);}
function clearFilters(){for(const id of ['search','area','intensity'])$('#'+id).value='';renderList();}
function reset(push=true){selection++;selected=null;track=null;map?.reset();$('#browse').hidden=false;$('#detail').hidden=true;$('#map-kicker').textContent='NORTHERN CALIFORNIA · 3D FIELD GUIDE';$('#map-title').innerHTML='A little further<br>from the ordinary.';$('#map-status').textContent='Pick a ride. Watch the landscape open up.';if(push)history.pushState({},'','/');renderList();}
async function selectEntry(id,push=true){
  const entry=entries.find(e=>e.id===id);if(!entry){toast('That ride is not published.');return;}
  const token=++selection;selected=entry;track=null;map?.pause();
  $('#browse').hidden=true;$('#detail').hidden=false;$('#detail').innerHTML='<p class="muted">Opening the ride…</p>';
  if(push)history.pushState({},'',`/?ride=${encodeURIComponent(id)}`);
  if(entry.hasTrack){try{const response=await fetch(`/api/tracks/${id}`);if(!response.ok)throw Error();const loaded=await response.json();if(token!==selection)return;track=loaded;}catch{toast('The track could not load. The ride notes are still available.');}}
  if(token!==selection)return;
  renderDetail(entry,track);await map?.select(entry,track);
  $('#map-kicker').textContent=entry.area.toUpperCase();$('#map-title').textContent=entry.name;$('#map-status').textContent=track?'A closer look. Drag to explore.': 'Approximate area location · add a GPS track for the full route';
  $('.sidebar').scrollTop=0;
}
function renderDetail(e,t){
  const distance=t?`${(t.properties.distanceM/1609.344).toFixed(1)}`:'—';
  const stats=e.kind==='ride'?`<div class="stats"><div><b>${distance}</b><span>MILES ${t?'· SHOWN TRACK':''}</span></div><div><b>${number(e.climbingFt)}</b><span>FT CLIMB · PLANNER</span></div><div><b>${number(e.descendingFt)}</b><span>FT DESCENT · PLANNER</span></div></div>`:'';
  $('#detail').innerHTML=`<button class="back-button" id="back">← All ${kind==='ride'?'rides':'adventures'}</button><p class="detail-area">${escape(e.area)}</p><h1 class="detail-title">${escape(e.name)}</h1><div class="entry-meta">${escape(e.intensity||e.type||'Explore')}</div><div class="detail-actions"><button class="secondary" id="detail-save"></button><button class="secondary" id="share">Copy link ↗</button></div>${stats}${t?'<canvas class="profile" id="profile" aria-label="Interactive elevation profile" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></canvas><div class="profile-labels"><span id="profile-elevation">Elevation</span><span id="profile-distance"></span></div><button class="primary play-button" id="play">▶ Play Ride</button><p class="track-source" id="track-source"></p>':`<div class="notice">${e.kind==='ride'?'The route’s GPS track has not been added yet. Explore this area in 3D or open the original route below.':'The map shows the location from the original planner.'}</div>`}
  ${e.notes||e.summary?`<h3>Field notes</h3><p class="detail-copy">${escape(e.notes||e.summary)}</p>`:''}
  <div class="facts">${e.season?`<div class="fact-row"><span>Season</span><b>${escape(e.season)}</b></div>`:''}${e.driveMinutes!=null?`<div class="fact-row"><span>Drive from Everstoke</span><b>~${e.driveMinutes} min</b></div>`:''}${e.shuttleOption&&e.shuttleOption!=='no'?`<div class="fact-row"><span>Shuttle option</span><b>${e.shuttleOption==='partial'?'Partial':'Yes'}</b></div>`:''}${e.ebikeRecommended?'<p class="small muted">The planner recommends an e-bike. Confirm current e-bike access for each trail.</p>':''}</div>
  <div class="detail-links">${external(e.routeUrl,'Open original route')}${external(e.shuttleRouteUrl,'Shuttle route')}${external(e.bkxcVideoUrl,'Watch BKXC’s ride')}</div>${e.incomplete?'<p class="notice">These notes are still being filled in.</p>':''}<p class="track-source">From the Everstoke planner. Locations and seasonal notes need local confirmation; this is not a live trail conditions feed.</p>`;
  $('#back').onclick=()=>reset();$('#detail-save').onclick=()=>toggleSaved(e.id);updateSaved();
  $('#share').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);toast('Ride link copied. This local link works on this computer.');}catch{toast('Copy this ride’s URL from your address bar.');}};
  if(t){$('#track-source').innerHTML=`Showing ${escape(t.properties.sourceLabel)}. ${external(t.properties.sourceUrl,'Track source')}${e.id==='beckwourth-peak'?'<br>This cleaned recording is separate from the planner’s original linked ride.':''}`;$('#play').onclick=()=>{if(map?.playing){map.pause();updatePlayback();}else{map?.play();updatePlayback();}};attachProfile(t);}
}
function updatePlayback(){const button=$('#play');if(button)button.textContent=map?.playing?'Ⅱ Pause':'▶ Play Ride';}
let profileDraw=()=>{};
function attachProfile(t){
  const canvas=$('#profile'),coords=t.geometry.coordinates,elevations=coords.map(p=>p[2]??map?.elevation(p[0],p[1])??0),min=Math.min(...elevations),max=Math.max(...elevations);
  const distances=[0];for(let i=1;i<coords.length;i++)distances.push(distances.at(-1)+Math.hypot((coords[i][0]-coords[i-1][0])*85390,(coords[i][1]-coords[i-1][1])*111320));
  const total=distances.at(-1)||1;
  profileDraw=(f=0)=>{
    if(!canvas.isConnected)return;const w=canvas.clientWidth||280,h=86,dpr=Math.min(devicePixelRatio,2);canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);c.clearRect(0,0,w,h);
    const xy=i=>[distances[i]/total*w,h-10-(elevations[i]-min)/(max-min||1)*(h-20)];c.beginPath();c.moveTo(0,h);for(let i=0;i<coords.length;i++)c.lineTo(...xy(i));c.lineTo(w,h);c.closePath();c.fillStyle='#d7debf';c.fill();c.beginPath();for(let i=0;i<coords.length;i++)c.lineTo(...xy(i));c.strokeStyle='#7a895a';c.lineWidth=1.3;c.stroke();
    const index=Math.min(coords.length-1,distances.findIndex(d=>d>=f*total));c.fillStyle='#d7b75d55';c.fillRect(0,0,f*w,h);c.beginPath();c.moveTo(f*w,0);c.lineTo(f*w,h);c.strokeStyle='#947644';c.stroke();canvas.setAttribute('aria-valuenow',String(Math.round(f*100)));canvas.setAttribute('aria-valuetext',`${(f*t.properties.distanceM/1609.344).toFixed(1)} miles`);$('#profile-elevation').textContent=`${number(elevations[Math.max(0,index)]*3.28084)} ft`;$('#profile-distance').textContent=`${(f*t.properties.distanceM/1609.344).toFixed(1)} / ${(t.properties.distanceM/1609.344).toFixed(1)} mi`;
  };
  const scrub=event=>{if(map?.playing)return;const r=canvas.getBoundingClientRect();map?.setProgress(Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)));};
  canvas.onpointermove=e=>{if(e.pointerType==='mouse'||e.buttons)scrub(e);};canvas.onpointerdown=e=>{if(map?.playing)return;canvas.setPointerCapture(e.pointerId);scrub(e);};canvas.onkeydown=e=>{if(map?.playing)return;if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();map?.setProgress(e.key==='Home'?0:e.key==='End'?1:(map?.progress||0)+(e.key==='ArrowLeft'?-.01:.01));}};profileDraw(0);
}
for(const button of document.querySelectorAll('[data-kind]'))button.onclick=()=>{kind=button.dataset.kind;for(const b of document.querySelectorAll('[data-kind]'))b.classList.toggle('active',b===button);$('#intensity').disabled=kind!=='ride';$('#intensity').value='';reset();};
for(const id of ['search','area','intensity'])$('#'+id).addEventListener(id==='search'?'input':'change',renderList);
$('#clear').onclick=clearFilters;
$('#saved').onclick=()=>{savedOnly=!savedOnly;$('#saved').classList.toggle('active',savedOnly);$('#explore').classList.toggle('active',!savedOnly);reset();};
$('#explore').onclick=()=>{savedOnly=false;$('#saved').classList.remove('active');$('#explore').classList.add('active');clearFilters();reset();};
$('#about').onclick=()=>$('#about-dialog').showModal();$('.dialog-close').onclick=()=>$('#about-dialog').close();$('#map-home').onclick=()=>reset();$('#north').onclick=()=>map?.north();
for(const [id,action] of [['rotate-left','left'],['rotate-right','right'],['zoom-in','in'],['zoom-out','out']]){const button=$('#'+id);button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);if(map)map.held=action;};for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>{if(map)map.held=null;});button.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();if(map)map.held=action;}};button.onkeyup=()=>{if(map)map.held=null;};button.onblur=()=>{if(map)map.held=null;};}
window.addEventListener('blur',()=>{if(map)map.held=null;});
window.addEventListener('popstate',()=>{const id=new URLSearchParams(location.search).get('ride');id?selectEntry(id,false):reset(false);});
try{
  const response=await fetch('/api/catalog');if(!response.ok)throw Error('The guide database could not be reached.');entries=(await response.json()).entries;
  $('#saved-count').textContent=saved.size;
  for(const area of [...new Set(entries.map(e=>e.area))].sort())$('#area').add(new Option(area,area));for(const value of [...new Set(entries.map(e=>e.intensity).filter(Boolean))])$('#intensity').add(new Option(value,value));
  renderList();
  try{map=new Diorama($('#canvas'),$('#map-labels'),{onArea:area=>{$('#area').value=area;renderList();},onProgress:f=>profileDraw(f),onEnd:updatePlayback,onManual:updatePlayback});await map.init(filtered());$('#loading').hidden=true;}catch(e){$('#loading').textContent='The 3D map could not load. You can still browse every ride on the left.';map=null;console.error(e);}
  const initial=new URLSearchParams(location.search).get('ride');if(initial)await selectEntry(initial,false);
}catch(e){$('#loading').textContent=e.message;$('#entries').innerHTML='<p class="empty">Could not load the guide. Refresh to try again.</p>';console.error(e);}
