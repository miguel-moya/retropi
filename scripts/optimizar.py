"""RetroPi — versiones ligeras (WebP) de las imágenes descargadas.

Tamaños pensados para lo que se ve en pantalla, al doble para pantallas retina:
  portada pequeña  264 px de ancho  → listado, estantería, fondo difuminado (se ven a 44–150 px)
  portada grande   484 px (la original) → ficha (se ve a 236–400 px)
  lomo              56 × 400 px       → lateral de las cajas (se ve a 18–28 px de ancho)
Se ejecuta en la carpeta de la rama «portadas» y actualiza covers/map.json. Solo procesa lo que falte o haya cambiado.
"""
import json, os, sys
from PIL import Image

MAPA = 'covers/map.json'
m = json.load(open(MAPA))
hechos = 0

def webp(origen, destino, ancho=None, alto=None, calidad=78):
    if not os.path.exists(origen):
        return None
    if os.path.exists(destino) and os.path.getmtime(destino) >= os.path.getmtime(origen):
        return destino
    im = Image.open(origen)
    im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
    if ancho and alto:
        im = im.resize((ancho, alto), Image.LANCZOS)
    elif ancho and im.width > ancho:
        im = im.resize((ancho, round(im.height * ancho / im.width)), Image.LANCZOS)
    im.save(destino, 'WEBP', quality=calidad, method=6)
    return destino

for k, v in m.items():
    a = v.get('archivo')
    if not a:
        continue
    base = a[:-4]
    antes = (v.get('g'), v.get('p'), v.get('lw'))
    v['g'] = webp(a, base + '.webp', calidad=72)
    v['p'] = webp(a, base + '-p.webp', ancho=264, calidad=72)
    if v.get('lomo'):
        v['lw'] = webp(v['lomo'], base + '-lomo.webp', ancho=56, alto=400, calidad=80)
    if (v.get('g'), v.get('p'), v.get('lw')) != antes:
        hechos += 1

json.dump(dict(sorted(m.items())), open(MAPA, 'w'), ensure_ascii=False, indent=1)
open(MAPA, 'a').write('\n')
print(f'Imágenes optimizadas para {hechos} títulos')
