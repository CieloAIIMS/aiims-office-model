"""Build the AiiMS office model: architecture from the review package + an illustrative fit-out layer.
Outputs: model_data.json (compact, for the web viewer), AIIMS_office_model.glb, fitout.json (for plan overlay)."""
import json, math, struct
import numpy as np

import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
SRC = 'data/geometry.json'
g = json.load(open(SRC))
UFZ = 4.45

# ---------------------------------------------------------------- fit-out primitives
FIT = []   # each: dict(name, floor, zone, material, vertices, faces)
RECTS = [] # footprints for collision checks
PRIMS = [] # primitive list for the web viewer

def box(name, floor, zone, mat, x0, y0, z0, x1, y1, z1, check=True):
    zb = UFZ if floor == 'UF' else 0.0
    z0 += zb; z1 += zb
    v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]
    f = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
    FIT.append(dict(name=name, floor=floor, zone=zone, material=mat, vertices=v, faces=f))
    PRIMS.append(dict(zn=zone,t='b',m=mat,f=floor,a=[x0,y0,z0],b=[x1,y1,z1]))
    if check: RECTS.append(dict(name=name, floor=floor, rect=[x0,y0,x1,y1], z=[z0,z1]))

def cyl(name, floor, zone, mat, cx, cy, r, z0, z1, n=16, r1=None, check=True):
    zb = UFZ if floor == 'UF' else 0.0
    r1 = r if r1 is None else r1
    v = []
    for i in range(n):
        a = 2*math.pi*i/n; v.append([cx+r*math.cos(a), cy+r*math.sin(a), z0+zb])
    for i in range(n):
        a = 2*math.pi*i/n; v.append([cx+r1*math.cos(a), cy+r1*math.sin(a), z1+zb])
    f = [list(range(n-1,-1,-1)), list(range(n,2*n))]
    for i in range(n):
        j=(i+1)%n; f.append([i,j,n+j,n+i])
    FIT.append(dict(name=name, floor=floor, zone=zone, material=mat, vertices=v, faces=f))
    PRIMS.append(dict(zn=zone,t='c',m=mat,f=floor,c=[cx,cy],r=r,r1=r1,z=[z0+zb,z1+zb],n=n))
    if check: RECTS.append(dict(name=name, floor=floor, rect=[cx-max(r,r1),cy-max(r,r1),cx+max(r,r1),cy+max(r,r1)], z=[z0+zb,z1+zb]))

def blob(name, floor, zone, mat, cx, cy, cz, r):
    """low-poly foliage: octahedron-ish squashed icosphere"""
    zb = UFZ if floor == 'UF' else 0.0
    t=(1+5**.5)/2
    V=[(-1,t,0),(1,t,0),(-1,-t,0),(1,-t,0),(0,-1,t),(0,1,t),(0,-1,-t),(0,1,-t),(t,0,-1),(t,0,1),(-t,0,-1),(-t,0,1)]
    F=[(0,11,5),(0,5,1),(0,1,7),(0,7,10),(0,10,11),(1,5,9),(5,11,4),(11,10,2),(10,7,6),(7,1,8),(3,9,4),(3,4,2),(3,2,6),(3,6,8),(3,8,9),(4,9,5),(2,4,11),(6,2,10),(8,6,7),(9,8,1)]
    s=r/math.sqrt(1+t*t)
    # icosahedron above is with y as 'up' axis in tuple slot 1; map (x,y,z)->(x,z,y)
    v=[[cx+a*s, cy+c*s, cz+zb+b*s*1.1] for a,b,c in V]
    f=[[a,c,b] for a,b,c in F]
    FIT.append(dict(name=name, floor=floor, zone=zone, material=mat, vertices=v, faces=f))
    PRIMS.append(dict(zn=zone,t='l',m=mat,f=floor,c=[cx,cy,cz+zb],r=r))

# ---------------------------------------------------------------- furniture kits
def desk(name, fl, zone, x0, y0, w, d, facing):
    """facing: +1 user sits on the -y side facing +y ... simplified: we pass chair side separately"""
    box(name+'_top', fl, zone, 'desk_top', x0, y0, 0.70, x0+w, y0+d, 0.73)
    # two leg panels
    box(name+'_legL', fl, zone, 'desk_frame', x0+0.03, y0+0.05, 0.0, x0+0.07, y0+d-0.05, 0.70, check=False)
    box(name+'_legR', fl, zone, 'desk_frame', x0+w-0.07, y0+0.05, 0.0, x0+w-0.03, y0+d-0.05, 0.70, check=False)

def chair(name, fl, zone, cx, cy, back_dir):
    """back_dir: 'N','S','E','W' side where the backrest is"""
    s=0.23
    cyl(name+'_base', fl, zone, 'desk_frame', cx, cy, 0.28, 0.0, 0.04, n=5, check=False)
    cyl(name+'_post', fl, zone, 'desk_frame', cx, cy, 0.025, 0.04, 0.42, n=8, check=False)
    box(name+'_seat', fl, zone, 'chair', cx-s, cy-s, 0.42, cx+s, cy+s, 0.49)
    b=0.05
    if back_dir=='N': box(name+'_back', fl, zone, 'chair', cx-s, cy+s-b, 0.52, cx+s, cy+s, 0.98, check=False)
    if back_dir=='S': box(name+'_back', fl, zone, 'chair', cx-s, cy-s, 0.52, cx+s, cy-s+b, 0.98, check=False)
    if back_dir=='E': box(name+'_back', fl, zone, 'chair', cx+s-b, cy-s, 0.52, cx+s, cy+s, 0.98, check=False)
    if back_dir=='W': box(name+'_back', fl, zone, 'chair', cx-s, cy-s, 0.52, cx-s+b, cy+s, 0.98, check=False)

def monitor(name, fl, zone, cx, cy, face):
    # face 'N' means screen faces north (user south of it)
    if face in 'NS':
        box(name, fl, zone, 'screen', cx-0.28, cy-0.015, 0.90, cx+0.28, cy+0.015, 1.22, check=False)
    else:
        box(name, fl, zone, 'screen', cx-0.015, cy-0.28, 0.90, cx+0.015, cy+0.28, 1.22, check=False)
    box(name+'_stand', fl, zone, 'desk_frame', cx-0.02, cy-0.02, 0.73, cx+0.02, cy+0.02, 0.90, check=False)

def bench_cluster(prefix, fl, zone, cx, cy, n_per_side, dw=1.4, dd=0.7):
    """back-to-back bench, desks along X, users on north + south."""
    W = n_per_side*dw
    x0 = cx - W/2
    for side, (yy, back, cyy, mface) in enumerate([
            (cy-dd, 'S', cy-dd-0.45, 'N'),
            (cy,    'N', cy+dd+0.45, 'S')]):
        for i in range(n_per_side):
            nm=f'{prefix}_{side}{i}'
            desk(nm, fl, zone, x0+i*dw+0.01, yy, dw-0.02, dd, None)
            mx=x0+i*dw+dw/2
            monitor(nm+'_mon', fl, zone, mx, cy-0.12 if side==0 else cy+0.12, mface)
            chair(nm+'_chair', fl, zone, mx, cyy, back)
    # central screen divider
    box(prefix+'_divider', fl, zone, 'fabric', x0, cy-0.015, 0.73, x0+W, cy+0.015, 1.15, check=False)

def table(name, fl, zone, x0, y0, x1, y1, h=0.74, mat='table_top'):
    box(name+'_top', fl, zone, mat, x0, y0, h-0.04, x1, y1, h)
    inset=0.08
    for i,(lx,ly) in enumerate([(x0+inset,y0+inset),(x1-inset,y0+inset),(x1-inset,y1-inset),(x0+inset,y1-inset)]):
        box(f'{name}_leg{i}', fl, zone, 'desk_frame', lx-0.025, ly-0.025, 0, lx+0.025, ly+0.025, h-0.04, check=False)

def meeting(prefix, fl, zone, x0, y0, x1, y1, along='X'):
    table(prefix+'_table', fl, zone, x0, y0, x1, y1)
    if along=='X':
        n=max(2,int((x1-x0)/0.75))
        for i in range(n):
            x=x0+(i+0.5)*(x1-x0)/n
            chair(f'{prefix}_cS{i}', fl, zone, x, y0-0.35, 'S')
            chair(f'{prefix}_cN{i}', fl, zone, x, y1+0.35, 'N')
    else:
        n=max(2,int((y1-y0)/0.75))
        for i in range(n):
            y=y0+(i+0.5)*(y1-y0)/n
            chair(f'{prefix}_cW{i}', fl, zone, x0-0.35, y, 'W')
            chair(f'{prefix}_cE{i}', fl, zone, x1+0.35, y, 'E')

def sofa(name, fl, zone, x0, y0, x1, y1, back):
    box(name+'_base', fl, zone, 'sofa', x0, y0, 0.0, x1, y1, 0.42)
    t=0.2
    if back=='W': box(name+'_back', fl, zone, 'sofa', x0, y0, 0.42, x0+t, y1, 0.80, check=False)
    if back=='E': box(name+'_back', fl, zone, 'sofa', x1-t, y0, 0.42, x1, y1, 0.80, check=False)
    if back=='S': box(name+'_back', fl, zone, 'sofa', x0, y0, 0.42, x1, y0+t, 0.80, check=False)
    if back=='N': box(name+'_back', fl, zone, 'sofa', x0, y1-t, 0.42, x1, y1, 0.80, check=False)
    box(name+'_cush', fl, zone, 'sofa_cushion', x0+(t if back=='W' else 0.02), y0+(t if back=='S' else 0.02), 0.42,
        x1-(t if back=='E' else 0.02), y1-(t if back=='N' else 0.02), 0.50, check=False)

def plant(name, fl, zone, cx, cy, h=1.3):
    cyl(name+'_pot', fl, zone, 'planter', cx, cy, 0.2, 0.0, 0.42, n=12, r1=0.22)
    blob(name+'_leaf', fl, zone, 'foliage', cx, cy, 0.42+h*0.45, h*0.36)
    blob(name+'_leaf2', fl, zone, 'foliage', cx+0.08, cy-0.05, 0.42+h*0.75, h*0.24)

def shelving(name, fl, zone, x0, y0, x1, y1, h, levels, mat='shelf', upright='desk_frame'):
    for k in range(levels):
        z=0.1+k*(h-0.1)/(levels-1)
        box(f'{name}_s{k}', fl, zone, mat, x0, y0, z, x1, y1, z+0.03, check=(k==0))
    L = (x1-x0) if (x1-x0)>(y1-y0) else (y1-y0)
    n = max(2, int(L/1.2)+1)
    for i in range(n):
        tt=i/(n-1)
        if (x1-x0)>(y1-y0):
            x=x0+tt*(x1-x0-0.06)
            box(f'{name}_u{i}', fl, zone, upright, x, y0, 0, x+0.06, y1, h+0.03, check=False)
        else:
            y=y0+tt*(y1-y0-0.06)
            box(f'{name}_u{i}', fl, zone, upright, x0, y, 0, x1, y+0.06, h+0.03, check=False)

def cabinet(name, fl, zone, x0,y0,x1,y1,h=0.75):
    box(name, fl, zone, 'joinery_fit', x0,y0,0,x1,y1,h)

# ---------------------------------------------------------------- GROUND FLOOR fit-out
Z='Open workspace'
bench_cluster('GF_BENCH_A','GF',Z, 3.2, 3.9, 2)
bench_cluster('GF_BENCH_B','GF',Z, 7.2, 3.9, 2)
plant('GF_PLANT_01','GF',Z, 9.2, 6.5)
plant('GF_PLANT_02','GF',Z, 0.75, 6.6)

Z='Reception / foyer'

Z='Meeting room (GF west room)'
meeting('GF_MEET_W','GF',Z, 1.0, 9.1, 3.8, 10.2, 'X')
box('GF_MEET_W_SCREEN','GF',Z,'screen', 0.36, 8.9, 1.0, 0.40, 10.4, 1.9, check=False)
box('GF_MEET_W_CRED','GF',Z,'joinery_fit', 0.36, 8.7, 0.0, 0.8, 10.6, 0.75)

Z='Breakout (GF L-shaped area)'
sofa('GF_BREAK_SOFA','GF',Z, 0.4, 13.2, 1.25, 15.2, 'W')
table('GF_BREAK_CT','GF',Z, 1.5, 13.8, 2.1, 14.6, h=0.40)
table('GF_BREAK_HIGH','GF',Z, 0.9, 16.6, 2.3, 18.4, h=1.0)
for i,y in enumerate([16.9, 17.5, 18.1]):
    cyl(f'GF_BREAK_STOOL_W{i}','GF',Z,'chair',0.62,y,0.17,0.0,0.72,n=12)
    cyl(f'GF_BREAK_STOOL_E{i}','GF',Z,'chair',2.58,y,0.17,0.0,0.72,n=12)
plant('GF_PLANT_06','GF',Z, 0.75, 18.7)

Z='Private office (GF 3.3 x 3.4)'
desk('GF_OFF_E_desk','GF',Z, 12.3, 14.4, 1.6, 0.7, None)
monitor('GF_OFF_E_mon','GF',Z, 13.1, 14.9, 'S')
chair('GF_OFF_E_chair','GF',Z, 13.1, 13.9, 'S')
shelving('GF_OFF_E_shelf','GF',Z, 14.45, 12.4, 14.85, 13.9, 1.8, 5)
plant('GF_PLANT_07','GF',Z, 11.85, 12.5, 1.0)

Z='Warehouse'
for k,(x0,x1) in enumerate([(10.0,12.7),(13.5,16.2)]):
    shelving(f'GF_RACK_S{k}','GF',Z, x0, 15.65, x1, 16.65, 2.6, 4, mat='rack_deck', upright='rack')
for k,(x,y) in enumerate([(10.4,18.2),(11.8,18.2),(10.4,19.5),(13.8,18.4)]):
    box(f'GF_PALLET_{k}','GF',Z,'pallet', x, y, 0.0, x+1.2, y+1.0, 0.15)
    box(f'GF_PALLET_{k}_load','GF',Z,'carton', x+0.05, y+0.05, 0.15, x+1.15, y+0.95, 0.15+0.5+0.3*(k%2), check=False)

Z='Storage'
shelving('GF_STORE_N1','GF',Z, 4.2, 24.95, 9.2, 25.5, 2.4, 5, mat='rack_deck', upright='rack')
shelving('GF_STORE_N2','GF',Z, 10.2, 24.95, 16.3, 25.5, 2.4, 5, mat='rack_deck', upright='rack')

# ---------------------------------------------------------------- UPPER FLOOR fit-out
Z='Open workspace (UF front)'
bench_cluster('UF_BENCH_A','UF',Z, 4.1, 2.8, 3)
bench_cluster('UF_BENCH_B','UF',Z, 9.6, 3.9, 3)
bench_cluster('UF_BENCH_C','UF',Z, 7.3, 7.4, 3)
plant('UF_PLANT_01','UF',Z, 0.75, 5.6)
plant('UF_PLANT_02','UF',Z, 12.3, 5.9)
plant('UF_PLANT_03','UF',Z, 16.05, 2.05)
cabinet('UF_STORAGE_WALL','UF',Z, 12.6, 1.95, 15.5, 2.4, 1.1)

Z='Private offices (UF west)'
for k,yb in enumerate([11.1, 14.1]):
    desk(f'UF_OFF_W{k}_desk','UF',Z, 0.45, yb+0.9, 0.7, 1.6, None)
    monitor(f'UF_OFF_W{k}_mon','UF',Z, 0.6, yb+1.7, 'E')
    chair(f'UF_OFF_W{k}_chair','UF',Z, 1.6, yb+1.7, 'E')
    chair(f'UF_OFF_W{k}_guest','UF',Z, 2.9, yb+1.2, 'W') if False else None
    shelving(f'UF_OFF_W{k}_shelf','UF',Z, 0.45, yb+2.45, 2.2, yb+2.8, 1.8, 5)
    plant(f'UF_OFF_W{k}_plant','UF',Z, 3.2, yb+0.55, 1.0)

Z='Boardroom (UF north-west)'
meeting('UF_BOARD','UF',Z, 1.3, 18.7, 2.5, 22.3, 'Y')
box('UF_BOARD_SCREEN','UF',Z,'screen', 1.2, 17.2, 1.0, 2.6, 17.24, 1.85, check=False)
meeting('UF_HUDDLE','UF',Z, 4.1, 21.0, 5.5, 22.0, 'X')

Z='Kitchen / dining'
for k,y in enumerate([14.0, 16.8]):
    meeting(f'UF_DINE_{k}','UF',Z, 13.0, y, 15.4, y+0.9, 'X')
plant('UF_PLANT_04','UF',Z, 16.1, 12.55)
plant('UF_PLANT_05','UF',Z, 10.0, 19.6)

Z='Lounge (UF 3.9 x 4.4)'
sofa('UF_LOUNGE_SOFA','UF',Z, 15.55, 22.2, 16.4, 25.0, 'E')
sofa('UF_LOUNGE_SOFA2','UF',Z, 13.2, 25.0, 15.3, 25.75, 'N')
table('UF_LOUNGE_CT','UF',Z, 14.0, 23.0, 15.0, 24.2, h=0.40)
plant('UF_PLANT_06','UF',Z, 12.95, 22.0)

Z='Courtyard deck'
for k,(x0,y0,x1,y1) in enumerate([(5.75,10.4,9.05,10.9),(5.75,16.3,9.05,16.8)]):
    box(f'UF_COURT_PLANTER_{k}','UF',Z,'planter', x0,y0,0.03,x1,y1,0.55)
    for j in range(4):
        blob(f'UF_COURT_SHRUB_{k}{j}','UF',Z,'foliage', x0+0.45+j*0.8, (y0+y1)/2, 0.03+0.75, 0.38)
box('UF_COURT_BENCH_W','UF',Z,'timber', 5.8, 12.3, 0.03, 6.25, 14.9, 0.45)
box('UF_COURT_BENCH_E','UF',Z,'timber', 8.55, 12.3, 0.03, 9.0, 14.9, 0.45)
cyl('UF_COURT_TABLE','UF',Z,'timber', 7.4, 13.6, 0.45, 0.03, 0.72, n=20)
plant('UF_COURT_TREE','UF',Z, 7.4, 15.6, 2.0)

# ---------------------------------------------------------------- collision check vs architecture
def aabb(m):
    vs=np.array(m['vertices']); return vs.min(0), vs.max(0)
ARCH=[]
for m in g['meshes']:
    if not m['visible'] and 'Stairs' not in m['category']: continue
    if m['category'] in ('Floors','External Ground - cropped extent','Ceilings','Roof','Photo Facade Details - PROVISIONAL'): continue
    lo,hi=aabb(m); ARCH.append((m['name'],m['floor'],lo,hi,m['category']))
problems=[]
for r in RECTS:
    x0,y0,x1,y1=r['rect']; z0,z1=r['z']
    for name,fl,lo,hi,cat in ARCH:
        if cat=='Doors' and name.endswith('_Leaf'):
            pass
        ox=min(x1,hi[0])-max(x0,lo[0]); oy=min(y1,hi[1])-max(y0,lo[1]); oz=min(z1,hi[2])-max(z0,lo[2])
        if ox>0.005 and oy>0.005 and oz>0.005:
            problems.append((r['name'],name,round(ox,2),round(oy,2)))
# fit-out vs fit-out
for i,a in enumerate(RECTS):
    for b in RECTS[i+1:]:
        if a['floor']!=b['floor']: continue
        ox=min(a['rect'][2],b['rect'][2])-max(a['rect'][0],b['rect'][0]); oy=min(a['rect'][3],b['rect'][3])-max(a['rect'][1],b['rect'][1])
        oz=min(a['z'][1],b['z'][1])-max(a['z'][0],b['z'][0])
        if ox>0.005 and oy>0.005 and oz>0.005 and a['name'].split('_')[:3]!=b['name'].split('_')[:3]:
            problems.append((a['name'],b['name'],round(ox,2),round(oy,2)))
print('fitout objects', len(FIT), 'collisions', len(problems))
for p in problems: print('  ',p)
json.dump([dict(floor=r['floor'],rect=r['rect']) for r in RECTS], open('data/fitout.json','w'))

# ---------------------------------------------------------------- triangulation
def tri_face(pts, idx):
    if len(idx)==3: return [idx]
    if len(idx)==4: return [[idx[0],idx[1],idx[2]],[idx[0],idx[2],idx[3]]]
    P=np.array([pts[i] for i in idx],float)
    n=np.zeros(3)
    for i in range(len(P)): n+=np.cross(P[i],P[(i+1)%len(P)])
    ax=int(np.argmax(np.abs(n))); keep=[k for k in range(3) if k!=ax]
    Q=P[:,keep]; sign=1 if n[ax]>0 else -1
    if ax==1: sign=-sign
    poly=list(range(len(idx))); out=[]
    def area2(a,b,c): return ((Q[b][0]-Q[a][0])*(Q[c][1]-Q[a][1])-(Q[b][1]-Q[a][1])*(Q[c][0]-Q[a][0]))*sign
    guard=0
    while len(poly)>3 and guard<10000:
        guard+=1; ok=False
        for i in range(len(poly)):
            a,b,c=poly[i-1],poly[i],poly[(i+1)%len(poly)]
            if area2(a,b,c)<=1e-12: continue
            inside=False
            for p in poly:
                if p in (a,b,c): continue
                if area2(a,b,p)>=0 and area2(b,c,p)>=0 and area2(c,a,p)>=0: inside=True;break
            if inside: continue
            out.append([idx[a],idx[b],idx[c]]); poly.pop(i); ok=True; break
        if not ok: break
    if len(poly)>=3:
        for i in range(1,len(poly)-1): out.append([idx[poly[0]],idx[poly[i]],idx[poly[i+1]]])
    return out

# ---------------------------------------------------------------- grouping
def layer_of(m, fit=False):
    if fit: return 'fitout'
    c=m['category']
    if c=='Ceilings': return 'ceiling'
    if c=='Roof': return 'roof'
    if 'Stairs' in c: return 'stair'
    if 'Photo Facade' in c: return 'facade'
    if c in ('Windows','Internal Glazing') or m['material'] in ('glass','glass_door'): return 'glazing'
    return 'arch'

groups={}
def add(m, fit=False):
    key=(m['floor'], layer_of(m,fit), m['material'])
    G=groups.setdefault(key, {'v':[], 'i':[]})
    base=len(G['v'])
    G['v'].extend(m['vertices'])
    for f in m['faces']:
        for t in tri_face(m['vertices'], f):
            G['i'].extend([base+t[0],base+t[1],base+t[2]])
for m in g['meshes']:
    if 'ENTRY_CURVE' in m['name']: continue  # replaced by the photo-referenced foyer counters
    if 'STORAGE_DIVIDER' in m['name'] and 'SLIDING' in m['name']: continue
    if m['name']=='GF_INT_04_WAREHOUSE_SOUTH_O1_Leaf': continue
    if m['name'].startswith('UF_COURTYARD_SOUTH_Fold0_Fold') or m['name'] in ('UF_GLASS_CROSS_WEST_Door1_Leaf','UF_GLASS_CROSS_EAST_Door1_Leaf'): continue  # glazing closed in the viewer
    if m['name']=='GF_INT_04_WAREHOUSE_SOUTH': continue  # rebuilt in the viewer with the podcast window cut in  # replaced by the open glazed door in the viewer
    if m['floor']=='UF' and m['category']=='Fixed Joinery' and m['name'].startswith(('UF_KITCHEN','UF_P_','UF_PANTRY')): continue  # kitchen rebuilt from photos in the viewer  # replaced by roller shutter / studio glazing
    if m['name'].startswith('UF_COURTYARD') and m['material']=='frame': m=dict(m, material='frame_white')
    if m['name'] in ('GF_EXT_EAST_O4_Leaf','GF_EXT_EAST_O6_Leaf','GF_INT_17_UNDERSTAIR_SOUTH_O1_Leaf'): continue  # shown closed in the lounge
    add(m)

def r3(a): return [round(float(x),3) for x in a]
wins=[]
for w in g['walls']:
    if 'EXT' not in w['name']: continue
    for o in w['openings']:
        if o['kind']!='W': continue
        wins.append(dict(f=w['floor'],a=r3(o['start_world'][:2]),b=r3(o['end_world'][:2]),sill=o['sill'],head=o['head'],t=round(w['thickness'],3)))
REPLACED={'Warehouse','Storage','Kitchen / dining','Courtyard deck','Lounge (UF 3.9 x 4.4)','Private office (GF 3.3 x 3.4)','Open workspace (UF front)'}  # rebuilt from site photos in the viewer
P=[]
for p in PRIMS:
    if p['zn'] in REPLACED: continue
    q=dict(p); q.pop('zn')
    for k in ('a','b','c','z'):
        if k in q: q[k]=r3(q[k])
    for k in ('r','r1'):
        if k in q: q[k]=round(q[k],3)
    P.append(q)
out={'groups':[], 'labels':g['labels'], 'routes':g['routes'], 'prims':P, 'windows':wins}
tris=0
for (fl,layer,mat),G in sorted(groups.items()):
    # to Y-up for three.js: (x, z, -y)
    v=np.array(G['v'])
    vy=np.stack([v[:,0], v[:,2], -v[:,1]],1)
    out['groups'].append({'floor':fl,'layer':layer,'mat':mat,
        'v':[round(float(a),3) for a in vy.flatten()], 'i':G['i']})
    tris+=len(G['i'])//3
json.dump(out, open('data/model_data.json','w'), separators=(',',':'))
print('groups',len(out['groups']),'tris',tris)

# ---------------------------------------------------------------- GLB export
COLORS={
 'external':(0.72,0.72,0.70,1),'charcoal':(0.10,0.105,0.11,1),'internal':(0.93,0.92,0.89,1),
 'slab':(0.70,0.69,0.66,1),'courtyard':(0.55,0.47,0.36,1),'frame':(0.08,0.08,0.09,1),
 'glass':(0.62,0.74,0.78,0.28),'glass_door':(0.62,0.74,0.78,0.30),'door':(0.55,0.44,0.33,1),
 'structure':(0.80,0.79,0.76,1),'joinery':(0.86,0.84,0.80,1),'countertop':(0.95,0.95,0.93,1),
 'metal':(0.45,0.46,0.47,1),'sanitary':(0.97,0.97,0.97,1),'ceiling':(0.96,0.96,0.95,1),
 'roof':(0.35,0.36,0.37,1),'stair':(0.22,0.22,0.23,1),
 'desk_top':(0.82,0.70,0.54,1),'desk_frame':(0.12,0.12,0.13,1),'chair':(0.20,0.22,0.21,1),
 'screen':(0.05,0.05,0.06,1),'fabric':(0.20,0.33,0.27,1),'table_top':(0.78,0.66,0.50,1),
 'sofa':(0.23,0.36,0.30,1),'sofa_cushion':(0.30,0.44,0.37,1),'planter':(0.16,0.16,0.17,1),
 'foliage':(0.25,0.45,0.25,1),'shelf':(0.82,0.70,0.54,1),'joinery_fit':(0.90,0.89,0.86,1),
 'rack':(0.15,0.30,0.55,1),'rack_deck':(0.85,0.52,0.15,1),'pallet':(0.70,0.57,0.40,1),
 'carton':(0.72,0.58,0.40,1),'timber':(0.62,0.47,0.32,1),
}
json.dump(COLORS, open('data/colors.json','w'))

def glb(path, include_hidden=False):
    nodes=[];meshes=[];materials=[];accessors=[];views=[];blob=bytearray()
    matidx={}
    def pad():
        while len(blob)%4: blob.append(0)
    for (fl,layer,mat),G in sorted(groups.items()):
        if layer in ('ceiling','roof') and not include_hidden: continue
        v=np.array(G['v'],np.float32); v=np.stack([v[:,0],v[:,2],-v[:,1]],1).astype(np.float32)
        idx=np.array(G['i'],np.uint32).reshape(-1,3)
        tv=v[idx.reshape(-1)]  # flat
        a=tv[0::3];b=tv[1::3];c=tv[2::3]
        n=np.cross(b-a,c-a); ln=np.linalg.norm(n,axis=1,keepdims=True); ln[ln==0]=1; n=(n/ln).astype(np.float32)
        nn=np.repeat(n,3,0)
        if mat not in matidx:
            col=COLORS.get(mat,(0.8,0.8,0.8,1))
            m={'name':mat,'pbrMetallicRoughness':{'baseColorFactor':list(col),'metallicFactor':0.3 if mat in('metal','frame','rack') else 0.0,'roughnessFactor':0.6},'doubleSided':True}
            if col[3]<1: m['alphaMode']='BLEND'
            matidx[mat]=len(materials); materials.append(m)
        acc=[]
        for arr,typ in ((tv,'VEC3'),(nn,'VEC3')):
            pad(); off=len(blob); blob.extend(arr.tobytes())
            views.append({'buffer':0,'byteOffset':off,'byteLength':arr.nbytes,'target':34962})
            d={'bufferView':len(views)-1,'componentType':5126,'count':len(arr),'type':typ}
            if len(acc)==0: d['min']=arr.min(0).tolist(); d['max']=arr.max(0).tolist()
            accessors.append(d); acc.append(len(accessors)-1)
        meshes.append({'name':f'{fl}_{layer}_{mat}','primitives':[{'attributes':{'POSITION':acc[0],'NORMAL':acc[1]},'material':matidx[mat]}]})
        nodes.append({'name':f'{fl} | {layer} | {mat}','mesh':len(meshes)-1})
    pad()
    gl={'asset':{'version':'2.0','generator':'AiiMS office model build (Claude)'},'scene':0,
        'scenes':[{'name':'AiiMS Office','nodes':list(range(len(nodes)))}],'nodes':nodes,'meshes':meshes,
        'materials':materials,'accessors':accessors,'bufferViews':views,'buffers':[{'byteLength':len(blob)}]}
    js=json.dumps(gl).encode();
    while len(js)%4: js+=b' '
    total=12+8+len(js)+8+len(blob)
    with open(path,'wb') as fp:
        fp.write(struct.pack('<III',0x46546C67,2,total))
        fp.write(struct.pack('<II',len(js),0x4E4F534A)); fp.write(js)
        fp.write(struct.pack('<II',len(blob),0x004E4942)); fp.write(blob)
print('prims',len(P),'windows',len(wins))
