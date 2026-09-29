import './style.css';
import './guide.css';
import { Diorama } from './diorama.js';
import { prepareRide, mountRideViewer } from './ride-experience.js';
import { rideVariant, shuttleStartIndex } from './ride-variants.js';
import { groupRideEntries, familyOptions } from './ride-families.js';
import { SURFACE_COLORS } from '../../src/route-surfaces';
const $=s=>document.querySelector(s);
const creditsDialog=$('#credits-dialog');
$('#credits-open').onclick=()=>creditsDialog.showModal();
creditsDialog.addEventListener('click',event=>{
  if(event.target!==creditsDialog)return;
  const r=creditsDialog.getBoundingClientRect();
  if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)creditsDialog.close();
});
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const descriptionParagraphs=text=>String(text).split(/\r\n?|\n/).map(p=>p.trim()).filter(Boolean).map(p=>`<p>${escape(p)}</p>`).join('');
const external=(url,label,iconName,visibleLabel)=>{
  try{
    const {protocol,hostname}=new URL(url);if(!['https:','http:'].includes(protocol))return '';
    const on=domain=>hostname===domain||hostname.endsWith(`.${domain}`);
    const brand=on('youtube.com')||on('youtu.be')?'youtube':on('trailforks.com')?'trailforks':null;
    const icon=iconName==='parking'?'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="2" fill="#1769b5"/><path d="M9 18V6h4a3.5 3.5 0 0 1 0 7H9" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>'
      :brand?`<img class="link-brand-icon" src="/icons/${brand}.svg" alt="" aria-hidden="true" width="22" height="22">`
      :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg>';
    return `<a ${visibleLabel?'class="parking-link"':''} href="${escape(url)}" target="_blank" rel="noopener noreferrer" title="${escape(label)}" aria-label="${escape(label)}">${icon}${visibleLabel?`<span>${escape(visibleLabel)}</span>`:''}</a>`;
  }catch{return '';}
};
const accessLinks=e=>{
  const same=e.sameStartFinish||(e.startMapsUrl&&e.startMapsUrl===e.finishMapsUrl);
  return external(e.startMapsUrl,same?'Parking · Google Maps':'Start parking · Google Maps','parking',same?undefined:'Start Parking')+(same?'':external(e.finishMapsUrl,'Finish parking · Google Maps','parking','Finish Parking'));
};
const ridePanels=(entry,content,links,parkingRow='')=>`<div class="ride-content">
  <div id="ride-profile-panel" class="ride-content-panel">${content}</div>
  <section id="ride-notes-panel" class="ride-content-panel ride-notes-panel" aria-label="Ride notes" aria-hidden="true" inert>
    <button type="button" class="notes-back" id="ride-notes-back">← Back to ride</button>
    <h3>Ride notes</h3><div class="detail-copy ride-description">${descriptionParagraphs(entry.notes||entry.summary||'Ride notes are coming soon.')}</div>
  </section>
</div><div class="detail-links"><button type="button" id="ride-info" title="Ride notes" aria-label="Ride notes" aria-controls="ride-notes-panel" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path stroke-linejoin="round" d="M12 5.5C9 3.5 5.5 3.5 2 4.5v15c3.5-1 7-1 10 1 3-2 6.5-2 10-1v-15c-3.5-1-7-1-10 1Zm0 0v15"/></svg></button>${links}${parkingRow?`<div class="parking-row">${parkingRow}</div>`:''}</div>`;
function wireRideNotes(onOpen=()=>{},beginResize=()=>()=>{}){
  const button=$('#ride-info'),content=$('.ride-content'),profile=$('#ride-profile-panel'),notes=$('#ride-notes-panel');
  const show=open=>{
    const finishResize=beginResize();
    if(open)onOpen();
    content.classList.toggle('show-notes',open);button.setAttribute('aria-pressed',String(open));
    profile.inert=open;notes.inert=!open;
    profile.setAttribute('aria-hidden',String(open));notes.setAttribute('aria-hidden',String(!open));
    $('.sidebar').scrollTop=0;window.scrollTo({top:0,behavior:'instant'});
    if(!open)button.focus({preventScroll:true});
    finishResize();
  };
  button.onclick=()=>show(button.getAttribute('aria-pressed')!=='true');
  $('#ride-notes-back').onclick=()=>show(false);
}
function fitRideTitle(){
  const title=$('#detail h2');
  if(!title||!title.clientWidth)return;
  title.style.fontSize='';
  const range=document.createRange();range.selectNodeContents(title);
  for(let pass=0;pass<3;pass++){
    const width=range.getBoundingClientRect().width,available=title.clientWidth-1;
    if(width<=available)break;
    title.style.fontSize=`${parseFloat(getComputedStyle(title).fontSize)*available/width}px`;
  }
}
let titleWidth=0;
new ResizeObserver(([entry])=>{
  if(entry.contentRect.width===titleWidth)return;
  titleWidth=entry.contentRect.width;fitRideTitle();
}).observe($('#detail'));
document.fonts.ready.then(fitRideTitle);
document.fonts.addEventListener('loadingdone',fitRideTitle);
const number=n=>n==null?'—':Math.round(n).toLocaleString();
const movingTime=e=>{
  const value=e.movingMinutes??(e.id==='beckwourth-peak'?121:null);
  if(value==null||!Number.isFinite(value))return '—';
  const minutes=Math.round(value);
  const hours=Math.floor(minutes/60),remainder=minutes%60;
  return `${e.movingTimeEstimated?'~':''}${hours?`${hours}h `:''}${remainder}m`;
};
const intensityDisplay=entry=>{
  const label=entry.intensity?.trim()||'Not rated';
  const levels={'mellow-ish':1,moderate:2,challenging:3,intense:4};
  const level=levels[label.toLowerCase()]||0;
  const symbol=level===4?'<svg class="intensity-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 22 12 12 22 2 12Z" fill="#000"/></svg>'
    :level===3?'<svg class="intensity-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 22 12 12 22 2 12Z" fill="#000" stroke="#fff" stroke-width="1.8"/></svg>'
    :level===2?'<svg class="intensity-symbol" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" fill="#376782" stroke="#fff" stroke-width="1.8"/></svg>':'';
  return `<div class="ride-intensity intensity-${level}" aria-label="Intensity: ${escape(label)}">${symbol}<strong>${escape(label)}</strong></div>`;
};
const surfaceKey=types=>{
  const labels={singletrack:'Singletrack',asphalt:'Asphalt',dirt:'Dirt Road',unknown:'Unverified'};
  return `<div class="surface-key" aria-label="Route surface key" title="Surface estimates from OpenStreetMap, with rider-confirmed corrections. Unverified sections need surface confirmation.">${Object.entries(labels).filter(([type])=>type!=='unknown'||types?.includes(type)).map(([type,label])=>`<span><i style="background:${SURFACE_COLORS[type]}" aria-hidden="true"></i>${label}</span>`).join('')}</div>`;
};
let entries=[],kind='ride',selection=0,map,track=null,canSetHome=false;
let closeRide=()=>{},captureRideTransition=null,returnToOverview=null,returning=false;
let settingsContext=null,overviewHome={version:0};
const regionalControls=$('.map-controls');
$('.masthead').id='masthead';$('.sidebar').id='ride-card';
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3000);}

function renderSettings(){
  document.querySelector('.ride-settings')?.remove();
  const context=settingsContext;if(!canSetHome||!context)return;
  const settings=document.createElement('details');settings.className='ride-settings';
  settings.innerHTML='<summary aria-label="Ride settings" title="Ride settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3-.6 2.1-2 .9-2.1-.5-2 3.5 1.5 1.6v2.3L2.3 15l2 3.5 2.1-.5 2 .9L9 21h4l.6-2.1 2-.9 2.1.5 2-3.5-1.5-1.6v-2.3L19.7 9l-2-3.5-2.1.5-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/></svg></summary><div class="ride-settings-menu"><button type="button" id="set-home" disabled>Set current view as home</button><button type="button" id="go-home" disabled>Go to home view</button><p>Saves the default view for everyone.</p></div>';
  const summary=settings.querySelector('summary');summary.ariaLabel=context.label;summary.title=context.label;
  if(context.entryId){
    const edit=document.createElement('a');edit.href=`/admin.html?entry=${encodeURIComponent(context.entryId)}`;
    edit.textContent='Edit current route';settings.querySelector('.ride-settings-menu').prepend(edit);
  }
  document.body.append(settings);
  for(const button of settings.querySelectorAll('button'))button.disabled=!context.ready();
  settings.querySelector('#go-home').onclick=()=>{context.goHome();settings.open=false;};
  settings.querySelector('#set-home').onclick=async()=>{
    const button=settings.querySelector('#set-home');button.disabled=true;button.textContent='Saving…';
    try{await context.save(context.capture());settings.open=false;toast('Home view saved for everyone.');}
    catch(error){toast(error.message);}
    finally{button.disabled=false;button.textContent='Set current view as home';}
  };
}
function showOverviewSettings(){
  if(!map)return;
  settingsContext={label:'Map settings',ready:()=>true,capture:()=>map.captureHome(),goHome:()=>map.reset(),async save(home){
    const response=await fetch('/api/overview-home',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:overviewHome.version,home})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save the home view.');
    overviewHome=result;map.setHome(result.home);
  }};
  renderSettings();
}
let sessionRequest;
async function refreshSession(){
  if(sessionRequest)return sessionRequest;
  sessionRequest=(async()=>{
    try{const response=await fetch('/api/session',{cache:'no-store'});const session=response.ok?await response.json():null;
      const allowed=!!session?.user&&!!session?.canSetHome;if(allowed!==canSetHome){canSetHome=allowed;renderSettings();}
    }catch{}finally{sessionRequest=null;}
  })();return sessionRequest;
}
window.addEventListener('focus',refreshSession);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSession();});
setInterval(()=>{if(!document.hidden)refreshSession();},30000);

function filtered(){const query=$('#search').value.toLowerCase().trim(),area=$('#area').value,intensity=$('#intensity').value;return entries.filter(e=>e.kind===kind&&(!area||e.area===area)&&(!intensity||e.intensity===intensity)&&`${e.name} ${e.rideFamily?.name||''} ${e.rideFamily?.option||''} ${e.area} ${e.notes||''} ${e.summary||''}`.toLowerCase().includes(query));}
function renderList(){
  const rows=filtered().sort((a,b)=>Number(b.hasTrack)-Number(a.hasTrack)),groups=groupRideEntries(rows);
  $('#result-count').textContent=`${groups.length} ${kind==='ride'?(groups.length===1?'ride':'rides'):(groups.length===1?'adventure':'adventures')}`;
  $('#clear').hidden=!($('#search').value||$('#area').value||$('#intensity').value);
  const meta=e=>`<div class="entry-meta">${e.kind==='ride'?`<span>${escape(e.intensity||'Effort not listed')}</span>${e.climbingFt!=null?`<span>·</span><span>↑ ${number(e.climbingFt)} ft</span>`:''}`:`<span>${escape((e.type||'Explore').replaceAll('-',' + '))}</span>`}${e.hasTrack?'<span class="track-tag">· 3D route</span>':''}</div>`;
  $('#entries').innerHTML=groups.length?groups.map(group=>{
    const e=group.entries[0];
    if(group.familyId)return `<article class="entry-card family-card"><span class="area"><i class="dot"></i>${escape(e.area)}</span><h3>${escape(group.name)}</h3><div class="family-options">${group.entries.map(option=>`<button class="entry-open family-option" data-id="${escape(option.id)}"><span class="family-option-name">${escape(option.rideFamily.option)}<span aria-hidden="true">↗</span></span>${meta(option)}</button>`).join('')}</div></article>`;
    return `<article class="entry-card"><button class="entry-open" data-id="${escape(e.id)}"><span class="area"><i class="dot"></i>${escape(e.area)}</span><h3>${escape(e.name)}</h3>${meta(e)}</button></article>`;
  }).join(''):'<p class="empty">No places match your search. Try another filter.</p>';
  for(const b of document.querySelectorAll('[data-id]')){
    b.onclick=()=>selectEntry(b.dataset.id);
    const hover=b.closest('.family-option')||b.closest('.entry-card');
    hover.onpointerenter=b.onfocus=()=>map?.highlightOverviewRoute(b.dataset.id);
    hover.onpointerleave=b.onblur=()=>map?.highlightOverviewRoute(null);
  }
  map?.setEntries(rows);
}
function familyPicker(entry){
  if(!entry.rideFamily)return '';
  const options=familyOptions(entry,entries);
  return `<div class="ride-family-option"><span class="family-eyebrow">Route option</span>${options.length>1?`<select id="family-option" aria-label="Route option">${options.map(e=>`<option value="${escape(e.id)}" ${e.id===entry.id?'selected':''}>${escape(e.rideFamily.option)}</option>`).join('')}</select>`:`<strong>${escape(entry.rideFamily.option)}</strong>`}</div>`;
}
function wireFamilyPicker(){const select=$('#family-option');if(select)select.onchange=()=>selectEntry(select.value,true,false);}
function clearFilters(){for(const id of ['search','area','intensity'])$('#'+id).value='';renderList();}
async function reset(push=true){
  if(returning)return;
  const token=selection,returnAnimation=returnToOverview;
  returning=!!returnAnimation;
  if(returnAnimation){
    document.body.classList.add('returning-overview');$('#detail').inert=true;
    settingsContext=null;renderSettings();
    try{await returnAnimation();}catch(error){console.error(error);}
    finally{returning=false;document.body.classList.remove('returning-overview');$('#detail').inert=false;}
    if(token!==selection)return;
  }
  selection++;closeRide();track=null;map?.reset(!returnAnimation);
  $('#browse').hidden=false;$('#detail').hidden=true;
  $('#map-kicker').textContent='NORTHERN CALIFORNIA · 3D FIELD GUIDE';$('#map-title').innerHTML='A little further<br>from the ordinary.';
  $('#map-status').textContent='Pick a ride. Watch the landscape open up.';
  if(push)history.pushState({},'','/');renderList();showOverviewSettings();
}

async function selectEntry(id,push=true,animate=true){
  if(id==='mt-elwell'){id='mt-elwell-hard-way';history.replaceState({},'',`/?ride=${id}`);}
  const entry=entries.find(e=>e.id===id);if(!entry){toast('That ride is not published.');return;}
  map?.highlightOverviewRoute(null);
  const transition=!animate?captureRideTransition?.():null;
  if(transition){
    transition.frame.className='ride-transition-frame';$('#canvas').append(transition.frame);
  }
  const token=++selection;closeRide();settingsContext=null;renderSettings();track=null;
  if(transition){document.body.classList.add('ride-open');$('#map-labels').hidden=true;if(map)map.suspended=true;}
  $('#browse').hidden=true;$('#detail').hidden=false;
  if(!transition)$('#detail').innerHTML='<p class="muted">Opening the ride…</p>';
  else if($('#family-option'))$('#family-option').disabled=true;
  if(push)history.pushState({},'',`/?ride=${encodeURIComponent(id)}`);
  if(entry.hasTrack){try{const response=await fetch(`/api/tracks/${id}`);if(!response.ok)throw Error();const loaded=await response.json();if(token!==selection){transition?.frame.remove();return;}track=loaded;}catch{toast('The track could not load. The ride notes are still available.');}}
  if(token!==selection){transition?.frame.remove();return;}
  if(track){
    try{await openRide(entry,track,token,animate,transition);}
    finally{
      if(transition){
        if(token===selection&&!matchMedia('(prefers-reduced-motion: reduce)').matches)
          await transition.frame.animate([{opacity:1},{opacity:0}],{duration:420,easing:'ease-in-out',fill:'forwards'}).finished.catch(()=>{});
        transition.frame.remove();
      }
    }
    return;
  }
  transition?.frame.remove();
  renderDetail(entry);await map?.select(entry,null,animate);
  $('#map-kicker').textContent=entry.area.toUpperCase();$('#map-title').textContent=entry.name;$('#map-status').textContent=track?'A closer look. Drag to explore.': 'Approximate area location · add a GPS track for the full route';
  $('.sidebar').scrollTop=0;
}
async function openRide(entry,rideTrack,token,animate=true,transition=null){
  const controller=new AbortController();let viewer,canvas,controls,context,cardResizeAnimation,panelMoveAnimation;
  closeRide=()=>{
    captureRideTransition=null;
    returnToOverview=null;cardResizeAnimation?.cancel();panelMoveAnimation?.cancel();controller.abort();viewer?.dispose();context?.dispose();canvas?.remove();settingsContext=null;renderSettings();
    controls?.replaceWith(regionalControls);document.body.classList.remove('ride-open');
    if(map){map.suspended=false;map.controls.enabled=true;map.held=null;}
    $('#map-labels').hidden=false;
  };
  function beginCardResize(){
    const card=$('#ride-card'),panel=card.closest('.ride-panel');
    // Capture the displayed frame before cancelling, including rapid reversals.
    const previous=card.getBoundingClientRect();
    cardResizeAnimation?.cancel();panelMoveAnimation?.cancel();
    return ()=>{
      if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      const nextHeight=card.getBoundingClientRect().height;
      const timing={duration:380,easing:'cubic-bezier(.22,1,.36,1)'};
      cardResizeAnimation=card.animate([
        {height:`${previous.height}px`,overflow:'clip',flexShrink:0},
        {height:`${nextHeight}px`,overflow:'clip',flexShrink:0},
      ],timing);
      // Notes use a taller, page-scrolling layout. Ease that position change too.
      const offset=previous.top-card.getBoundingClientRect().top;
      panelMoveAnimation=panel.animate([{translate:`0 ${offset}px`},{translate:'0 0'}],timing);
      for(const section of card.querySelectorAll('.stats,.ride-content,.detail-links'))section.animate([
        {opacity:.45,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'},
      ],{duration:280,easing:timing.easing});
    };
  }
  if(!transition)$('#detail').innerHTML='<button class="back-button" id="back">← All rides</button><p class="muted" role="status">Opening the ride…</p>';
  $('#back').onclick=()=>reset();
  try{
    const base=await prepareRide(entry,rideTrack,controller.signal);
    if(token!==selection)return;
    const hasShuttle=shuttleStartIndex(entry,rideTrack)!==null;
    let changing=false;
    async function showMode(mode,first=false){
      if(changing||controller.signal.aborted)return;
      changing=true;
      const finishResize=first?()=>{}:beginCardResize();
      const initialView=viewer?.captureHome();
      viewer?.dispose();canvas?.remove();context?.dispose();context=null;
      const variant=rideVariant(entry,rideTrack,base,mode),options=variant.options,display=variant.entry;
      if(initialView)options.initialView=initialView;
      else if(first&&transition){
        // Preserve the same geographic camera framing across differently cropped terrain.
        const old=transition.map,next=options.data.map;
        const lon=(old.bbox.west+old.bbox.east-next.bbox.west-next.bbox.east)/2;
        const lat=(old.bbox.south+old.bbox.north-next.bbox.south-next.bbox.north)/2;
        const dx=lon*111320*Math.cos((next.bbox.south+next.bbox.north)*Math.PI/360)/100,dz=-lat*111320/100;
        const shift=v=>[v[0]+dx,v[1],v[2]+dz];
        options.initialView={...transition.view,zoom:transition.view.zoom*(options.scale??1)/transition.scale,position:shift(transition.view.position),target:shift(transition.view.target)};
      }
      options.home=entry.viewer?.home||base.home;
      const separateParking=display.sameStartFinish===false;
      const original=entry.id==='beckwourth-peak'&&mode==='loop';
      const climbing=original?'2,083':number(display.climbingFt??(mode==='loop'&&rideTrack.properties.ascentM!=null?rideTrack.properties.ascentM*3.28084:null));
      $('#detail').innerHTML=`<button class="back-button" id="back">← All rides</button><p class="detail-area">${escape(entry.area)}</p><h2>${escape(entry.rideFamily?.name||entry.name)}</h2>
        ${familyPicker(entry)}
        ${hasShuttle?`<div class="ride-mode" role="group" aria-label="Ride option"><button type="button" data-mode="loop" aria-pressed="${mode==='loop'}">↻ Loop</button><button type="button" data-mode="shuttle" aria-pressed="${mode==='shuttle'}">↗ Shuttle</button></div>`:''}
        ${intensityDisplay(display)}
        <div class="stats"><div><strong id="ride-distance">—</strong><span>Miles</span></div><div><strong>${climbing}</strong><span>Climbing Ft</span></div><div><strong>${movingTime(display)}</strong><span>Moving Time</span></div></div>
        ${ridePanels(entry,`<div class="elevation"><div class="elevation-head"><span>Elevation profile</span><output id="elevation-readout">—</output></div><div id="elevation-chart" class="elevation-chart" role="slider" tabindex="0" aria-label="Elevation profile, ride position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><svg id="elevation-svg" viewBox="0 0 280 96" preserveAspectRatio="none" aria-hidden="true"></svg></div><div class="elevation-axis"><span>0 mi</span><span id="profile-end">—</span></div></div>
        <div class="playback"><button id="play" type="button" disabled>▶ Play Ride</button></div>
        ${surfaceKey(options.surfaceTypes)}`,`${separateParking?'':accessLinks(display)}${external(mode==='shuttle'?(entry.shuttleRouteUrl||entry.routeUrl):entry.routeUrl,'Route on Trailforks')}${external(entry.bkxcVideoUrl,'Watch BKXC’s ride')}`,separateParking?accessLinks(display):'')}`;
      fitRideTitle();wireFamilyPicker();
      $('#back').onclick=()=>reset();
      wireRideNotes(()=>viewer?.pause(),beginCardResize);
      for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>{
        if(button.dataset.mode===mode||changing)return;
        showMode(button.dataset.mode).catch(error=>{console.error(error);toast('Could not switch ride options. Please reopen the ride.');});
      };
      let ready=false;
      settingsContext={
        label:'Ride settings',entryId:entry.id,ready:()=>ready,
        capture:()=>viewer.captureHome(),goHome:()=>viewer.goHome(),
        async save(home){
          const response=await fetch(`/api/ride-home/${entry.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:entry.version,home})});
          const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save the home view.');
          Object.assign(entry,result.entry);
          if(token===selection)viewer.setHome(result.entry.viewer.home);
        }
      };
      renderSettings();
      const nextControls=regionalControls.cloneNode(true);(controls||regionalControls).replaceWith(nextControls);controls=nextControls;
      canvas=document.createElement('canvas');canvas.id='scene';canvas.className='ride-scene';
      canvas.setAttribute('aria-label',`3D terrain map of ${entry.name}. Hover or tap a flag to reveal its place name.`);
      $('#canvas').append(canvas);
      if(map){
        map.suspended=true;map.controls.enabled=false;map.held=null;map.tween=null;
        if(first&&animate){
          options.entryView=map.rideEntryView(options.data.map,options.scale);
          context=map.rideContext(options.data.map);options.entryContext=context;
        }
      }
      const enableRide=()=>{
        if(token!==selection)return;
        ready=true;controls.inert=false;$('#play').disabled=false;
        for(const button of document.querySelectorAll('.ride-settings button'))button.disabled=false;
      };
      controls.inert=true;options.onEntryComplete=enableRide;
      viewer=await mountRideViewer(options);
      if(token!==selection){viewer.dispose();canvas.remove();return;}
      $('.sidebar').scrollTop=0;document.body.classList.add('ride-open');
      $('#map-labels').hidden=true;
      canvas.classList.add('ready');
      captureRideTransition=()=>({view:viewer.captureHome(),frame:viewer.captureFrame(),map:options.data.map,scale:options.scale??1});
      if(map)returnToOverview=()=>{
        controls.inert=true;
        map.reset(false);
        const destination=map.rideEntryView(options.data.map,options.scale);
        return viewer.returnToOverview(destination,map.rideContext(options.data.map));
      };
      if(!options.entryView)enableRide();
      finishResize();
      changing=false;
      if(!first)document.querySelector(`[data-mode="${mode}"]`)?.focus({preventScroll:true});
    }
    await showMode('loop',true);
  }catch(error){
    if(controller.signal.aborted||token!==selection)return;
    closeRide();console.error(error);
    $('#detail').innerHTML='<button class="back-button" id="back">← All rides</button><p>The ride could not load.</p><button class="secondary" id="retry-ride">Try again</button>';
    $('#back').onclick=()=>reset();$('#retry-ride').onclick=()=>selectEntry(entry.id,false,animate);
  }
}
function renderDetail(e){
  const distance='—';
  const stats=e.kind==='ride'?`${intensityDisplay(e)}<div class="stats"><div><b>${distance}</b><span>Miles</span></div><div><b>${number(e.climbingFt)}</b><span>Climbing Ft</span></div><div><b>${movingTime(e)}</b><span>Moving Time</span></div></div>`:'';
  $('#detail').innerHTML=`<button class="back-button" id="back">← All ${kind==='ride'?'rides':'adventures'}</button><p class="detail-area">${escape(e.area)}</p><h1 class="detail-title">${escape(e.rideFamily?.name||e.name)}</h1>${familyPicker(e)}${e.kind==='ride'?'':`<div class="entry-meta">${escape(e.type||'Explore')}</div>`}<div class="detail-actions"><button class="secondary" id="share">Copy link ↗</button></div>${stats}<div class="notice">${e.kind==='ride'?'The route’s GPS track has not been added yet. Explore this area in 3D or open the original route below.':'The map shows the location from the original planner.'}</div>
  ${e.notes||e.summary?`<h3>Field notes</h3><div class="detail-copy ride-description">${descriptionParagraphs(e.notes||e.summary)}</div>`:''}
  <div class="facts">${e.season?`<div class="fact-row"><span>Season</span><b>${escape(e.season)}</b></div>`:''}${e.driveMinutes!=null?`<div class="fact-row"><span>Drive from Everstoke</span><b>~${e.driveMinutes} min</b></div>`:''}${e.shuttleOption&&e.shuttleOption!=='no'?`<div class="fact-row"><span>Shuttle option</span><b>${e.shuttleOption==='partial'?'Partial':'Yes'}</b></div>`:''}${e.ebikeRecommended?'<p class="small muted">The planner recommends an e-bike. Confirm current e-bike access for each trail.</p>':''}</div>
  <div class="detail-links">${e.kind==='ride'?accessLinks(e):''}${external(e.routeUrl,'Open original route')}${external(e.shuttleRouteUrl,'Shuttle route')}${external(e.bkxcVideoUrl,'Watch BKXC’s ride')}</div>${e.incomplete?'<p class="notice">These notes are still being filled in.</p>':''}<p class="track-source">From the Everstoke planner. Locations and seasonal notes need local confirmation; this is not a live trail conditions feed.</p>`;
  $('#back').onclick=()=>reset();
  wireFamilyPicker();
  $('#share').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);toast('Ride link copied. This local link works on this computer.');}catch{toast('Copy this ride’s URL from your address bar.');}};

}
for(const button of document.querySelectorAll('[data-kind]'))button.onclick=()=>{kind=button.dataset.kind;for(const b of document.querySelectorAll('[data-kind]'))b.classList.toggle('active',b===button);$('#intensity').disabled=kind!=='ride';$('#intensity').value='';reset();};
for(const id of ['search','area','intensity'])$('#'+id).addEventListener(id==='search'?'input':'change',renderList);
$('#clear').onclick=clearFilters;
$('#north').onclick=()=>map?.north();
for(const [id,action] of [['rotate-left','left'],['rotate-right','right'],['tilt-up','up'],['tilt-down','down']]){const button=$('#'+id);button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);if(map)map.held=action;};for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>{if(map)map.held=null;});button.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();if(map)map.held=action;}};button.onkeyup=()=>{if(map)map.held=null;};button.onblur=()=>{if(map)map.held=null;};}
window.addEventListener('blur',()=>{if(map)map.held=null;});
window.addEventListener('popstate',()=>{const id=new URLSearchParams(location.search).get('ride');id?selectEntry(id,false):reset(false);});
try{
  const [response,session]=await Promise.all([fetch('/api/catalog'),fetch('/api/session').then(r=>r.ok?r.json():null).catch(()=>null)]);canSetHome=!!session?.user&&!!session?.canSetHome;if(!response.ok)throw Error('The guide database could not be reached.');const catalog=await response.json();entries=catalog.entries;overviewHome=catalog.settings.overviewHome||{version:0};
  for(const area of [...new Set(entries.map(e=>e.area))].sort())$('#area').add(new Option(area,area));for(const value of [...new Set(entries.map(e=>e.intensity).filter(Boolean))])$('#intensity').add(new Option(value,value));
  renderList();
  const initial=new URLSearchParams(location.search).get('ride');
  try{map=new Diorama($('#canvas'),$('#map-labels'),{onArea:area=>{$('#area').value=area;renderList();},onRide:id=>selectEntry(id)});await map.init(filtered(),overviewHome.home);if(!initial)showOverviewSettings();if(!initial)$('#loading').hidden=true;}catch(e){$('#loading').textContent='The 3D map could not load. You can still browse every ride on the left.';map=null;console.error(e);}
  if(initial){
    // Shared links and refreshes open at the saved home view, with no overview
    // flash or crumble. Only an in-page ride selection makes the approach.
    await selectEntry(initial,false,false);
    if(map||document.querySelector('.ride-scene.ready'))$('#loading').hidden=true;
  }
}catch(e){$('#loading').textContent=e.message;$('#entries').innerHTML='<p class="empty">Could not load the guide. Refresh to try again.</p>';console.error(e);}
