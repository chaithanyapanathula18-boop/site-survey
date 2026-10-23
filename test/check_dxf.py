import sys, ezdxf
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
for path in sys.argv[1:-1]:
    doc = ezdxf.readfile(path)
    auditor = doc.audit()
    msp = doc.modelspace()
    counts = {}
    for e in msp:
        counts[e.dxftype()] = counts.get(e.dxftype(), 0) + 1
    layers = sorted(l.dxf.name for l in doc.layers)
    print(path.split('/')[-1], 'version', doc.dxfversion, 'errors', len(auditor.errors), 'fixes', len(auditor.fixes))
    for err in auditor.errors[:5]: print('  ERR', err.message)
    print('  entities', counts)
    print('  layers', layers)
    poly = [e for e in msp if e.dxftype() == 'POLYLINE'][0]
    pts = [(v.dxf.location.x, v.dxf.location.y) for v in poly.vertices]
    import math
    per = sum(math.dist(pts[i], pts[(i+1)%len(pts)]) for i in range(len(pts)))
    area = abs(sum(pts[i][0]*pts[(i+1)%len(pts)][1]-pts[(i+1)%len(pts)][0]*pts[i][1] for i in range(len(pts))))/2
    print(f'  boundary closed={poly.is_closed} perimeter={per:.3f} area={area:.3f}')
    fig = plt.figure(figsize=(8, 8))
    ax = fig.add_axes([0, 0, 1, 1])
    ctx = RenderContext(doc)
    Frontend(ctx, MatplotlibBackend(ax)).draw_layout(msp, finalize=True)
    out = sys.argv[-1] + '/' + path.split('/')[-1].replace('.dxf', '.png')
    fig.savefig(out, dpi=90)
    print('  rendered', out)
