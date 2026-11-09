// RetroPi — descarga portadas PAL/EU desde ScreenScraper y las guarda en covers/.
// Lo ejecuta la tarea de GitHub «Portadas». Credenciales: secretos del repositorio (nunca en el código).
//   SS_DEVID, SS_DEVPASSWORD (desarrollador) · SS_USER, SS_PASSWORD (cuenta normal, opcional)
//   RETROPI_URL, RETROPI_KEY (Apps Script, para saber qué juegos hay)
// Resultado:
//   covers/<consola>/<slug>.jpg     una portada por título
//   covers/map.json                 qué se encontró para cada título (la app lo lee)
// Correcciones a mano en covers/ajustes.json:
//   { "megadrive|ariel the little mermaid": 12345 }        → usar ese id de juego de ScreenScraper
//   { "megadrive|toki": "Toki Going Ape Spit" }            → buscar con ese texto
//   { "nes|soccer": "no" }                                 → no buscar portada para ese título
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
function elegirPortada(jeu, japones) {
  const cajas = (jeu.medias || []).filter(m => m.type === 'box-2D');
  for (const reg of (japones ? ['jp', ...REGIONES] : REGIONES)) { const m = cajas.find(x => x.region === reg); if (m) return m; }
  return cajas[0] || null;
}
// Palabras significativas de un título, para comparar con los nombres que devuelve ScreenScraper
const ROMANOS = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6' };
const palabras = t => new Set((String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/'n\b/g, 'n').match(/[a-z0-9]+/g) || []).map(w => ROMANOS[w] || w)
  .filter(w => !['the', 'of', 'and', 'in', 'a', 'de', 'la', 'el', 'n', '1'].includes(w)));
const numeros = set => [...set].filter(w => /^\d+$/.test(w)).sort().join(',');
function parecido(termino, jeu) {
  const a = palabras(termino); if (!a.size) return 0;
  return Math.max(0, ...(jeu.noms || []).map(n => {
    const b = palabras(n.text); let k = 0; a.forEach(w => b.has(w) && k++);
    // cuánto del término aparece en el nombre, con una pequeña penalización por palabras de más
    const p = k / a.size - 0.05 * Math.max(0, b.size - k);
    return numeros(a) === numeros(b) ? p : p * 0.3;   // «Mega Man» ≠ «Mega Man 2», «Super Mario Bros 3» ≠ «Super Mario Bros»
  }));
}
// Variantes del título para buscar: tal cual, sin signos, antes y después de «:», sin «The»
function variantes(t, nc, extra) {
  const limpio = x => String(x).replace(/[:'’&!.,\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const v = [extra, t, limpio(t), t.includes(':') ? t.split(':')[1] : '', t.includes(':') ? t.split(':')[0] : '', limpio(t).replace(/^the /i, ''), nc];
  return v.map(x => x && String(x).trim()).filter((x, i, a) => x && x.length > 1 && a.indexOf(x) === i);
}
const nombreJuego = jeu => { const ns = jeu.noms || []; return (ns.find(n => n.region === 'eu') || ns.find(n => n.region === 'wor') || ns[0] || {}).text || ''; };

// 1) qué juegos hay
const datos = await (await fetch(`${E.RETROPI_URL}?key=${encodeURIComponent(E.RETROPI_KEY)}`)).json();
if (!datos.ok) { console.error('El Apps Script no devolvió datos'); process.exit(1); }
const titulos = new Map();
for (const c of datos.consolas) {
  if (!SISTEMA[c.id]) continue;
  for (const g of c.juegos) {
    const k = clave(c.id, g['Título']);
    if (!titulos.has(k)) titulos.set(k, { c: c.id, t: g['Título'], nc: g['Nombre clave'], regiones: new Set() });
    titulos.get(k).regiones.add(String(g['Región'] || '').slice(0, 2).toUpperCase());
  }
}

// 2) buscar y descargar lo que falte
const mapa = await leer(path.join(DIR, 'map.json'), {});
const ajustes = await leer(path.join(DIR, 'ajustes.json'), {});
let nuevos = 0, ok = 0, fallos = 0;
for (const [k, j] of titulos) {
  const aj = ajustes[k];
  if (aj === 'no') { mapa[k] = { estado: 'omitido' }; continue; }
  const previo = mapa[k];
  if (!E.FORZAR && previo && previo.archivo && (!aj || previo.ssid === aj || previo.buscado === aj)) continue;     // ya está y no hay corrección nueva
  if (previo && previo.estado === 'no encontrado' && !aj && !E.REINTENTAR) continue;
  if (nuevos++ >= LIMITE) break;
  try {
    let jeu = null;
    let buscado = j.t;
    if (typeof aj === 'number') jeu = (await ss('jeuInfos.php', { gameid: aj, systemeid: SISTEMA[j.c] })).response?.jeu || null;
    else {
      // prueba variantes y se queda con el resultado cuyo nombre más se parece (no el primero sin más)
      let mejor = null, nota = 0; const vistos = [];
      for (const termino of variantes(j.t, j.nc, typeof aj === 'string' ? aj : '')) {
        const r = await ss('jeuRecherche.php', { recherche: termino, systemeid: SISTEMA[j.c] });
        await espera(1200);
        if (r.aviso) vistos.push(`«${termino}»: ${r.aviso.replace(/\s+/g, ' ').slice(0, 60)}`);
        for (const x of (r.response?.jeux || []).filter(x => x && x.id)) {
          if (vistos.length < 6) vistos.push(nombreJuego(x));
          const p = Math.max(parecido(termino, x), parecido(j.t, x));
          if (p > nota) { mejor = x; nota = p; buscado = termino; }
        }
        if (nota >= 0.99 || (typeof aj === 'string' && mejor)) break;
      }
      jeu = nota >= 0.6 ? mejor : null;
      if (!jeu) j.vistos = vistos;
    }
    const m = jeu && elegirPortada(jeu, j.regiones.size === 1 && j.regiones.has('JP'));
    if (!m) {
      if (previo && previo.archivo) previo.estado = 'dudoso';          // al rehacer, no se pierde la portada anterior
      else mapa[k] = { estado: 'no encontrado', buscado: j.t };
      fallos++; console.log(`✗ ${j.c} · ${j.t}   (vistos: ${(j.vistos || []).join(' | ') || 'nada'})`); continue;
    }
    const rel = `${DIR}/${j.c}/${slug(j.t)}.jpg`;
    const img = await fetch(`${m.url}&maxwidth=600&outputformat=jpg`);
    if (!img.ok) throw new Error('descarga ' + img.status);
    await fs.mkdir(path.dirname(rel), { recursive: true });
    await fs.writeFile(rel, Buffer.from(await img.arrayBuffer()));
    mapa[k] = { archivo: rel, ssid: Number(jeu.id), nombre: nombreJuego(jeu), region: m.region, buscado: typeof aj === 'string' ? aj : buscado, estado: aj ? 'corregido' : 'auto' };
    ok++; console.log(`✓ ${j.c} · ${j.t} → ${mapa[k].nombre} [${m.region}]`);
    await espera(1200);
  } catch (e) { fallos++; console.log(`! ${j.c} · ${j.t}: ${e.message}`); if (/quota|429/.test(e.message)) break; }
}
await fs.mkdir(DIR, { recursive: true });
const orden = Object.fromEntries(Object.entries(mapa).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(path.join(DIR, 'map.json'), JSON.stringify(orden, null, 1) + '\n');
console.log(`\nNuevas: ${ok} · sin portada o error: ${fallos} · total títulos: ${titulos.size}`);
