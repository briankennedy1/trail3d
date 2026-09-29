"""Cache Caltrans highways 70/89, clipped to the regional diorama."""
import argparse
import datetime
import json
import math
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/SHN_Lines/FeatureServer/0'
bounds = json.loads((ROOT / 'public/terrain/region.json').read_text())['bbox']
w, s, e, n = [bounds[k] for k in ('west', 'south', 'east', 'north')]

def clip(a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    low, high = 0., 1.
    for p, q in ((-dx,a[0]-w),(dx,e-a[0]),(-dy,a[1]-s),(dy,n-a[1])):
        if p == 0:
            if q < 0: return None
        elif p < 0: low = max(low, q/p)
        else: high = min(high, q/p)
        if low > high: return None
    return [[round(a[0]+t*dx,7), round(a[1]+t*dy,7)] for t in (low,high)]

parser = argparse.ArgumentParser()
parser.add_argument('--input', type=Path, help='Use an already downloaded Caltrans GeoJSON response')
args = parser.parse_args()
params = dict(where="Route IN (70,89) AND AlignCode LIKE 'Right%'", geometry=f'{w},{s},{e},{n}', geometryType='esriGeometryEnvelope', inSR=4326, outSR=4326, spatialRel='esriSpatialRelIntersects', outFields='Route,County,AlignCode', returnGeometry='true', f='geojson')
raw = json.loads(args.input.read_text()) if args.input else json.load(urlopen(SOURCE+'/query?'+urlencode(params), timeout=45))
if 'error' in raw or raw.get('exceededTransferLimit'): raise RuntimeError('Caltrans returned an error or incomplete results')
features = []
for feature in raw['features']:
    if not feature['properties']['AlignCode'].startswith('Right'): continue
    geometry = feature['geometry']
    lines = [geometry['coordinates']] if geometry['type']=='LineString' else geometry['coordinates']
    for line in lines:
        runs, run = [], []
        for a,b in zip(line,line[1:]):
            segment = clip(a,b)
            if segment is None:
                if len(run)>1: runs.append(run)
                run=[]
                continue
            if run and run[-1]!=segment[0]:
                if len(run)>1: runs.append(run)
                run=[]
            if not run: run.append(segment[0])
            if run[-1]!=segment[1]: run.append(segment[1])
        if len(run)>1: runs.append(run)
        for run in runs:
            features.append(dict(type='Feature',properties={'route':feature['properties']['Route']},geometry={'type':'LineString','coordinates':run}))
labels=[]
for route in (70,89):
    points=[p for f in features if f['properties']['route']==route for p in f['geometry']['coordinates']]
    assert points, f'No geometry for highway {route}'
    xs,ys=zip(*points)
    for fraction in (.25,.75):
        target=(min(xs)+(max(xs)-min(xs))*(fraction if route==70 else .5), min(ys)+(max(ys)-min(ys))*(fraction if route==89 else .5))
        point=min(points,key=lambda p:((p[0]-target[0])*math.cos(math.radians(39.8)))**2+(p[1]-target[1])**2)
        labels.append({'route':route,'coordinates':point})
result=dict(type='FeatureCollection',source='California Department of Transportation (Caltrans)',sourceUrl=SOURCE,retrievedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),bbox=[w,s,e,n],features=features,labels=labels)
output=ROOT/'public/terrain/highways.geojson'
output.write_text(json.dumps(result,separators=(',',':'))+'\n')
print(f'Saved {len(features)} highway segments, {sum(len(f["geometry"]["coordinates"]) for f in features)} points, {output.stat().st_size} bytes')
