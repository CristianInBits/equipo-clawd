// Synthesizes a short two-note chime (a "tintineo") as a 16-bit mono WAV.
// Usage: node herramientas/genera_tintineo.js [out.wav]
// With no argument it writes assets/tintineo.wav.
const fs = require('fs');
const path = require('path');

const salida = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'tintineo.wav'));
const TASA = 44100;
const DURACION = 0.5;
const n = Math.round(TASA * DURACION);
const muestras = new Float64Array(n);

// Two bell-like notes, E6 then B6, each a fundamental plus softer partials with a fast exponential fade.
const notas = [
  { inicio: 0.0, f: 1318.51, amp: 0.32, tau: 0.13 },
  { inicio: 0.085, f: 1975.53, amp: 0.26, tau: 0.16 },
];
for (const { inicio, f, amp, tau } of notas) {
  const desde = Math.round(inicio * TASA);
  for (let i = desde; i < n; i++) {
    const t = (i - desde) / TASA;
    const ataque = Math.min(1, t / 0.004);
    const caida = Math.exp(-t / tau);
    const tono = Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t / (tau * 0.5)) + 0.12 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t / (tau * 0.3));
    muestras[i] += amp * ataque * caida * tono;
  }
}
// A short fade at the very end so the file never clicks.
for (let i = 0; i < 400; i++) muestras[n - 1 - i] *= i / 400;

const pico = Math.max(...muestras.map(Math.abs));
const escala = pico > 0.9 ? 0.9 / pico : 1;
const datos = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) datos.writeInt16LE(Math.round(Math.max(-1, Math.min(1, muestras[i] * escala)) * 32767), i * 2);

const cabecera = Buffer.alloc(44);
cabecera.write('RIFF', 0); cabecera.writeUInt32LE(36 + datos.length, 4); cabecera.write('WAVE', 8);
cabecera.write('fmt ', 12); cabecera.writeUInt32LE(16, 16); cabecera.writeUInt16LE(1, 20); cabecera.writeUInt16LE(1, 22);
cabecera.writeUInt32LE(TASA, 24); cabecera.writeUInt32LE(TASA * 2, 28); cabecera.writeUInt16LE(2, 32); cabecera.writeUInt16LE(16, 34);
cabecera.write('data', 36); cabecera.writeUInt32LE(datos.length, 40);
fs.writeFileSync(salida, Buffer.concat([cabecera, datos]));
console.log(`tintineo: ${DURACION} s, ${Math.round((44 + datos.length) / 1024)} KB, pico ${(pico * escala).toFixed(2)} -> ${salida}`);
