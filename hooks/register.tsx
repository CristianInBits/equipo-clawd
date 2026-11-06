// Panel "Equipo": each agent of the session as a Clawd dressed in a random profession,
// with its task, type, model, effort, tokens and time; a toast and a short chime when it ends.
// At its foot, the usage limits, the context window and how long the prompt cache stays warm.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Agente, Cache, Consumo, Estado } from '../types'
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
const consumo = atom({ plugin: 'equipo-clawd', key: 'consumo' } as const, { limites: [] }, { shape: 'consumo-1' })
const cache = atom({ plugin: 'equipo-clawd', key: 'cache' } as const, { enUso: false }, { shape: 'cache-1' })
// On a subscription the main conversation's prompt cache lives an hour after each request (five minutes only
// in extra usage, past the plan's limits). Nothing the mod receives says which, so it counts an hour.
const CADUCIDAD_CACHE = 60 * 60 * 1000

const MARCA: Record<Estado, string> = { trabajando: '●', terminado: '✓', fallo: '✗', parado: '■' }
const COLOR: Record<Estado, string> = { trabajando: '#D97757', terminado: '#639922', fallo: '#E24B4A', parado: '#888780' }
const NOMBRES = new Map(PROFESIONES.map(p => [p.id, p.nombre]))

const nombreDe = (id: string) => NOMBRES.get(id) ?? 'Clawd'

const modeloCorto = (modelo: string) =>
  /opus/i.test(modelo) ? 'opus' : /sonnet/i.test(modelo) ? 'sonnet' : /haiku/i.test(modelo) ? 'haiku' : /fable/i.test(modelo) ? 'fable' : modelo

const duracion = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

const miles = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} k` : String(n)

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

const svgBarra = (p: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 138 8" shape-rendering="crispEdges">${Array.from({ length: 20 }, (_, i) =>
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

// When a window renews, in the computer's own time: «a las 19:50», «mañana a la 1:05», «el lunes a las 6:00».
const renovacion = (iso: string, ahora: number) => {
  const cuando = new Date(iso)
  if (Number.isNaN(cuando.getTime())) return ''
  const hoy = new Date(ahora)
  const dias = Math.round(
    (new Date(cuando.getFullYear(), cuando.getMonth(), cuando.getDate()).getTime() - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime()) /
      86_400_000,
  )
  const hora = `${cuando.getHours() === 1 ? 'a la' : 'a las'} ${cuando.getHours()}:${String(cuando.getMinutes()).padStart(2, '0')}`
  if (dias <= 0) return `se renueva ${hora}`
  if (dias === 1) return `se renueva mañana ${hora}`
  if (dias < 7) return `se renueva el ${DIAS[cuando.getDay()]} ${hora}`
  return `se renueva el ${cuando.getDate()}/${cuando.getMonth() + 1} ${hora}`
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
const filasPie = (uso: Consumo, c: Cache, ahora: number): FilaPie[] => {
  const limites = [...uso.limites]
    .sort((x, y) => (VENTANAS[x.tipo]?.orden ?? 9) - (VENTANAS[y.tipo]?.orden ?? 9))
    .map(l => ({
      clave: l.tipo,
      icono: VENTANAS[l.tipo]?.icono ?? ('reloj' as const),
      etiqueta: VENTANAS[l.tipo]?.etiqueta ?? l.tipo.replace(/_/g, ' '),
      p: l.porcentaje,
      cifra: enPorcentaje(l.porcentaje),
      nota: l.renueva ? renovacion(l.renueva, ahora) : '',
    }))
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
let ultimoSonido = 0
const nombresWorkflow = new Map<string, string>()

// The panel's clock: every second while an agent works, every 15 seconds while only the cache counts down,
// and stopped when there is nothing left to count.
async function ajustaReloj($: EngineInterface) {
  const trabajan = (await read($, agentes)).some(a => a.estado === 'trabajando')
  const c = await read($, cache)
  const caliente = !c.enUso && c.ultimaPeticion !== undefined && (await $.clock.now()) - c.ultimaPeticion < CADUCIDAD_CACHE
  const cada = trabajan ? 1000 : caliente ? 15_000 : 0
  if ((reloj?.cada ?? 0) === cada) return
  reloj?.cancel()
  reloj = undefined
  if (cada > 0) {
    const r = $.clock.every(cada, () => void latido($))
    reloj = { cancel: () => r.cancel(), cada }
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

// Keeps what the engine measured for the foot. A measurement with no usage windows keeps the last ones read.
async function guardaConsumo($: EngineInterface, medida: { context: SessionContextUsage; rateLimits: readonly SessionRateLimit[] }) {
  const ctx = medida.context
  await update($, consumo, antes => ({
    contexto: {
      ventana: ctx.window,
      ...(ctx.tokens !== undefined ? { tokens: ctx.tokens } : {}),
      ...(ctx.percent !== undefined ? { porcentaje: ctx.percent } : {}),
    },
    limites:
      medida.rateLimits.length > 0
        ? medida.rateLimits.map(l => ({ tipo: l.kind, porcentaje: l.percentUsed, ...(l.resetsAt ? { renueva: l.resetsAt } : {}) }))
        : antes.limites,
  }))
}

// Asks the engine for its figures, for a panel that opens before the next measurement.
async function leeConsumo($: EngineInterface) {
  try {
    await guardaConsumo($, await $.session.usage())
  } catch {
    // The foot waits for the next measurement.
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
    await sonidoActivo($)
    await leeConsumo($)
    await $.ui.open({ id: PANEL, title: TITULO })
    return { text: 'Panel Equipo abierto.' }
  })

  // The engine measures after each turn of the main conversation and when a usage window moves a whole point.
  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    try {
      await guardaConsumo($, e)
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
      <Box flexDirection="row" justifyContent="flex-end" alignItems="center" gap="sm">
        {limpiar ? <Button key="limpiar" label="Limpiar terminados" onPress={() => void update($, agentes, l => l.filter(a => a.estado === 'trabajando'))} /> : null}
        <Button key="sonido" label={conSonido ? '🔊 Sonido: sí' : '🔇 Sonido: no'} onPress={() => void ponSonido($, !conSonido)} />
      </Box>
    )

    // One row of the foot: its pixel icon, its name, its bar with the figure beside it, and a note beneath the bar.
    // Where SVG is not drawn, as on the terminal, the bar is made of block characters.
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
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexDirection="row" alignItems="center" gap="sm">
              {Svg ? (
                <Svg source={svgBarra(f.p)} alt={`${f.etiqueta}: ${f.cifra}`} width={138} height={8} />
              ) : (
                <Box flexDirection="row">
                  {n > 0 ? <Text color={semaforo(f.p)}>{'█'.repeat(n)}</Text> : null}
                  {n < 20 ? <Text dimColor>{'░'.repeat(20 - n)}</Text> : null}
                </Box>
              )}
              <Text size="caption" weight="medium" tabular dimColor={f.apagado === true} color={!f.apagado && f.p >= 80 ? '#E24B4A' : undefined}>
                {f.cifra}
              </Text>
            </Box>
            {f.nota ? (
              <Text dimColor size="caption" wrap="truncate-end">
                {f.nota}
              </Text>
            ) : null}
          </Box>
        </Box>
      )
    }
    const filas = filasPie(uso, estadoCache, ahora)
    const pie =
      filas.length > 0 ? (
        <Box flexDirection="column" gap="xs" borderStyle="round" paddingX={1}>
          {filas.map(filaPie)}
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

    const fila = (a: Agente) => (
      <Box key={`fila-${a.id}`} flexDirection="row" alignItems="center" gap="sm">
        {Svg ? (
          <Svg source={dibujo(a)} alt={nombreDe(a.profesion)} width={LADO_PANEL} height={LADO_PANEL} isInteractive={true} />
        ) : (
          <Text color={COLOR[a.estado]}>{MARCA[a.estado]}</Text>
        )}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text weight="medium" wrap="truncate-end">
            {nombreDe(a.profesion)}
          </Text>
          <Text dimColor wrap="truncate-end">
            {a.descripcion}
          </Text>
          <Text dimColor size="caption" wrap="truncate-end">
            {[a.tipo, a.modelo, a.esfuerzo].filter(Boolean).join(' · ')}
          </Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text color={COLOR[a.estado]}>
            {MARCA[a.estado]} {duracion((a.fin ?? ahora) - a.inicio)}
          </Text>
          <Text dimColor size="caption">
            {tokensVistos(a, ahora) > 0 ? `${miles(tokensVistos(a, ahora))} tokens` : 'sin tokens aún'}
          </Text>
          {a.estado === 'trabajando' && !a.workflow ? (
            <Button key={`parar-${a.id}`} label="Parar" onPress={() => void (a.demo ? terminaDemo($, a.id, 'parado') : parar($, a.id))} />
          ) : null}
        </Box>
      </Box>
    )

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
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
            <Text weight="medium" wrap="truncate-end">
              {nombre}
            </Text>
            <Text dimColor>{duracion(fin - inicio)}</Text>
          </Box>
          <Text dimColor size="caption">
            {`${activos} trabajando · ${miembros.length - activos} terminados · ${miles(tokens)} tokens`}
          </Text>
          {ordenados.map(fila)}
          {activos > 0 ? <Button key={`parar-wf-${runId}`} label="Parar workflow" onPress={() => void parar($, runId)} /> : null}
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
