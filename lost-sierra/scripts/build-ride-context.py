"""Cache named roads and waterways for individual ride dioramas (not overview)."""
import datetime
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
b = json.loads((ROOT / 'data/guide-scope.json').read_text())['bbox']
bbox = ','.join(str(b[k]) for k in ('south', 'west', 'north', 'east'))
query = f'''[out:json][timeout:60];(
way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified)$"][name]({bbox});
way[highway=track][name]({bbox});
way[waterway~"^(river|stream)$"][name]({bbox});
);out geom;'''
source = 'https://overpass-api.de/api/interpreter'
request = Request(source, data=urlencode({'data': query}).encode(), headers={'User-Agent': 'RideTheLostSierra/0.1 (map context cache)'})
with urlopen(request, timeout=90) as response:
    raw = json.load(response)
if raw.get('remark'):
    raise RuntimeError(raw['remark'])
features = []
for way in raw['elements']:
    tags = way.get('tags', {})
    coordinates = [[round(p['lon'], 7), round(p['lat'], 7)] for p in way.get('geometry', [])]
    if len(coordinates) < 2:
        continue
    features.append({'type': 'Feature', 'properties': {
        'name': tags['name'], 'kind': 'waterway' if 'waterway' in tags else 'road',
        'class': tags.get('waterway', tags.get('highway')), 'ref': tags.get('ref'), 'osmId': way['id'],
    }, 'geometry': {'type': 'LineString', 'coordinates': coordinates}})
result = {'type': 'FeatureCollection', 'source': 'OpenStreetMap contributors',
          'sourceUrl': 'https://www.openstreetmap.org/copyright',
          'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'bbox': b, 'features': features}
output = ROOT / 'public/terrain/ride-context.geojson'
output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
print(f'Saved {len(features)} named road/waterway sections, {output.stat().st_size:,} bytes')
for kind in ('road', 'waterway'):
    names = sorted({f['properties']['name'] for f in features if f['properties']['kind'] == kind})
    print(kind, len(names), ', '.join(names[:35]))
