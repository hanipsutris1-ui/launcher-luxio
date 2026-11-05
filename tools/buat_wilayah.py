"""Membuat assets/wilayah.lxw dari data geografis (github.com/drizki/geografis, MIT; kode wilayah Kemendagri = domain publik).
Format (big-endian):
  'LXW1' | nProv u16 | prov* (utf8 \n) | nKab u16 | (provIdx u16 + nama) | nKec u16 | (kabIdx u16 + kodeKec 'NN.NN.NN' + nama) |
  nDesa u32 | desa* : lat i32 (x1e5), lon i32 (x1e5), kecIdx u16, akhiranKode u16 (4 digit desa)
"""
import json,struct,gzip,sys
d=json.load(open(sys.argv[1]))
prov,kab,kec=[],[],[];pi,ki,ci={},{},{}
rows=[]
for x in d:
    if x.get('latitude') is None or x.get('longitude') is None:continue
    c=x['code'].split('.')
    if len(c)!=4:continue
    p=x['province'];k=(p,x['city']);kc='.'.join(c[:3])
    if p not in pi:pi[p]=len(prov);prov.append(p)
    if k not in ki:ki[k]=len(kab);kab.append((pi[p],x['city']))
    if kc not in ci:ci[kc]=len(kec);kec.append((ki[k],kc,x['district']))
    rows.append((round(x['latitude']*1e5),round(x['longitude']*1e5),ci[kc],int(c[3])))
b=bytearray(b'LXW1')
def s(t):e=t.encode('utf8');b.extend(struct.pack('>H',len(e)));b.extend(e)
b+=struct.pack('>H',len(prov));[s(p) for p in prov]
b+=struct.pack('>H',len(kab))
for i,n in kab:b+=struct.pack('>H',i);s(n)
b+=struct.pack('>H',len(kec))
for i,kc,n in kec:b+=struct.pack('>H',i);s(kc);s(n)
b+=struct.pack('>I',len(rows))
for r in rows:b+=struct.pack('>iiHH',*r)
open(sys.argv[2],'wb').write(gzip.compress(bytes(b),9))
print(len(prov),len(kab),len(kec),len(rows),len(b),'->',len(gzip.compress(bytes(b),9)))
