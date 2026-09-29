#!/usr/bin/env python3
"""Stage a local GPX as a reviewable route and curated manifest draft.

No network, database, or tracked catalog files are changed.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parents[1]


def fail(message):
    raise ValueError(message)


def tag(element):
    return element.tag.rsplit('}', 1)[-1]


def parse_gpx(raw, bounds):
    root = ET.fromstring(raw)
    if tag(root) != 'gpx':
        fail('Input is not GPX.')
    tracks = [node for node in root if tag(node) == 'trk']
    routes = [node for node in root if tag(node) == 'rte']
    if len(tracks) + len(routes) != 1:
        fail('Expected exactly one GPX track or route.')
    if tracks:
        segments = [node for node in tracks[0] if tag(node) == 'trkseg']
        if len(segments) != 1:
            fail('Expected one continuous GPX track segment; inspect gaps before joining.')
        points = [node for node in segments[0] if tag(node) == 'trkpt']
    else:
        points = [node for node in routes[0] if tag(node) == 'rtept']
    if not 2 <= len(points) <= 30000:
        fail('A route needs 2–30,000 points, matching the CMS upload limit.')
    coords = []
    elevations = []
    for point in points:
        lon, lat = float(point.attrib['lon']), float(point.attrib['lat'])
        if not (math.isfinite(lon) and math.isfinite(lat)
                and bounds['west'] <= lon <= bounds['east']
                and bounds['south'] <= lat <= bounds['north']):
            fail('Track has invalid coordinates or extends beyond the Lost Sierra map.')
        ele = next((node for node in point if tag(node) == 'ele'), None)
        elevation = None if ele is None or not (ele.text or '').strip() else float(ele.text)
        if elevation is not None and (not math.isfinite(elevation) or not -500 <= elevation <= 9000):
            fail('Track has invalid elevation.')
        coords.append([lon, lat])
        elevations.append(elevation)
    if all(elevation == 0 for elevation in elevations):
        elevation_mode = 'zero-placeholder-removed'
    elif all(elevation is None for elevation in elevations):
        elevation_mode = 'missing'
    elif all(elevation is not None and elevation != 0 for elevation in elevations):
        elevation_mode = 'recorded'
        coords = [[*point, elevation] for point, elevation in zip(coords, elevations)]
    else:
        fail('Mixed missing, zero and recorded elevations need manual review.')
    meters = 0.0
    for point1, point2 in zip(coords, coords[1:]):
        lon1, lat1 = point1[:2]
        lon2, lat2 = point2[:2]
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dlat, dlon = p2-p1, math.radians(lon2-lon1)
        a = math.sin(dlat/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2
        step = 12742000*math.asin(min(1, math.sqrt(a)))
        if step > 5000:
            fail('Track has a gap longer than 5 km. Split or repair it first.')
        meters += step
    return coords, elevation_mode, meters


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=pathlib.Path, help='Local GPX export')
    parser.add_argument('--id', required=True, help='New URL slug')
    parser.add_argument('--name', required=True)
    parser.add_argument('--area', required=True)
    parser.add_argument('--source-url', required=True)
    parser.add_argument('--source-label', required=True)
    parser.add_argument('--family-id', help='Existing ride family ID, if confirmed')
    parser.add_argument('--family-name', help='Existing ride family name, if confirmed')
    parser.add_argument('--family-option', help='This ride option label, if confirmed')
    parser.add_argument('--family-order', type=int, help='Display order within family; defaults after existing options')
    parser.add_argument('--climbing-ft', type=int)
    parser.add_argument('--descending-ft', type=int)
    parser.add_argument('--moving-minutes', type=int)
    parser.add_argument('--moving-time-estimated', action='store_true')
    parser.add_argument('--output-dir', type=pathlib.Path, help='Default: lost-sierra/.staging/<id>')
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.id):
        fail('ID must be a lowercase hyphenated slug.')
    if not all(value.strip() for value in (args.name, args.area, args.source_label)):
        fail('Name, area, and source label must be nonblank.')
    if any(value is not None and value < 0 for value in (args.climbing_ft, args.descending_ft, args.moving_minutes)):
        fail('Source totals must be nonnegative.')
    family = (args.family_id, args.family_name, args.family_option)
    if any(family) and not all(family):
        fail('Supply family ID, name, and option together.')
    if args.family_order is not None and (not all(family) or args.family_order < 0):
        fail('Family order requires a complete family and must be nonnegative.')
    if args.moving_time_estimated and args.moving_minutes is None:
        fail('Estimated moving time requires moving minutes.')
    url = urlparse(args.source_url)
    if url.scheme != 'https' or not url.netloc:
        fail('Source URL must be HTTPS.')
    manifest = json.loads((ROOT/'data/curated-rides.json').read_text())
    planner_ids = {entry['id'] for kind in ('rides', 'adventures')
                   for entry in json.loads((ROOT/'data'/f'planner-{kind}.json').read_text())}
    if any(ride['id'] == args.id for ride in manifest) or args.id in planner_ids or (ROOT/'data/routes'/f'{args.id}.geojson').exists():
        fail('Ride ID already exists in the catalog.')
    raw = args.input.read_bytes()
    bounds = json.loads((ROOT/'data/guide-scope.json').read_text())['bbox']
    coords, elevation_mode, meters = parse_gpx(raw, bounds)
    stats = {'distanceMiles': round(meters/1609.344, 2), 'pointCount': len(coords)}
    for name, value in [('climbingFt', args.climbing_ft), ('descendingFt', args.descending_ft), ('movingMinutes', args.moving_minutes)]:
        if value is not None:
            stats[name] = value
    if args.moving_minutes is not None:
        stats['movingTimeEstimated'] = args.moving_time_estimated
    feature = {'type':'Feature', 'properties': {
        'name': args.name, 'sourceLabel': args.source_label, 'sourceUrl': args.source_url,
        'gpxSha256': hashlib.sha256(raw).hexdigest(),
        'importedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'elevationSource': 'GPX recording' if elevation_mode == 'recorded' else 'Pending AWS terrain sampling',
        'sourceStats': stats,
    }, 'geometry': {'type':'LineString', 'coordinates':coords}}
    first = coords[0]
    details = {'coordinates': {'lat':first[1], 'lng':first[0]}, 'routeUrl':args.source_url,
               'incomplete':True, 'summary':'', 'notes':'', 'viewer':{'pointsOfInterest':[]}}
    for name, value in [('climbingFt', args.climbing_ft), ('descendingFt', args.descending_ft), ('movingMinutes', args.moving_minutes)]:
        if value is not None:
            details[name] = value
    if args.moving_minutes is not None:
        details['movingTimeEstimated'] = args.moving_time_estimated
    if all(family):
        existing_orders = [ride.get('details', {}).get('rideFamily', {}).get('order', -1)
                           for ride in manifest if ride.get('details', {}).get('rideFamily', {}).get('id') == args.family_id]
        order = args.family_order if args.family_order is not None else max(existing_orders, default=-1) + 1
        details['rideFamily'] = {'id':args.family_id, 'name':args.family_name, 'option':args.family_option, 'order':order}
    entry = {'id':args.id, 'entry':{'name':args.name, 'kind':'ride', 'area':args.area, 'status':'draft'},
             'terrain':f'/terrain/{args.id}', 'track':f'routes/{args.id}.geojson', 'details':details}
    review = {'id':args.id, 'source':args.source_url, 'gpxSha256':feature['properties']['gpxSha256'],
              'stats':stats, 'elevation':elevation_mode,
              'pending':['Verify source processed totals, editorial summary and field notes, intensity, start/finish parking, route shape, surface classification, terrain and home view.'],
              'next':[f'Review this directory, then copy {args.id}.geojson to data/routes/ and append curated-entry.json to data/curated-rides.json.',
                      f'Run node scripts/build-ride-terrain.mjs {args.id} to sample missing elevation and build terrain.',
                      f'Run node scripts/build-route-surfaces.mjs /path/to/ways.json --ride {args.id} with a relevant cached Overpass export.',
                      'Run npm run audit:content before publishing.']}
    output = args.output_dir or ROOT/'.staging'/args.id
    output.mkdir(parents=True, exist_ok=False)
    for name, value in [(f'{args.id}.geojson', feature), ('curated-entry.json', entry), ('review.json', review)]:
        (output/name).write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n')
    print(json.dumps({'staged':str(output), **review}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, ET.ParseError, OSError, KeyError) as error:
        print(f'Import stopped: {error}', file=sys.stderr)
        sys.exit(1)
