const isGoogleMaps=url=>{
  try{
    const {protocol,hostname,pathname}=new URL(url);
    return protocol==='https:'&&(hostname==='maps.app.goo.gl'||hostname==='maps.google.com'||
      ((hostname==='www.google.com'||hostname==='google.com'||hostname==='goo.gl')&&pathname.startsWith('/maps')));
  }catch{return false;}
};

// Resolve at display time so editing the parking field also updates the flag.
export function routeStartParkingLinks(points=[],parkingUrl){
  return points.map(point=>{
    if(!/^(?:route start(?:\s*\/\s*finish)?|.*\btrailhead)$/i.test(point.name.trim()))return point;
    const url=isGoogleMaps(parkingUrl)?parkingUrl:isGoogleMaps(point.url)?point.url:
      `https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`;
    return {...point,url};
  });
}
