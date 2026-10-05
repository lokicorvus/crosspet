"""检查每个状态的特效会不会压到人物身上：每个特效只和「同一姿态」的立绘比（四个内置角色的轮廓并集）。
某个角色缺这个姿态的图时，用 App 里会顶上的那张（compact→writing 等，最后是 idle）。
具名特效（effects.js 的 named，如 bubbles）和所有在 character.json 的 fx 里用到它的姿态比。
输出每个特效和人物重叠的像素数；加第二个参数 vis 会生成 vis_<姿态>.png（红=人物，绿=特效，亮=重叠）。"""
import glob, json, os, sys
from PIL import Image, ImageChops
S=sys.argv[1].rstrip('/')+'/'
CW,CH,AX,AY,AW,AH=580,560,103,118,374,420  # 和 effects.js 的画布、立绘摆放一致
C=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','characters')+'/'
FALLBACK={'compact':'writing','reset':'happy','feast':'eat','sorry':'listening'}  # 和 index.html 的 POSE_FALLBACK 一致
chars=[d for d in sorted(glob.glob(C+'*/')) if '/egg-' not in d and os.path.exists(d+'character.json')]
cfg={d:json.load(open(d+'character.json',encoding='utf-8')) for d in chars}

def frames(d,pose):
    for p in (pose, FALLBACK.get(pose), 'idle'):
        if not p: continue
        fs=[f for f in glob.glob(d+p+'*.webp') if os.path.basename(f)[:-5].split('-')[0]==p and 'blink' not in f]
        if fs: return fs
    return []

_cache={}
def body_for(poses):
    key=tuple(sorted(poses))
    if key in _cache: return _cache[key]
    body=Image.new('L',(CW,CH),0)
    for d in chars:
        for pose in poses:
            for f in frames(d,pose):
                im=Image.open(f).convert('RGBA'); s=min(AW/im.width, AH/im.height)
                w,h=round(im.width*s),round(im.height*s); a=im.split()[3].resize((w,h))
                m=Image.new('L',(CW,CH),0); m.paste(a,(AX+(AW-w)//2, AY+AH-h)); body=ImageChops.lighter(body,m)
    body=body.point(lambda v:255 if v>100 else 0)
    _cache[key]=body
    return body

def poses_for(name):
    if name.startswith('fx-'):  # 具名特效：哪些姿态用到它
        n=name[3:]; ps={p for c in cfg.values() for p,v in (c.get('fx') or {}).items() if v==n}
        return ps or {'idle'}
    return {name}

res=[]
for p in sorted(glob.glob(S+'*.svg.png')):
    name=p.split('/')[-1].replace('.svg.png','')
    sq=Image.open(p).convert('RGB')                   # qlmanage 出 580x580，内容 580x560 居中
    fx=sq.crop((0,(sq.height-CH)//2,CW,(sq.height-CH)//2+CH)) if sq.size==(CW,CW) else sq.resize((CW,CH))
    ink=fx.convert('L').point(lambda v:255 if v<235 else 0)
    body=body_for(poses_for(name))
    ov=ImageChops.darker(ink, body)                   # 两者都为 255 的地方才是 255
    n=sum(1 for v in ov.getdata() if v); total=sum(1 for v in ink.getdata() if v)
    res.append((name,n,total,ov.getbbox()))
    if len(sys.argv)>2:
        vis=Image.merge('RGB',(body.point(lambda v:v//3), ink.point(lambda v:v//2), ov)); vis.save(S+f'vis_{name}.png')
for name,n,total,bb in sorted(res,key=lambda r:-r[1]):
    print(f'{name:11s} 重叠 {n:6d} / 特效 {total:6d} ({(100*n//total) if total else 0:2d}%)  位置 {bb}')

bad=[r for r in res if r[1]>0]
print('\n全部通过' if not bad else f'\n有 {len(bad)} 个特效压到人物')
sys.exit(1 if bad else 0)
