// Builds the mod's drawings module (hooks/clawds.ts), the README's drawings and a preview page from the chosen Clawd SVGs.
// Usage: node herramientas/genera_clawds.js [downloaded folder] [own drawings folder] [selection.json] [out clawds.ts] [out preview.html] [out folder for the README's drawings]
// With no arguments it reads herramientas/clawd-descarga, herramientas/clawd-propios and herramientas/seleccion-clawd.json,
// writes hooks/clawds.ts and one SVG per drawing in imagenes/clawds, and leaves the preview page in the system's temporary folder, as clawds-previa.html.
const fs = require('fs');
const os = require('os');
const path = require('path');

const AQUI = __dirname;
const [descargas, propios, seleccion, salidaTs, salidaHtml, salidaReadme] = [
  path.join(AQUI, 'clawd-descarga'),
  path.join(AQUI, 'clawd-propios'),
  path.join(AQUI, 'seleccion-clawd.json'),
  path.join(AQUI, '..', 'hooks', 'clawds.ts'),
  path.join(os.tmpdir(), 'clawds-previa.html'),
  path.join(AQUI, '..', 'imagenes', 'clawds'),
].map((porDefecto, i) => path.resolve(process.argv[2 + i] || porDefecto));
const eleccion = JSON.parse(fs.readFileSync(seleccion, 'utf8'));
const POSES = { celebrating: 'terminado', dizzy: 'fallo', sleeping: 'parado' };
const RECORTE = '-6 -9 27 27'; // the 15x16 body centred, room for hats above and props at the sides
const PELIGRO = /<script|foreignObject|\bon[a-z]+\s*=|@import|<image|<iframe|javascript:|href="(?!#)|url\((?!#)/i;

const lee = (id) => {
  const propio = path.join(propios, `clawd-${id}.svg`);
  const ruta = fs.existsSync(propio) ? propio : path.join(descargas, `clawd-${id}.svg`);
  return { ruta, svg: fs.readFileSync(ruta, 'utf8') };
};

const prepara = (svg, id) => {
  let s = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '');
  if (PELIGRO.test(s)) throw new Error(`Contenido no esperado en ${id}`);
  s = s.replace(/<svg\b([^>]*)>/, (m, a) => {
    let attrs = a.replace(/\s(width|height)="[^"]*"/g, '');
    attrs = attrs.replace(/viewBox="-15 -25 45 45"/, `viewBox="${RECORTE}"`);
    return `<svg${attrs}>`;
  });
  return s.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
};

const profesiones = [];
const clawds = {};
for (const [id, nombre] of Object.entries(eleccion)) {
  const { ruta, svg } = lee(id);
  clawds[id] = prepara(svg, id);
  if (!POSES[id]) profesiones.push({ id, nombre, propio: ruta.startsWith(propios) });
}

const ts = [
  '// Generated from the chosen drawings: do not edit by hand.',
  '// Every drawing but medico and cientifico comes from clawd-pet by Abderrahim GHAZALI (MIT licence, see LICENSE-clawd-pet.txt);',
  '// their viewBox is cropped to the character and their width and height are left to the panel. medico and cientifico were drawn for this mod.',
  '',
  'export type Profesion = { id: string; nombre: string }',
  '',
  `export const PROFESIONES: readonly Profesion[] = ${JSON.stringify(profesiones.map(({ id, nombre }) => ({ id, nombre })), null, 2)}`,
  '',
  "export const POSES = { terminado: 'celebrating', fallo: 'dizzy', parado: 'sleeping' } as const",
  '',
  `export const CLAWDS: Readonly<Record<string, string>> = ${JSON.stringify(clawds, null, 2)}`,
  '',
].join('\n');
fs.writeFileSync(salidaTs, ts);

const celda = (id, etiqueta) => `<figure><img src="data:image/svg+xml;base64,${Buffer.from(clawds[id]).toString('base64')}" alt="${id}"><figcaption><b>${etiqueta}</b><span>${id}</span></figcaption></figure>`;
fs.writeFileSync(salidaHtml, `<!doctype html><meta charset="utf-8"><title>Clawds del mod</title>
<style>body{margin:0;padding:20px;font:14px/1.35 "Segoe UI",system-ui,sans-serif;background:#faf9f5;color:#262624}
h1{font-size:20px;font-weight:600;margin:0 0 4px}h2{font-size:15px;font-weight:600;margin:18px 0 8px}p{margin:0 0 12px;color:#5f5e5a}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}
figure{margin:0;background:#fff;border:1px solid #e5e3da;border-radius:12px;padding:6px 6px 8px;text-align:center}
img{width:88px;height:88px;display:block;margin:0 auto;image-rendering:pixelated}
figcaption{display:flex;flex-direction:column;font-size:12px;color:#5f5e5a}figcaption b{color:#993c1d;font-size:13px}</style>
<h1>Los Clawds del panel Equipo</h1><p>${profesiones.length} profesiones, que se reparten al azar sin repetir mientras trabajan a la vez, y tres poses para el final.</p>
<h2>Profesiones</h2><main>${profesiones.map((p) => celda(p.id, p.nombre)).join('')}</main>
<h2>Al acabar</h2><main>${Object.keys(POSES).map((id) => celda(id, eleccion[id])).join('')}</main>`);

// The README's drawings: the same cleaned and cropped SVGs, one file each, with a size of their own
// so they also show when opened alone. Files of drawings no longer chosen are listed, never deleted.
fs.mkdirSync(salidaReadme, { recursive: true });
for (const [id, svg] of Object.entries(clawds)) {
  fs.writeFileSync(path.join(salidaReadme, `clawd-${id}.svg`), `${svg.replace(/<svg\b/, '<svg width="96" height="96"')}\n`);
}
const sobran = fs.readdirSync(salidaReadme).filter((f) => /^clawd-.+\.svg$/.test(f) && !Object.hasOwn(clawds, f.slice(6, -4)));

const kb = Math.round(Buffer.byteLength(ts) / 1024);
console.log(`profesiones: ${profesiones.length} (propias: ${profesiones.filter((p) => p.propio).map((p) => p.id).join(', ')}) | poses: ${Object.keys(POSES).length} | clawds.ts: ${kb} KB | máx. por dibujo: ${Math.max(...Object.values(clawds).map((s) => s.length))} caracteres`);
console.log(`escrito: ${salidaTs}\ndibujos del README: ${salidaReadme} (${Object.keys(clawds).length})\nprevia: ${salidaHtml}`);
if (sobran.length > 0) console.log(`sobran en ${salidaReadme}, porque ya no están en la selección (bórralos a mano si no los usa el README): ${sobran.join(', ')}`);
