import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { PROFESIONES } from './clawds'

const PANEL = {
  plugin: 'equipo-clawd',
  component: 'Pane',
  requestId: 'equipo',
  props: {
    title: 'Equipo',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const NOMBRES = new RegExp(`^(${PROFESIONES.map(p => p.nombre).join('|')})$`)

test('un agente que arranca sale en el panel con un Clawd y una profesión', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { OS: 'Linux' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))

  await $.agent.spawn({ prompt: 'Busca', description: 'Busca dónde se cargan los iconos', subagentType: 'Explore' })

  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Busca dónde se cargan/ }))?.text).toBe('Busca dónde se cargan los iconos')
  expect((await ui.find({ type: 'Text', text: NOMBRES })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /Explore · haiku/ }))?.text).toBe('Explore · haiku')
  expect((await ui.find({ type: 'Svg' }))?.props.width).toBe(72)
  // Beside the name, the time in the colour of the state, and no tokens until the agent's first request. On the right,
  // only a small stop button: no icon but the Clawd.
  expect((await ui.find({ type: 'Text', text: /^0:00$/ }))?.props.color).toBe('#D97757')
  expect((await ui.find({ type: 'Text', text: /^ · / })) === undefined).toBe(true)
  expect((await ui.find({ key: 'parar-a1' }))?.props.label).toBe('STOP')
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(1)
  await ui.unmount()

  // The terminal draws no SVG: there the Clawd's place holds the agent's mark, and the time goes without an icon.
  const terminal = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect((await terminal.find({ type: 'Text', text: /Busca dónde se cargan/ })) !== undefined).toBe(true)
  expect((await terminal.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('#D97757')
  expect((await terminal.find({ type: 'Text', text: /^0:00$/ }))?.props.color).toBe('#D97757')
  await terminal.unmount()
})

test('al terminar, la fila pasa a terminado', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { OS: 'Linux' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('audio.play', () => ({ value: undefined }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a2' }))
  on('turn.complete', () => ({ text: 'hecho' }))

  await $.agent.spawn({ prompt: 'Escribe', description: 'Escribe el script', subagentType: 'general-purpose' })
  await $.turn.complete({ answer: 'hecho', durationMs: 5000, isAborted: false, turnId: 't2', agentId: 'a2', reason: 'answer' })

  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  // The time takes the green of a finished agent, and the stop button goes.
  expect((await ui.find({ type: 'Text', text: /^0:00$/ }))?.props.color).toBe('#639922')
  expect((await ui.find({ key: 'parar-a2' })) === undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /0 trabajando · 1 terminados/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('la demo llena el panel con cuatro agentes y terminan solos', async ($, on) => {
  const reloj = mock.clock(on, { now: 5_000_000 })
  mock.env(on, { OS: 'Linux' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('audio.play', () => ({ value: undefined }))

  await $.command.run({ command: 'equipo', args: 'demo' })

  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^4 trabajando · 0 terminados$/ })) !== undefined).toBe(true)
  await reloj.advance(70_000)
  expect((await ui.find({ type: 'Text', text: /^0 trabajando · 3 terminados · 1 parados o con error$/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^ · 142,8k$/ })) !== undefined).toBe(true)
  // The longest demo agent ran 62 seconds.
  expect((await ui.find({ type: 'Text', text: /^1:02$/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('el tiempo de un agente se lee como un cronómetro, también pasada la hora, y sus tokens en corto', async ($, on) => {
  const reloj = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { OS: 'Linux' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'h1' }))
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'tool_use',
      usage: { input_tokens: 4_000, output_tokens: 600, cache_read_input_tokens: 350_000, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' },
    }
  })

  await $.agent.spawn({ prompt: 'Revisa', description: 'Revisa todo el capítulo', subagentType: 'general-purpose' })
  // An hour, three minutes and twelve seconds later, its last request carried 354,600 tokens.
  await reloj.advance(3_792_000)
  for await (const _trozo of $.turn.step({ turnId: 'h1-t', index: 0, model: 'claude-haiku-5-5', messageCount: 3, agentId: 'h1' })) {
    // The test's own answer streams nothing.
  }

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    expect((await ui.find({ type: 'Text', text: /^1:03:12$/ }))?.props.color).toBe('#D97757')
    expect((await ui.find({ type: 'Text', text: /^ · 354,6k$/ })) !== undefined).toBe(true)
    await ui.unmount()
  }
})

// A store in memory, as the engine keeps the plugin's own, that the test can read back.
const almacen = (on: On, inicial: Record<string, unknown> = {}) => {
  const guardado = new Map(Object.entries(inicial))
  on('store.get', (_$, e) => ({ value: guardado.get(e.key) }))
  on('store.set', (_$, e) => {
    guardado.set(e.key, e.value)
    return { value: undefined }
  })
  return guardado
}

test('el botón de sonido lo apaga y lo enciende, y lo guarda para las demás sesiones', async ($, on) => {
  const reloj = mock.clock(on, { now: 9_000_000 })
  mock.env(on, { OS: 'Linux' })
  const guardado = almacen(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  let sonidos = 0
  on('audio.play', () => {
    sonidos += 1
    return { value: undefined }
  })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `s${++n}` }))
  on('turn.complete', () => ({ text: 'hecho' }))
  const termina = async (agentId: string) => {
    await $.turn.complete({ answer: 'hecho', durationMs: 5000, isAborted: false, turnId: `t-${agentId}`, agentId, reason: 'answer' })
    await reloj.advance(2000)
  }

  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await ui.find({ key: 'sonido' }))?.props.label).toBe('🔊 Sonido: sí')
  await $.agent.spawn({ prompt: 'Uno', description: 'Primer encargo', subagentType: 'Explore' })
  await termina('s1')
  expect(sonidos).toBe(1)

  await ui.press({ key: 'sonido' })
  expect((await ui.find({ key: 'sonido' }))?.props.label).toBe('🔇 Sonido: no')
  expect(guardado.get('sonido')).toBe(false)
  await $.agent.spawn({ prompt: 'Dos', description: 'Segundo encargo', subagentType: 'Explore' })
  await termina('s2')
  expect(sonidos).toBe(1)

  await ui.press({ key: 'sonido' })
  expect((await ui.find({ key: 'sonido' }))?.props.label).toBe('🔊 Sonido: sí')
  expect(guardado.get('sonido')).toBe(true)
  await ui.unmount()
})

test('la orden /equipo sonido lo apaga, lo enciende o le da la vuelta a lo guardado', async ($, on) => {
  const guardado = almacen(on, { sonido: false })
  const orden = async (args: string) => (await $.command.run({ command: 'equipo', args })).text ?? ''

  expect(await orden('sonido')).toMatch(/activados/)
  expect(guardado.get('sonido')).toBe(true)
  expect(await orden('sonido no')).toMatch(/desactivados/)
  expect(guardado.get('sonido')).toBe(false)
  expect(await orden('Sonido Sí')).toMatch(/activados/)
  expect(guardado.get('sonido')).toBe(true)
})

test('en Windows, la ruta del sonido va en una variable de entorno y no dentro de la orden', async ($, on) => {
  const reloj = mock.clock(on, { now: 20_000_000 })
  mock.env(on, { OS: 'Windows_NT' })
  almacen(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  const llamadas: { argv: readonly string[]; init?: { env?: Record<string, string> } }[] = []
  on('process.run', (_$, e) => {
    llamadas.push(e)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'w1' }))
  on('turn.complete', () => ({ text: 'hecho' }))

  await $.agent.spawn({ prompt: 'Escribe', description: 'Escribe el script', subagentType: 'general-purpose' })
  await $.turn.complete({ answer: 'hecho', durationMs: 5000, isAborted: false, turnId: 'tw1', agentId: 'w1', reason: 'answer' })
  await reloj.settle()

  expect(llamadas).toHaveLength(1)
  expect(llamadas[0].argv[0]).toBe('powershell.exe')
  expect(llamadas[0].argv[4]).toBe('(New-Object Media.SoundPlayer $env:EQUIPO_CLAWD_SONIDO).PlaySync()')
  expect(llamadas[0].init?.env?.EQUIPO_CLAWD_SONIDO ?? '').toMatch(/\\assets\\victoria\.wav$/)
})

test('sin agentes, el panel lo dice, y el pie espera a la primera respuesta', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Aún no hay agentes/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /El consumo aparece con la primera respuesta de Claude/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('el pie enseña los límites de uso y el contexto, con los colores del semáforo', async ($, on) => {
  // The figures of the first measurement seen in the desktop app, on Friday 6 November 2026 at 17:40, in the computer's own time.
  mock.clock(on, { now: new Date(2026, 10, 6, 17, 40).getTime() })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { tokens: 217_608, window: 1_000_000, percent: 22 },
    rateLimits: [
      { kind: 'seven_day', percentUsed: 74, resetsAt: new Date(2026, 10, 9, 6, 0).toISOString() },
      { kind: 'five_hour', percentUsed: 9, resetsAt: new Date(2026, 10, 6, 19, 50).toISOString() },
    ],
    cost: { usd: 3.34 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    expect((await ui.find({ type: 'Text', text: /^9 %$/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^se renueva a las 19:50$/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^se renueva el lunes a las 6:00$/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^218 k de 1 M tokens$/ })) !== undefined).toBe(true)
    await ui.unmount()
  }

  // The 5-hour window in green and the week in amber; on the terminal, the bars are blocks in the same colours.
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const barras = (await ui.findAll({ type: 'Svg' })).filter(s => String(s.props.alt).includes(': '))
  expect(barras.map(s => s.props.alt)).toEqual(['5 horas: 9 %', 'Semana: 74 %', 'Contexto: 22 %'])
  expect(String(barras[0].props.source)).toMatch(/#639922/)
  expect(String(barras[1].props.source)).toMatch(/#EF9F27/)
  await ui.unmount()
  const terminal = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect((await terminal.findAll({ type: 'Svg' })).length).toBe(0)
  expect((await terminal.find({ type: 'Text', text: /^█{15}$/ }))?.props.color).toBe('#EF9F27')
  await terminal.unmount()
})

test('al arrancar, el pie enseña los últimos límites guardados, con su hora, hasta que Claude responde', async ($, on) => {
  // Saturday 7 November 2026 at 9:30, in the computer's own time. The last limits were read last night at 23:10:
  // the 5-hour window has renewed since, at 2:00, and the week's renews on Monday.
  mock.clock(on, { now: new Date(2026, 10, 7, 9, 30).getTime() })
  const guardado = almacen(on, {
    limites: {
      leidos: new Date(2026, 10, 6, 23, 10).getTime(),
      limites: [
        { tipo: 'five_hour', porcentaje: 41, renueva: new Date(2026, 10, 7, 2, 0).toISOString() },
        { tipo: 'seven_day', porcentaje: 78, renueva: new Date(2026, 10, 9, 6, 0).toISOString() },
      ],
    },
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // A session that has had no answer yet: the engine knows the context, but no usage window.
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 21_000, window: 1_000_000, percent: 2 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.command.run({ command: 'equipo', args: '' })
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const barras = async () => (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt)).filter(alt => alt.includes(': '))
  expect(await barras()).toEqual(['5 horas: 0 %', 'Semana: 78 %', 'Contexto: 2 %'])
  expect((await ui.find({ type: 'Text', text: /^se renovó a las 2:00$/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^se renueva el lunes a las 6:00$/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^Últimos límites conocidos, de ayer a las 23:10\. Se ponen al día con la próxima respuesta de Claude\.$/ })) !== undefined).toBe(
    true,
  )

  // Claude's first answer brings this session's own figures: they take the remembered ones' place and are saved.
  await $.session.measure({
    context: { tokens: 24_000, window: 1_000_000, percent: 2.4 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 3, resetsAt: new Date(2026, 10, 7, 14, 30).toISOString() },
      { kind: 'seven_day', percentUsed: 79, resetsAt: new Date(2026, 10, 9, 6, 0).toISOString() },
    ],
    changed: ['context', 'rateLimits'],
  })
  expect(await barras()).toEqual(['5 horas: 3 %', 'Semana: 79 %', 'Contexto: 2,4 %'])
  expect((await ui.find({ type: 'Text', text: /^se renueva a las 14:30$/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /Últimos límites conocidos/ })) === undefined).toBe(true)
  expect(guardado.get('limites')).toEqual({
    leidos: new Date(2026, 10, 7, 9, 30).getTime(),
    limites: [
      { tipo: 'five_hour', porcentaje: 3, renueva: new Date(2026, 10, 7, 14, 30).toISOString() },
      { tipo: 'seven_day', porcentaje: 79, renueva: new Date(2026, 10, 9, 6, 0).toISOString() },
    ],
  })
  await ui.unmount()
})

test('una ventana que se renueva con el panel abierto se vacía a su hora, aunque no trabaje nadie', async ($, on) => {
  const reloj = mock.clock(on, { now: new Date(2026, 10, 6, 17, 40).getTime() })
  almacen(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { tokens: 217_608, window: 1_000_000, percent: 22 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 9, resetsAt: new Date(2026, 10, 6, 19, 50).toISOString() }],
    changed: ['context', 'rateLimits'],
  })

  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^9 %$/ })) !== undefined).toBe(true)
  // No agent works and no request warmed the cache, so only the renewal can redraw the panel.
  await reloj.advance(2 * 60 * 60_000 + 11 * 60_000)
  expect((await ui.find({ type: 'Text', text: /^0 %$/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^se renovó a las 19:50$/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('la caché cuenta una hora desde la última petición de la conversación y después se enfría', async ($, on) => {
  const reloj = mock.clock(on, { now: 50_000_000 })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'Hecho.',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 9000, model: 'claude-opus-5-5' },
    }
  })
  on('turn.complete', () => ({ text: 'hecho' }))

  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  await $.turn.start({ text: 'Hola', turnId: 'm1' })
  expect((await ui.find({ type: 'Text', text: /^en uso$/ })) !== undefined).toBe(true)
  for await (const _trozo of $.turn.step({ turnId: 'm1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
    // The test's own answer streams nothing.
  }
  await $.turn.complete({ answer: 'Hecho.', durationMs: 1000, isAborted: false, turnId: 'm1', reason: 'answer' })
  expect((await ui.find({ type: 'Text', text: /^60 min$/ })) !== undefined).toBe(true)
  await reloj.advance(18 * 60_000)
  expect((await ui.find({ type: 'Text', text: /^42 min$/ })) !== undefined).toBe(true)
  await reloj.advance(43 * 60_000)
  expect((await ui.find({ type: 'Text', text: /^fría$/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /el próximo mensaje vuelve a cargar la conversación/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('la fila de otra herramienta se deja al motor', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>fila del motor</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'equipo-clawd',
    component: 'ToolUse',
    requestId: 'tu9',
    surface: 'desktop',
    props: { tool_use_id: 'tu9', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false },
  })
  expect((await ui.find({ type: 'Text', text: /fila del motor/ }))?.text).toBe('fila del motor')
  await ui.unmount()
})

test('el botón Clawds de debajo del cuadro de texto abre el panel y, si se ve, lo cierra, solo en la app de escritorio', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  almacen(on)
  // The engine's own mode labels, which stay before the button.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>focus</Text>
  })
  // The panes the engine keeps: the panel, once open, is the one shown.
  let abierto = false
  on('ui.open', (_$, e) => {
    abierto = e.id === 'equipo'
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    abierto = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: abierto ? [{ id: 'equipo', title: 'Equipo', isShown: true, isFocused: false, isPlaced: true }] : [] }))

  const escritorio = await $.ui.mount({ plugin: 'equipo-clawd', component: 'SessionMode', surface: 'desktop', props: { modes: ['focus'] } })
  expect((await escritorio.find({ type: 'Text', text: /^focus$/ })) !== undefined).toBe(true)
  expect((await escritorio.find({ key: 'equipo' }))?.props.label).toBe('Clawds')
  await escritorio.press({ key: 'equipo' })
  expect(abierto).toBe(true)
  await escritorio.press({ key: 'equipo' })
  expect(abierto).toBe(false)
  await escritorio.unmount()

  // The terminal keeps the engine's line as it is.
  const terminal = await $.ui.mount({ plugin: 'equipo-clawd', component: 'SessionMode', surface: 'terminal', props: { modes: ['focus'] } })
  expect((await terminal.find({ type: 'Text', text: /^focus$/ })) !== undefined).toBe(true)
  expect((await terminal.find({ key: 'equipo' })) === undefined).toBe(true)
  await terminal.unmount()
})
