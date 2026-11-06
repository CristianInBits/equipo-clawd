// Synthesizes a very short victory fanfare on a brass-like tone (G4, C5, E5, then a held G5) as a 16-bit mono WAV.
// Usage: node herramientas/genera_victoria.js [out.wav]
// With no argument it writes assets/victoria.wav.
const fs = require('fs');
const path = require('path');

const salida = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'victoria.wav'));
const TASA = 44100;
const notas = [
  { f: 392.0, dura: 0.1 },
  { f: 523.25, dura: 0.1 },
  { f: 659.25, dura: 0.1 },
  { f: 783.99, dura: 0.42, vibrato: true },
];
const HUECO = 0.018;
const total = notas.reduce((s, n) => s + n.dura + HUECO, 0) + 0.08;
const n = Math.round(TASA * total);
const muestras = new Float64Array(n);

let t0 = 0;
for (const nota of notas) {
  const desde = Math.round(t0 * TASA);
  const largo = Math.round((nota.dura + 0.06) * TASA);
  let fase = 0;
  for (let i = 0; i < largo && desde + i < n; i++) {
    const t = i / TASA;
    // Envelope: quick attack with a small brassy overshoot, then a short release after the note's length.
    const ataque = t < 0.025 ? t / 0.025 : t < 0.06 ? 1.15 - 0.15 * ((t - 0.025) / 0.035) : 1;
    const suelta = t > nota.dura ? Math.max(0, 1 - (t - nota.dura) / 0.05) : 1;
    const env = ataque * suelta;
    const vib = nota.vibrato && t > 0.12 ? 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * (t - 0.12)) : 1;
    fase += (2 * Math.PI * nota.f * vib) / TASA;
    // Brass: the louder the note, the brighter it gets, so the upper harmonics follow the envelope.
    const brillo = Math.pow(Math.min(1, env), 1.5);
    let s = 0;
    for (let k = 1; k <= 14; k++) {
      const a = (1 / k) * (k <= 3 ? 1 : Math.pow(brillo, 0.5 * (k - 3)));
      s += a * Math.sin(k * fase);
    }
    muestras[desde + i] += 0.22 * env * s;
  }
  t0 += nota.dura + HUECO;
}
for (let i = 0; i < 300; i++) muestras[n - 1 - i] *= i / 300;

let pico = 0;
for (const v of muestras) pico = Math.max(pico, Math.abs(v));
const escala = 0.85 / pico;
const datos = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) datos.writeInt16LE(Math.round(Math.max(-1, Math.min(1, muestras[i] * escala)) * 32767), i * 2);

const cabecera = Buffer.alloc(44);
cabecera.write('RIFF', 0); cabecera.writeUInt32LE(36 + datos.length, 4); cabecera.write('WAVE', 8);
cabecera.write('fmt ', 12); cabecera.writeUInt32LE(16, 16); cabecera.writeUInt16LE(1, 20); cabecera.writeUInt16LE(1, 22);
cabecera.writeUInt32LE(TASA, 24); cabecera.writeUInt32LE(TASA * 2, 28); cabecera.writeUInt16LE(2, 32); cabecera.writeUInt16LE(16, 34);
cabecera.write('data', 36); cabecera.writeUInt32LE(datos.length, 40);
fs.writeFileSync(salida, Buffer.concat([cabecera, datos]));
console.log(`victoria: ${total.toFixed(2)} s, ${Math.round((44 + datos.length) / 1024)} KB -> ${salida}`);
