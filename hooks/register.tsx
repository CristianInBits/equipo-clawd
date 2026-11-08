// Panel "Equipo": each agent of the session as a Clawd dressed in a random profession,
// with its task, type, model, effort, tokens and time; a toast and a short chime when it ends.
// At its foot, the usage limits, the context window and how long the prompt cache stays warm.
// /equipo opens it and, in the desktop app, so does a small «Clawds» button under the prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Agente, Cache, Consumo, Estado, Limite } from '../types'
import { CLAWDS, POSES, PROFESIONES } from './clawds'

const PANEL = 'equipo'
const TITULO = 'Equipo'
// Side of each Clawd's drawing, in CSS pixels: in the panel's rows and beside the chat's Agent row.
const LADO_PANEL = 72
const LADO_CHAT = 30
// Change the tag when Agente's fields change: it declines what an earlier version stored.
const agentes = atom({ plugin: 'equipo-clawd', key: 'agentes' } as const, [], { shape: 'agentes-1' })
const tic = atom({ plugin: 'equipo-clawd', key: 'tic' } as const, 0)
// Whether the mod plays its sounds. $.store keeps it between sessions and is what suena() obeys,
// so switching it in one session silences them all; this copy in $.state is what the panel draws.
const sonido = atom({ plugin: 'equipo-clawd', key: 'sonido' } as const, true)
const CLAVE_SONIDO = 'sonido'
// The panel's foot: what the engine measured last (usage windows and context window), and the main
// conversation's prompt cache (when its last answered request went out, and whether a turn of it runs).
// Consumo's fields leidos and recordados came later, both optional, so what the tag consumo-1 stored still fits.
const consumo = atom({ plugin: 'equipo-clawd', key: 'consumo' } as const, { limites: [] }, { shape: 'consumo-1' })
const cache = atom({ plugin: 'equipo-clawd', key: 'cache' } as const, { enUso: false }, { shape: 'cache-1' })
// On a subscription the main conversation's prompt cache lives an hour after each request (five minutes only
// in extra usage, past the plan's limits). Nothing the mod receives says which, so it counts an hour.
const CADUCIDAD_CACHE = 60 * 60 * 1000
// The last usage windows a session of this computer read, with when, kept in $.store: the engine only knows them once
// Claude answers, so a session that starts, after restarting the app or the computer too, shows these until then.
const CLAVE_LIMITES = 'limites'
const DIA = 24 * 60 * 60 * 1000

const MARCA: Record<Estado, string> = { trabajando: '●', terminado: '✓', fallo: '✗', parado: '■' }
const COLOR: Record<Estado, string> = { trabajando: '#D97757', terminado: '#639922', fallo: '#E24B4A', parado: '#888780' }
const NOMBRES = new Map(PROFESIONES.map(p => [p.id, p.nombre]))

const nombreDe = (id: string) => NOMBRES.get(id) ?? 'Clawd'

const modeloCorto = (modelo: string) =>
  /opus/i.test(modelo) ? 'opus' : /sonnet/i.test(modelo) ? 'sonnet' : /haiku/i.test(modelo) ? 'haiku' : /fable/i.test(modelo) ? 'fable' : modelo

// An agent's time as a stopwatch reads it, short so the panel can stay narrow: «0:45», «12:05», «1:03:12».
const cronometro = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const segundos = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${segundos}` : `${m}:${segundos}`
}

// A token count in short: «850», «354,6k», «1,2M».
const compacto = (n: number) =>
  n >= 999_950 ? `${(n / 1_000_000).toFixed(1).replace('.', ',')}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n)

type Uso = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
// As Claude Code counts an agent's tokens: what its last request carried and produced.
const tokensDe = (u: Uso | null | undefined) =>
  u ? u.input_tokens + u.output_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0

// A demo agent's tokens grow with its time, so the panel looks as it does with real ones.
const tokensVistos = (a: Agente, ahora: number) =>
  a.demo && a.estado === 'trabajando' ? Math.round((a.demo.tokens * Math.min(1, (ahora - a.inicio) / a.demo.dura)) / 100) * 100 : a.tokens

const dibujo = (a: Agente) => {
  const pose = a.estado === 'terminado' ? POSES.terminado : a.estado === 'fallo' ? POSES.fallo : a.estado === 'parado' ? POSES.parado : a.profesion
  return CLAWDS[pose] ?? CLAWDS[a.profesion] ?? ''
}

// Random, but no two agents working at once share a costume, and the last few are avoided too.
const eligeProfesion = (lista: readonly Agente[]) => {
  const ocupadas = new Set(lista.filter(a => a.estado === 'trabajando').map(a => a.profesion))
  const recientes = new Set(lista.slice(-8).map(a => a.profesion))
  let opciones = PROFESIONES.filter(p => !ocupadas.has(p.id) && !recientes.has(p.id))
  if (opciones.length === 0) opciones = PROFESIONES.filter(p => !ocupadas.has(p.id))
  if (opciones.length === 0) opciones = [...PROFESIONES]
  return opciones[Math.floor(Math.random() * opciones.length)].id
}

// The foot's colours, a traffic light: green, amber from half, red from 80 %. Every bar fills as its limit nears.
const semaforo = (p: number) => (p >= 80 ? '#E24B4A' : p >= 50 ? '#EF9F27' : '#639922')
const GRIS = '#888780'
const PIEL_CLAWD = '#DE886D'
const BRASA = '#FAC775'

// The foot's 8×8 pixel icons: # is the grey outline, o the Clawds' own colour and * the ember of the flame.
const ICONOS = {
  reloj: ['########', '.#oooo#.', '..#oo#..', '...##...', '...##...', '..#..#..', '.#oooo#.', '########'],
  semana: ['.#....#.', '########', '#oooooo#', '#......#', '#.#.#..#', '#......#', '#.#.#..#', '########'],
  contexto: ['#####...', '#...##..', '#.oo.##.', '#.....#.', '#.oooo#.', '#.....#.', '#.ooo.#.', '#######.'],
  llama: ['...o....', '..oo....', '..ooo...', '.oooo.o.', '.oo*ooo.', 'oo***oo.', 'oo***oo.', '.ooooo..'],
  moneda: ['..####..', '.#oooo#.', '#oo#ooo#', '#o#oooo#', '#oooo#o#', '#ooo#oo#', '.#oooo#.', '..####..'],
} as const
type Icono = keyof typeof ICONOS

// An icon as an SVG document; a cold one, the flame of a cache gone cold, is all grey.
const svgIcono = (icono: Icono, apagado: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">${ICONOS[icono]
    .flatMap((fila, y) =>
      [...fila].map((c, x) =>
        c === '.' ? '' : `<rect x="${x}" y="${y}" width="1" height="1" fill="${apagado || c === '#' ? GRIS : c === '*' ? BRASA : PIEL_CLAWD}"/>`,
      ),
    )
    .join('')}</svg>`

// Twenty squares, one for each 5 %; any figure above zero lights one at least.
const llenas = (p: number) => (p > 0 ? Math.min(20, Math.max(1, Math.round(p / 5))) : 0)

// The bar's markup carries its own size: drawn with no width of its own, it keeps 138 × 8 while there is room and
// shrinks with a narrow panel instead of pushing its figure out.
const svgBarra = (p: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="138" height="8" viewBox="0 0 138 8" shape-rendering="crispEdges">${Array.from({ length: 20 }, (_, i) =>
    i < llenas(p)
      ? `<rect x="${i * 7}" y="0" width="5" height="8" fill="${semaforo(p)}"/>`
      : `<rect x="${i * 7}" y="0" width="5" height="8" fill="${GRIS}" fill-opacity="0.3"/>`,
  ).join('')}</svg>`

// The usage windows the engine reports, with the name, icon and place each has in the foot.
const VENTANAS: Record<string, { etiqueta: string; icono: Icono; orden: number }> = {
  five_hour: { etiqueta: '5 horas', icono: 'reloj', orden: 0 },
  seven_day: { etiqueta: 'Semana', icono: 'semana', orden: 1 },
  spend_limit: { etiqueta: 'Gasto', icono: 'moneda', orden: 2 },
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Days from one moment to another by the computer's calendar: 0 on the same day, 1 on the next one.
const diasEntre = (desde: number, hasta: number) => {
  const dia = (t: number) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  return Math.round((dia(hasta) - dia(desde)) / 86_400_000)
}

// The hour of a moment, in the computer's own time: «a las 19:50», «a la 1:05».
const aLas = (d: Date) => `${d.getHours() === 1 ? 'a la' : 'a las'} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`

// When a window renews: «se renueva a las 19:50», «se renueva mañana a la 1:05», «se renueva el lunes a las 6:00».
const renovacion = (iso: string, ahora: number) => {
  const cuando = new Date(iso)
  if (Number.isNaN(cuando.getTime())) return ''
  const dias = diasEntre(ahora, cuando.getTime())
  const hora = aLas(cuando)
  if (dias <= 0) return `se renueva ${hora}`
  if (dias === 1) return `se renueva mañana ${hora}`
  if (dias < 7) return `se renueva el ${DIAS[cuando.getDay()]} ${hora}`
  return `se renueva el ${cuando.getDate()}/${cuando.getMonth() + 1} ${hora}`
}

// When a window renewed, once its time has passed: «se renovó a las 2:00», «se renovó ayer a las 19:50».
const renovada = (iso: string, ahora: number) => {
  const cuando = new Date(iso)
  const dias = diasEntre(cuando.getTime(), ahora)
  const hora = aLas(cuando)
  if (dias <= 0) return `se renovó ${hora}`
  if (dias === 1) return `se renovó ayer ${hora}`
  if (dias < 7) return `se renovó el ${DIAS[cuando.getDay()]} ${hora}`
  return `se renovó el ${cuando.getDate()}/${cuando.getMonth() + 1} ${hora}`
}

// When the remembered usage windows were read: «de hoy a las 17:12», «de ayer a las 23:10», «del lunes a las 9:00».
const momento = (ms: number, ahora: number) => {
  const cuando = new Date(ms)
  const dias = diasEntre(ms, ahora)
  const hora = aLas(cuando)
  if (dias <= 0) return `de hoy ${hora}`
  if (dias === 1) return `de ayer ${hora}`
  if (dias < 7) return `del ${DIAS[cuando.getDay()]} ${hora}`
  return `del ${cuando.getDate()}/${cuando.getMonth() + 1} ${hora}`
}

// What $.store holds under CLAVE_LIMITES, if it is what this mod wrote there: when the windows were read, and the windows.
const comoGuardados = (x: unknown): { leidos: number; limites: Limite[] } | undefined => {
  if (typeof x !== 'object' || x === null) return undefined
  const { leidos, limites } = x as { leidos?: unknown; limites?: unknown }
  if (typeof leidos !== 'number' || !Array.isArray(limites) || limites.length === 0) return undefined
  const validos = limites.every((l: unknown) => {
    const v = l as Partial<Record<keyof Limite, unknown>> | null
    return typeof v === 'object' && v !== null && typeof v.tipo === 'string' && typeof v.porcentaje === 'number' && (v.renueva === undefined || typeof v.renueva === 'string')
  })
  return validos ? { leidos, limites: limites as Limite[] } : undefined
}

const enPorcentaje = (p: number) => `${String(Math.round(p * 10) / 10).replace('.', ',')} %`

const tokensCortos = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.', ',').replace(/,0$/, '')} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n)

const quedan = (ms: number) => (ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min` : `${Math.max(1, Math.ceil(ms / 1000))} s`)

type FilaPie = { clave: string; icono: Icono; etiqueta: string; p: number; cifra: string; nota: string; apagado?: boolean }

// The cache's row: in use while a turn of the main conversation runs, then the time left of its hour, then cold.
const filaCache = (uso: Consumo, c: Cache, ahora: number): FilaPie[] => {
  const base = { clave: 'cache', icono: 'llama' as const, etiqueta: 'Caché' }
  if (c.enUso) return [{ ...base, p: 0, cifra: 'en uso', nota: 'Claude está trabajando' }]
  if (c.ultimaPeticion === undefined) return []
  const pasado = Math.max(0, ahora - c.ultimaPeticion)
  if (pasado >= CADUCIDAD_CACHE) {
    const tokens = uso.contexto?.tokens
    return [
      {
        ...base,
        p: 0,
        apagado: true,
        cifra: 'fría',
        nota: tokens ? `el próximo mensaje vuelve a cargar ${tokensCortos(tokens)} tokens` : 'el próximo mensaje vuelve a cargar la conversación',
      },
    ]
  }
  return [{ ...base, p: (pasado / CADUCIDAD_CACHE) * 100, cifra: quedan(CADUCIDAD_CACHE - pasado), nota: 'hasta que se enfríe' }]
}

// The foot's rows: the usage windows, the context window and the cache, each only once there is a figure for it.
// A window whose renewal time has passed starts over, so it shows empty until Claude answers again.
const filasPie = (uso: Consumo, c: Cache, ahora: number): FilaPie[] => {
  const limites = [...uso.limites]
    .sort((x, y) => (VENTANAS[x.tipo]?.orden ?? 9) - (VENTANAS[y.tipo]?.orden ?? 9))
    .map(l => {
      const renovado = l.renueva !== undefined && Date.parse(l.renueva) <= ahora
      const p = renovado ? 0 : l.porcentaje
      return {
        clave: l.tipo,
        icono: VENTANAS[l.tipo]?.icono ?? ('reloj' as const),
        etiqueta: VENTANAS[l.tipo]?.etiqueta ?? l.tipo.replace(/_/g, ' '),
        p,
        cifra: enPorcentaje(p),
        nota: l.renueva ? (renovado ? renovada(l.renueva, ahora) : renovacion(l.renueva, ahora)) : '',
      }
    })
  const ctx = uso.contexto
  const contexto: FilaPie[] =
    ctx?.porcentaje !== undefined
      ? [
          {
            clave: 'contexto',
            icono: 'contexto',
            etiqueta: 'Contexto',
            p: ctx.porcentaje,
            cifra: enPorcentaje(ctx.porcentaje),
            nota: ctx.tokens !== undefined ? `${tokensCortos(ctx.tokens)} de ${tokensCortos(ctx.ventana)} tokens` : '',
          },
        ]
      : []
  return [...limites, ...contexto, ...filaCache(uso, c, ahora)]
}

// The engine follows $ only into functions declared at the top of the file, so the helpers live here,
// with the little state they keep (it starts over on a reload, which is fine for a clock and a chime).
let reloj: { cancel: () => void; cada: number } | undefined
let alRenovarse: { cancel: () => void; cuando: number } | undefined
let ultimoSonido = 0
const nombresWorkflow = new Map<string, string>()

// The panel's clock: every second while an agent works, every 15 seconds while only the cache counts down,
// and stopped when there is nothing left to count. Besides, one beat when the next usage window renews, if it
// does within a day, so the foot shows it renewed even while nothing else ticks.
async function ajustaReloj($: EngineInterface) {
  const ahora = await $.clock.now()
  const trabajan = (await read($, agentes)).some(a => a.estado === 'trabajando')
  const c = await read($, cache)
  const caliente = !c.enUso && c.ultimaPeticion !== undefined && ahora - c.ultimaPeticion < CADUCIDAD_CACHE
  const cada = trabajan ? 1000 : caliente ? 15_000 : 0
  if ((reloj?.cada ?? 0) !== cada) {
    reloj?.cancel()
    reloj = undefined
    if (cada > 0) {
      const r = $.clock.every(cada, () => void latido($))
      reloj = { cancel: () => r.cancel(), cada }
    }
  }
  const proximas = (await read($, consumo)).limites.map(l => Date.parse(l.renueva ?? '')).filter(t => t > ahora && t - ahora <= DIA)
  const cuando = proximas.length > 0 ? Math.min(...proximas) : 0
  if ((alRenovarse?.cuando ?? 0) !== cuando) {
    alRenovarse?.cancel()
    alRenovarse = undefined
    if (cuando > 0) {
      const r = $.clock.after(cuando - ahora + 1000, () => void latido($))
      alRenovarse = { cancel: () => r.cancel(), cuando }
    }
  }
}

async function latido($: EngineInterface) {
  await update($, tic, n => (n + 1) % 1_000_000)
  await ajustaReloj($)
}

// The sound switch as stored: on unless someone switched it off. Brings the panel's copy in line,
// in case another session switched it meanwhile.
async function sonidoActivo($: EngineInterface) {
  const activo = (await $.store.get(CLAVE_SONIDO)) !== false
  if ((await read($, sonido)) !== activo) await update($, sonido, () => activo)
  return activo
}

// Switches the sounds on or off, for every session, and redraws the panel's switch.
async function ponSonido($: EngineInterface, activo: boolean) {
  await $.store.set(CLAVE_SONIDO, activo)
  await update($, sonido, () => activo)
}

// The victory fanfare when an agent ends well; the soft chime when it fails or is stopped.
async function suena($: EngineInterface, cual: 'victoria' | 'tintineo') {
  const ahora = await $.clock.now()
  if (ahora - ultimoSonido < 1500) return
  ultimoSonido = ahora
  try {
    if (!(await sonidoActivo($))) return
    if ((await $.env.get('OS')) === 'Windows_NT') {
      // $.audio.play has no player on Windows, so Windows' own one plays the mod's file. The path travels
      // in an environment variable, not inside the command, so no character of it can break the command
      // (PowerShell also takes the typographic apostrophe ’ as the end of a quoted string).
      const ruta = `${$.plugin.root}/assets/${cual}.wav`.split('/').join('\\')
      await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '(New-Object Media.SoundPlayer $env:EQUIPO_CLAWD_SONIDO).PlaySync()'], {
        env: { EQUIPO_CLAWD_SONIDO: ruta },
        timeoutMs: 8000,
      })
    } else {
      await $.audio.play({ asset: `assets/${cual}.wav` })
    }
  } catch {
    // A missing sound must never cost a turn.
  }
}

// Keeps what the engine measured for the foot. A measurement (session.measure) comes with its time: its usage windows
// replace the ones shown and are saved in $.store for the sessions to come. $.session.usage() has no time, and its
// windows may be hours old, so they only fill a foot that has none. With no usage windows, the foot keeps its own.
async function guardaConsumo(
  $: EngineInterface,
  medida: { context: SessionContextUsage; rateLimits: readonly SessionRateLimit[] },
  cuando?: number,
) {
  const ctx = medida.context
  const contexto = {
    ventana: ctx.window,
    ...(ctx.tokens !== undefined ? { tokens: ctx.tokens } : {}),
    ...(ctx.percent !== undefined ? { porcentaje: ctx.percent } : {}),
  }
  const limites = medida.rateLimits.map(l => ({ tipo: l.kind, porcentaje: l.percentUsed, ...(l.resetsAt ? { renueva: l.resetsAt } : {}) }))
  await update($, consumo, antes =>
    limites.length > 0 && cuando !== undefined
      ? { contexto, limites, leidos: cuando }
      : limites.length > 0 && antes.limites.length === 0
        ? { contexto, limites }
        : { ...antes, contexto },
  )
  if (limites.length === 0 || cuando === undefined) return
  try {
    await $.store.set(CLAVE_LIMITES, { leidos: cuando, limites })
  } catch {
    // Remembering them is a nicety.
  }
}

// The last usage windows a session of this computer saved. The engine only has them once Claude answers in this
// session, so until then the foot shows these, as remembered; newer ones, saved meanwhile by another session, win too.
async function recuerdaLimites($: EngineInterface) {
  const guardados = comoGuardados(await $.store.get(CLAVE_LIMITES))
  if (!guardados) return
  const antes = await read($, consumo)
  if (antes.limites.length > 0 && (antes.leidos === undefined || guardados.leidos <= antes.leidos)) return
  await update($, consumo, actual => ({ ...actual, limites: guardados.limites, leidos: guardados.leidos, recordados: true }))
}

// Asks the engine for its figures, for a panel that opens before the next measurement; recalls the saved usage
// windows if this session has none newer, and sets the clock for when they renew.
async function leeConsumo($: EngineInterface) {
  try {
    await guardaConsumo($, await $.session.usage())
  } catch {
    // The foot waits for the next measurement.
  }
  try {
    await recuerdaLimites($)
    await ajustaReloj($)
  } catch {
    // Remembering them is a nicety.
  }
}

// /equipo demo: four make-believe agents for about a minute, to see and capture the panel without spending tokens.
const DEMO: readonly { descripcion: string; tipo: string; modelo: string; esfuerzo: string; dura: number; final: Estado; tokens: number }[] = [
  { descripcion: 'Busca dónde se cargan los iconos', tipo: 'Explore', modelo: 'haiku', esfuerzo: 'low', dura: 25_000, final: 'terminado', tokens: 38_400 },
  { descripcion: 'Comprueba los enlaces de la guía', tipo: 'general-purpose', modelo: 'haiku', esfuerzo: 'low', dura: 38_000, final: 'fallo', tokens: 21_700 },
  { descripcion: 'Escribe el apartado 7 de la explicación', tipo: 'general-purpose', modelo: 'sonnet', esfuerzo: 'high', dura: 50_000, final: 'terminado', tokens: 96_300 },
  { descripcion: 'Verifica las cifras del experimento', tipo: 'Plan', modelo: 'opus', esfuerzo: 'max', dura: 62_000, final: 'terminado', tokens: 142_800 },
]

async function lanzaDemo($: EngineInterface) {
  const ahora = await $.clock.now()
  const ids = DEMO.map((_, i) => `demo-${ahora}-${i}`)
  await update($, agentes, lista => {
    let nueva = lista.filter(a => !a.demo)
    DEMO.forEach((d, i) => {
      const agente: Agente = {
        id: ids[i],
        toolUseId: '',
        descripcion: d.descripcion,
        tipo: d.tipo,
        modelo: d.modelo,
        esfuerzo: d.esfuerzo,
        profesion: eligeProfesion(nueva),
        inicio: ahora,
        estado: 'trabajando',
        tokens: 0,
        enFondo: true,
        demo: { dura: d.dura, final: d.final, tokens: d.tokens },
      }
      nueva = [...nueva, agente]
    })
    return nueva
  })
  await ajustaReloj($)
  await $.ui.open({ id: PANEL, title: TITULO })
  DEMO.forEach((d, i) => $.clock.after(d.dura, () => void terminaDemo($, ids[i], d.final)))
}

async function terminaDemo($: EngineInterface, id: string, estado: Estado) {
  const antes = (await read($, agentes)).find(a => a.id === id)
  if (!antes || antes.estado !== 'trabajando' || !antes.demo) return
  const fin = await $.clock.now()
  const tokens = estado === 'terminado' ? antes.demo.tokens : Math.round((antes.demo.tokens * Math.min(1, (fin - antes.inicio) / antes.demo.dura)) / 100) * 100
  await update($, agentes, lista => lista.map(a => (a.id === id ? { ...a, estado, fin, tokens } : a)))
  const quien = nombreDe(antes.profesion)
  $.ui.toast(
    estado === 'terminado'
      ? `${quien} ha terminado: ${antes.descripcion} (demo)`
      : estado === 'fallo'
        ? `${quien} ha fallado: ${antes.descripcion} (demo)`
        : `${quien} se ha parado: ${antes.descripcion} (demo)`,
  )
  void suena($, estado === 'terminado' ? 'victoria' : 'tintineo')
  await ajustaReloj($)
}

// Opens the panel with fresh figures, as /equipo does: the sound switch as stored and the engine's usage. With focus,
// the surface may raise a panel that was open behind another one.
async function abrePanel($: EngineInterface, focus?: true) {
  await sonidoActivo($)
  await leeConsumo($)
  await $.ui.open({ id: PANEL, title: TITULO, ...(focus ? { focus } : {}) })
}

// The «Clawds» button under the prompt: it closes the panel while it is the one shown, and otherwise opens it.
async function alternaPanel($: EngineInterface) {
  const panel = (await $.ui.panes()).find(p => p.id === PANEL)
  if (panel?.isShown) await $.ui.close({ id: PANEL })
  else await abrePanel($, panel ? true : undefined)
}

async function parar($: EngineInterface, id: string) {
  try {
    const r = (await $.tool.call({ tool: 'TaskStop', task_id: id })) as { deny?: string; isError?: boolean; text?: string }
    if (r.deny) $.ui.toast(`No se ha podido parar: ${r.deny}`)
    else if (r.isError) $.ui.toast(`No se ha podido parar: ${(r.text ?? '').slice(0, 160)}`)
  } catch (error) {
    $.ui.toast(`No se ha podido parar: ${String(error).slice(0, 160)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      await $.command.register({
        name: 'equipo',
        description:
          'Abre el panel Equipo, con los agentes de esta sesión; con «demo», cuatro agentes de mentira durante un minuto; con «sonido», activa o desactiva los sonidos (o «sonido sí», «sonido no»)',
        argumentHint: '[demo | sonido [sí|no]]',
      })
      await sonidoActivo($)
      // A session that starts, or a reload, has no turn of the main conversation running.
      await update($, cache, c => ({ ...c, enUso: false }))
      await leeConsumo($)
      // A reload drops the demo's timers: end the make-believe agents whose time has passed.
      const ahora = await $.clock.now()
      for (const a of await read($, agentes)) {
        if (a.demo && a.estado === 'trabajando' && ahora - a.inicio >= a.demo.dura) await terminaDemo($, a.id, a.demo.final)
      }
      await ajustaReloj($)
    } catch {
      // The panel is decoration: never stand in the session's way.
    }
    return r
  })

  on('command.run', { command: 'equipo' }, async ($, e) => {
    const palabras = e.args.toLowerCase().split(/\s+/).filter(Boolean)
    if (palabras.includes('demo')) {
      await lanzaDemo($)
      return { text: 'Demo del panel Equipo: cuatro agentes de mentira durante un minuto, sin gastar tokens.' }
    }
    if (palabras.includes('sonido')) {
      const activo = palabras.some(p => ['no', 'off', 'desactivar', 'desactiva'].includes(p))
        ? false
        : palabras.some(p => ['sí', 'si', 'on', 'activar', 'activa'].includes(p))
          ? true
          : !(await sonidoActivo($))
      await ponSonido($, activo)
      return { text: activo ? 'Sonidos del panel Equipo activados, en todas las sesiones.' : 'Sonidos del panel Equipo desactivados, en todas las sesiones.' }
    }
    await abrePanel($)
    return { text: 'Panel Equipo abierto.' }
  })

  // The engine measures after each turn of the main conversation and when a usage window moves a whole point.
  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    try {
      await guardaConsumo($, e, await $.clock.now())
      await ajustaReloj($)
    } catch {
      // The foot is a nicety.
    }
    return r
  })

  // While a turn of the main conversation runs, its requests keep the cache warm: the foot says it is in use.
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      try {
        await update($, cache, c => ({ ...c, enUso: true }))
        await ajustaReloj($)
      } catch {
        // The foot is a nicety.
      }
    }
    return r
  })

  // A workflow's agents carry the Workflow call's id: keep its name from the script's meta.
  on('tool.call', ($, e, next) => {
    if (String(e.tool) === 'Workflow') {
      const entrada = e as unknown as { tool_use_id: string; script?: string; name?: string; scriptPath?: string }
      const nombre =
        entrada.script?.match(/\bname\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ??
        entrada.name ??
        entrada.scriptPath?.split(/[\\/]/).pop()?.replace(/\.[cm]?[jt]s$/, '')
      if (nombre) nombresWorkflow.set(entrada.tool_use_id, nombre)
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || !r.agentId) return r
    const id = r.agentId
    try {
      const ahora = await $.clock.now()
      if (e.resume) {
        await update($, agentes, lista =>
          lista.map(a => {
            if (a.id !== id) return a
            const { fin: _fin, ...resto } = a
            return { ...resto, estado: 'trabajando' as const }
          }),
        )
      } else {
        await update($, agentes, lista => {
          const nuevo: Agente = {
            id,
            toolUseId: e.tool_use_id,
            descripcion: e.description || e.subagentType,
            tipo: e.subagentType,
            modelo: modeloCorto(r.model),
            profesion: eligeProfesion(lista),
            inicio: ahora,
            estado: 'trabajando',
            tokens: 0,
            enFondo: e.background,
            ...(e.workflow
              ? { workflow: { runId: e.workflow.runId, indice: e.workflow.agentIndex, ...(nombresWorkflow.has(e.tool_use_id) ? { nombre: nombresWorkflow.get(e.tool_use_id) } : {}) } }
              : {}),
          }
          return [...lista.filter(a => a.id !== id), nuevo].slice(-80)
        })
      }
      await ajustaReloj($)
      void $.ui.open({ id: PANEL, title: TITULO })
    } catch {
      // Never hold an agent back for the panel's sake.
    }
    return r
  })

  // Each model request: an agent's model, effort and tokens so far; on the main conversation, when its cache was renewed.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    const salida = id ? 0 : await $.clock.now()
    const res = yield* next(e)
    try {
      if (!id) {
        // A request that got an answer renewed the cache: its hour counts from when the request went out.
        if (res.usage) await update($, cache, c => ({ ...c, ultimaPeticion: salida }))
      } else {
        const tokens = tokensDe(res.usage)
        await update($, agentes, lista =>
          lista.some(a => a.id === id && a.estado === 'trabajando')
            ? lista.map(a =>
                a.id === id
                  ? { ...a, modelo: modeloCorto(e.model), ...(e.effort !== undefined ? { esfuerzo: String(e.effort) } : {}), ...(tokens > 0 ? { tokens } : {}) }
                  : a,
              )
            : lista,
        )
      }
    } catch {
      // Counting tokens and minutes is a nicety.
    }
    return res
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    const id = e.agentId
    if (!id) {
      // The main conversation's turn is over: the cache's hour starts to count down.
      try {
        await update($, cache, c => ({ ...c, enUso: false }))
        await ajustaReloj($)
      } catch {
        // The foot is a nicety.
      }
      return res
    }
    try {
      const antes = (await read($, agentes)).find(a => a.id === id)
      if (!antes || antes.estado !== 'trabajando') return res
      const estado: Estado = e.reason === 'answer' ? 'terminado' : e.reason === 'aborted' ? 'parado' : 'fallo'
      const fin = await $.clock.now()
      await update($, agentes, lista => lista.map(a => (a.id === id ? { ...a, estado, fin } : a)))
      const quien = nombreDe(antes.profesion)
      $.ui.toast(
        estado === 'terminado'
          ? `${quien} ha terminado: ${antes.descripcion}`
          : estado === 'fallo'
            ? `${quien} ha fallado: ${antes.descripcion}`
            : `${quien} se ha parado: ${antes.descripcion}`,
      )
      void suena($, estado === 'terminado' ? 'victoria' : 'tintineo')
      await ajustaReloj($)
    } catch {
      // The toast and the sound are extras.
    }
    return res
  })

  // A small «Clawds» button in the line of mode labels under the prompt, beside the model's name, after the engine's own
  // labels. A mod cannot draw in the desktop app's title bar, and this is the nearest place it can. The desktop app draws
  // every button here alike, grey on a dark chip whose fixed height cuts the letters that drop below the line (g, j, p, q,
  // y): it ignored a label Text's color and size, dimColor and the primary variant, and «Equipo» lost the foot of its q and
  // p. So the label has none of those letters. The terminal keeps its line: there /equipo is at hand.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const propio = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" gap="sm">
        {propio}
        <Button key="equipo" label="Clawds" onPress={() => void alternaPanel($)} />
      </Box>
    )
  })

  // The same Clawd beside the chat row where the agent was launched.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== 'Agent') return next(e)
    const tabla = $.ui.resolve(e)
    if (e.surface === 'terminal' || !('Svg' in tabla)) return next(e)
    const a = (await read($, agentes)).find(x => x.toolUseId === e.props.tool_use_id)
    if (!a) return next(e)
    const propio = await next(e)
    const { Box, Svg } = tabla
    return (
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Svg source={dibujo(a)} alt={nombreDe(a.profesion)} width={LADO_CHAT} height={LADO_CHAT} isInteractive={a.estado === 'trabajando' ? true : undefined} />
        <Box flexGrow={1} flexShrink={1}>
          {propio}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const tabla = $.ui.resolve(e)
    const { Box, Text, Button } = tabla
    // The terminal's table answers for Svg too, but draws nothing of it: there the marks and bars are characters.
    const Svg = e.surface !== 'terminal' && 'Svg' in tabla ? tabla.Svg : undefined
    const lista = await read($, agentes)
    await read($, tic)
    const conSonido = await read($, sonido)
    const uso = await read($, consumo)
    const estadoCache = await read($, cache)
    const ahora = await $.clock.now()

    // The switch shows what is in force, and a press asks for the other way round from what it shows.
    const controles = (limpiar: boolean) => (
      <Box flexDirection="row" flexWrap="wrap" justifyContent="flex-end" alignItems="center" gap="sm">
        {limpiar ?<Button key="limpiar" label="Limpiar terminados" onPress={() => void update($, agentes, l => l.filter(a => a.estado === 'trabajando'))} /> : null}
        <Button key="sonido" label={conSonido ? '🔊 Sonido: sí' : '🔇 Sonido: no'} onPress={() => void ponSonido($, !conSonido)} />
      </Box>
    )

    // One row of the foot: its pixel icon, its name, its bar with the figure beside it, and a note beneath the bar.
    // Where SVG is not drawn, as on the terminal, the bar is made of block characters. In a narrow panel the bar gives
    // way, never the figure, and the note goes on to a second line.
    const filaPie = (f: FilaPie) => {
      const n = llenas(f.p)
      return (
        <Box key={`pie-${f.clave}`} flexDirection="row" alignItems="flex-start" gap="sm">
          {Svg ? <Svg source={svgIcono(f.icono, f.apagado === true)} alt={f.etiqueta} width={16} height={16} /> : null}
          <Box width={9}>
            <Text dimColor size="caption">
              {f.etiqueta}
            </Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
            <Box flexDirection="row" alignItems="center" gap="sm">
              <Box flexShrink={1} minWidth={0} overflow="hidden">
                {Svg ? (
                  <Svg source={svgBarra(f.p)} alt={`${f.etiqueta}: ${f.cifra}`} />
                ) : (
                  <Box flexDirection="row">
                    {n > 0 ? <Text color={semaforo(f.p)}>{'█'.repeat(n)}</Text> : null}
                    {n < 20 ? <Text dimColor>{'░'.repeat(20 - n)}</Text> : null}
                  </Box>
                )}
              </Box>
              <Box flexShrink={0}>
                <Text size="caption" weight="medium" tabular dimColor={f.apagado === true} color={!f.apagado && f.p >= 80 ? '#E24B4A' : undefined}>
                  {f.cifra}
                </Text>
              </Box>
            </Box>
            {f.nota ? (
              <Text dimColor size="caption">
                {f.nota}
              </Text>
            ) : null}
          </Box>
        </Box>
      )
    }
    const filas = filasPie(uso, estadoCache, ahora)
    // Usage windows remembered from $.store, which this session has not read yet: the foot says when they are from.
    const recordados =
      uso.recordados === true && uso.leidos !== undefined && uso.limites.length > 0
        ? `Últimos límites conocidos, ${momento(uso.leidos, ahora)}. Se ponen al día con la próxima respuesta de Claude.`
        : undefined
    const pie =
      filas.length > 0 ? (
        <Box flexDirection="column" gap="xs" borderStyle="round" paddingX={1}>
          {filas.map(filaPie)}
          {recordados ? (
            <Text dimColor size="caption">
              {recordados}
            </Text>
          ) : null}
        </Box>
      ) : (
        <Text dimColor size="caption">
          El consumo aparece con la primera respuesta de Claude.
        </Text>
      )

    if (lista.length === 0) {
      return (
        <Box flexDirection="column" gap="sm">
          {controles(false)}
          <Text dimColor>Aún no hay agentes en esta sesión. Cuando arranque uno, aparecerá aquí.</Text>
          {pie}
        </Box>
      )
    }

    const trabajando = lista.filter(a => a.estado === 'trabajando').length
    const terminados = lista.filter(a => a.estado === 'terminado').length
    const otros = lista.length - trabajando - terminados
    const resumen = [`${trabajando} trabajando`, `${terminados} terminados`, ...(otros > 0 ? [`${otros} parados o con error`] : [])].join(' · ')

    // The first line of an agent or of a workflow: its name, its time and, once there are any, its tokens. Each is a
    // Text of its own in a row that never wraps (one Text holding coloured parts wraps like a paragraph on the desktop):
    // when room runs short the tokens are cut first, then the name, and the time never. The time's figures are all of
    // one width, so the line does not shake as the seconds pass. The gap before the time is twice the others.
    const primeraLinea = (nombre: string, tiempo: string, color: string | undefined, tenue: boolean, tokens: number) => (
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Box flexShrink={1} minWidth={0} overflow="hidden">
          <Text weight="medium" wrap="truncate-end">
            {nombre}
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft="sm">
          <Text color={color} dimColor={tenue} tabular>
            {tiempo}
          </Text>
        </Box>
        {tokens > 0 ? (
          <Box flexShrink={0}>
            <Text dimColor>·</Text>
          </Box>
        ) : null}
        {tokens > 0 ? (
          <Box flexShrink={1000} minWidth={0} overflow="hidden">
            <Text dimColor tabular wrap="truncate-end">
              {compacto(tokens)}
            </Text>
          </Box>
        ) : null}
      </Box>
    )

    // One agent: its Clawd; its first line; then its task; then its type, model and effort. On the right there is only
    // a small stop button, while it works. Nothing else asks for width, so the panel can be as narrow as wanted, and each
    // line is cut at its end. The Clawd's pose and the time's colour tell the state; on the terminal, which draws no SVG,
    // the mark in the Clawd's place does.
    const fila = (a: Agente) => {
      const tokens = tokensVistos(a, ahora)
      return (
        <Box key={`fila-${a.id}`} flexDirection="row" alignItems="center" gap="sm">
          {Svg ? (
            <Svg source={dibujo(a)} alt={nombreDe(a.profesion)} width={LADO_PANEL} height={LADO_PANEL} isInteractive={true} />
          ) : (
            <Text color={COLOR[a.estado]}>{MARCA[a.estado]}</Text>
          )}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
            {primeraLinea(nombreDe(a.profesion), cronometro((a.fin ?? ahora) - a.inicio), COLOR[a.estado], false, tokens)}
            <Text dimColor wrap="truncate-end">
              {a.descripcion}
            </Text>
            <Text dimColor size="caption" wrap="truncate-end">
              {[a.tipo, a.modelo, a.esfuerzo].filter(Boolean).join(' · ')}
            </Text>
          </Box>
          {a.estado === 'trabajando' && !a.workflow ? (
            <Button key={`parar-${a.id}`} label="STOP" onPress={() => void (a.demo ? terminaDemo($, a.id, 'parado') : parar($, a.id))} />
          ) : null}
        </Box>
      )
    }

    const sueltos = lista.filter(a => !a.workflow)
    const orden = (x: Agente, y: Agente) =>
      x.estado === 'trabajando' && y.estado !== 'trabajando' ? -1 : y.estado === 'trabajando' && x.estado !== 'trabajando' ? 1 : (y.fin ?? y.inicio) - (x.fin ?? x.inicio)

    const grupos = new Map<string, Agente[]>()
    for (const a of lista) {
      if (a.workflow) grupos.set(a.workflow.runId, [...(grupos.get(a.workflow.runId) ?? []), a])
    }

    const grupo = (runId: string, miembros: Agente[]) => {
      const nombre = miembros.find(m => m.workflow?.nombre)?.workflow?.nombre ?? 'Workflow'
      const activos = miembros.filter(m => m.estado === 'trabajando').length
      const inicio = Math.min(...miembros.map(m => m.inicio))
      const fin = activos > 0 ? ahora : Math.max(...miembros.map(m => m.fin ?? ahora))
      const tokens = miembros.reduce((s, m) => s + m.tokens, 0)
      const ordenados = [...miembros].sort((x, y) => (x.workflow?.indice ?? 0) - (y.workflow?.indice ?? 0))
      return (
        <Box key={`wf-${runId}`} flexDirection="column" gap="xs" borderStyle="round" paddingX={1}>
          {primeraLinea(nombre, cronometro(fin - inicio), activos > 0 ? COLOR.trabajando : undefined, activos === 0, tokens)}
          <Text dimColor size="caption">
            {`${activos} trabajando · ${miembros.length - activos} terminados`}
          </Text>
          {ordenados.map(fila)}
          {activos > 0 ? <Button key={`parar-wf-${runId}`} label="STOP workflow" onPress={() => void parar($, runId)} /> : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap="sm">
        {controles(trabajando < lista.length)}
        <Text dimColor>{resumen}</Text>
        {[...sueltos].sort(orden).slice(0, 30).map(fila)}
        {[...grupos.entries()].map(([runId, miembros]) => grupo(runId, miembros))}
        {pie}
      </Box>
    )
  })
}
