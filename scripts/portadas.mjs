// RetroPi — descarga portadas PAL/EU desde ScreenScraper y las guarda en covers/.
// Lo ejecuta la tarea de GitHub «Portadas». Credenciales: secretos del repositorio (nunca en el código).
//   SS_DEVID, SS_DEVPASSWORD (desarrollador) · SS_USER, SS_PASSWORD (cuenta normal, opcional)
//   RETROPI_URL, RETROPI_KEY (Apps Script, para saber qué juegos hay)
// Resultado:
//   covers/<consola>/<slug>.jpg     una portada por título
//   covers/map.json                 qué se encontró para cada título (la app lo lee)
// Correcciones a mano en covers/ajustes.json:
//   { "megadrive|ariel the little mermaid": 12345 }   → usar ese id de juego de ScreenScraper
//   { "nes|soccer": "no" }                            → no buscar portada para ese título
import fs from 'node:fs/promises';
import path from 'node:path';

const E = process.env;
for (const k of ['SS_DEVID', 'SS_DEVPASSWORD', 'RETROPI_URL', 'RETROPI_KEY']) if (!E[k]) { console.error(`Falta el secreto ${k}`); process.exit(1); }
const SISTEMA = { megadrive: 1, mastersystem: 2, nes: 3 };           // ids de sistema en ScreenScraper
const REGIONES = ['eu', 'sp', 'fr', 'uk', 'de', 'it', 'wor', 'us', 'jp', 'ss'];
const LIMITE = Number(E.LIMITE || 400);                               // máximo de títulos nuevos por ejecución
const DIR = 'covers';
const espera = ms => new Promise(r => setTimeout(r, ms));
const slug = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const clave = (c, t) => `${c}|${String(t).trim().toLowerCase()}`;
const leer = async (f, def) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return def; } };

const auth = new URLSearchParams({ devid: E.SS_DEVID, devpassword: E.SS_DEVPASSWORD, softname: 'RetroPi', output: 'json' });
if (E.SS_USER) { auth.set('ssid', E.SS_USER); auth.set('sspassword', E.SS_PASSWORD || ''); }
async function ss(endpoint, params) {
  const url = `https://api.screenscraper.fr/api2/${endpoint}?${auth}&${new URLSearchParams(params)}`;
  for (let intento = 1; intento <= 3; intento++) {
    const r = await fetch(url);
    const txt = await r.text();
    if (r.ok) { try { return JSON.parse(txt); } catch { /* respuesta de texto = sin resultados o aviso */ return { aviso: txt.slice(0, 120) }; } }
    if (r.status === 404) return { aviso: 'no encontrado' };
    if (r.status === 429 || r.status >= 500) { await espera(5000 * intento); continue; }
    throw new Error(`ScreenScraper ${r.status}: ${txt.slice(0, 160)}`);
  }
  return { aviso: 'sin respuesta' };
}
function elegirPortada(jeu) {
  const cajas = (jeu.medias || []).filter(m => m.type === 'box-2D');
  for (const reg of REGIONES) { const m = cajas.find(x => x.region === reg); if (m) return m; }
  return cajas[0] || null;
}
const nombreJuego = jeu => { const ns = jeu.noms || []; return (ns.find(n => n.region === 'eu') || ns.find(n => n.region === 'wor') || ns[0] || {}).text || ''; };

// 1) qué juegos hay
const datos = await (await fetch(`${E.RETROPI_URL}?key=${encodeURIComponent(E.RETROPI_KEY)}`)).json();
if (!datos.ok) { console.error('El Apps Script no devolvió datos'); process.exit(1); }
const titulos = new Map();
for (const c of datos.consolas) {
  if (!SISTEMA[c.id]) continue;
  for (const g of c.juegos) { const k = clave(c.id, g['Título']); if (!titulos.has(k)) titulos.set(k, { c: c.id, t: g['Título'], nc: g['Nombre clave'] }); }
}

// 2) buscar y descargar lo que falte
const mapa = await leer(path.join(DIR, 'map.json'), {});
const ajustes = await leer(path.join(DIR, 'ajustes.json'), {});
let nuevos = 0, ok = 0, fallos = 0;
for (const [k, j] of titulos) {
  const aj = ajustes[k];
  if (aj === 'no') { mapa[k] = { estado: 'omitido' }; continue; }
  const previo = mapa[k];
  if (previo && previo.archivo && (!aj || previo.ssid === aj)) continue;     // ya está y no hay corrección nueva
  if (previo && previo.estado === 'no encontrado' && !aj && !E.REINTENTAR) continue;
  if (nuevos++ >= LIMITE) break;
  try {
    let jeu = null;
    if (aj) jeu = (await ss('jeuInfos.php', { gameid: aj, systemeid: SISTEMA[j.c] })).response?.jeu || null;
    else {
      for (const termino of [j.t, j.nc].filter((x, i, a) => x && a.indexOf(x) === i)) {
        const r = await ss('jeuRecherche.php', { recherche: termino, systemeid: SISTEMA[j.c] });
        jeu = (r.response?.jeux || []).find(x => x && x.id) || null;
        await espera(1200);
        if (jeu) break;
      }
    }
    const m = jeu && elegirPortada(jeu);
    if (!m) { mapa[k] = { estado: 'no encontrado', buscado: j.t }; fallos++; console.log(`✗ ${j.c} · ${j.t}`); continue; }
    const rel = `${DIR}/${j.c}/${slug(j.t)}.jpg`;
    const img = await fetch(`${m.url}&maxwidth=600&outputformat=jpg`);
    if (!img.ok) throw new Error('descarga ' + img.status);
    await fs.mkdir(path.dirname(rel), { recursive: true });
    await fs.writeFile(rel, Buffer.from(await img.arrayBuffer()));
    mapa[k] = { archivo: rel, ssid: Number(jeu.id), nombre: nombreJuego(jeu), region: m.region, estado: aj ? 'corregido' : 'auto' };
    ok++; console.log(`✓ ${j.c} · ${j.t} → ${mapa[k].nombre} [${m.region}]`);
    await espera(1200);
  } catch (e) { fallos++; console.log(`! ${j.c} · ${j.t}: ${e.message}`); if (/quota|429/.test(e.message)) break; }
}
await fs.mkdir(DIR, { recursive: true });
const orden = Object.fromEntries(Object.entries(mapa).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(path.join(DIR, 'map.json'), JSON.stringify(orden, null, 1) + '\n');
console.log(`\nNuevas: ${ok} · sin portada o error: ${fallos} · total títulos: ${titulos.size}`);
