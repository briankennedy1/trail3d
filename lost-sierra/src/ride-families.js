// A family groups independent routes; each route retains its own Loop/Shuttle modes.
export function groupRideEntries(entries){
  const groups=new Map();
  for(const entry of entries){
    const family=entry.kind==='ride'?entry.rideFamily:null;
    const key=family?`family:${family.id}`:`entry:${entry.id}`;
    if(!groups.has(key))groups.set(key,{name:family?.name||entry.name,familyId:family?.id||null,entries:[]});
    groups.get(key).entries.push(entry);
  }
  for(const group of groups.values())group.entries.sort((a,b)=>(a.rideFamily?.order??0)-(b.rideFamily?.order??0)||a.name.localeCompare(b.name));
  return [...groups.values()];
}
export function familyOptions(entry,entries){
  if(!entry.rideFamily)return [];
  return groupRideEntries(entries.filter(e=>e.kind==='ride'&&e.rideFamily?.id===entry.rideFamily.id&&e.status==='published'))[0]?.entries||[];
}
