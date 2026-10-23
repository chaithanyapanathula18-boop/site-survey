import json, sys
from pyproj import Transformer, Geod
data = json.load(open(sys.argv[1]))
worst_e = 0
for p in data['utm']:
    epsg = 32600 + p['zone'] if p['hemi'] == 'N' else 32700 + p['zone']
    t = Transformer.from_crs('EPSG:4326', f'EPSG:{epsg}', always_xy=True)
    e, n = t.transform(p['lng'], p['lat'])
    worst_e = max(worst_e, abs(e - p['E']), abs(n - p['N']))
print(f'UTM: worst difference vs pyproj = {worst_e*1000:.4f} mm over {len(data["utm"])} points')
g = Geod(ellps='WGS84')
worst_a = worst_p = worst_s = worst_b = 0
for poly in data['polys']:
    lons = [q['lng'] for q in poly['pts']]; lats = [q['lat'] for q in poly['pts']]
    area, perim = g.polygon_area_perimeter(lons, lats)
    worst_a = max(worst_a, abs(abs(area) - poly['area']) / abs(area))
    worst_p = max(worst_p, abs(perim - poly['perimeter']) / perim)
    n = len(lons)
    for i in range(n):
        j = (i + 1) % n
        az, _, d = g.inv(lons[i], lats[i], lons[j], lats[j])
        worst_s = max(worst_s, abs(d - poly['sides'][i]))
        diff = abs(((az % 360) - poly['bearings'][i] + 180) % 360 - 180)
        worst_b = max(worst_b, diff)
print(f'Area: worst relative difference vs geodesic = {worst_a*100:.5f} %')
print(f'Perimeter: worst relative difference = {worst_p*100:.5f} %')
print(f'Sides: worst absolute difference = {worst_s*1000:.3f} mm; bearings worst = {worst_b:.5f} deg')
