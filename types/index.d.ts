export type Estado = 'trabajando' | 'terminado' | 'fallo' | 'parado'

export type Agente = {
  id: string
  toolUseId: string
  descripcion: string
  tipo: string
  modelo: string
  esfuerzo?: string
  profesion: string
  inicio: number
  fin?: number
  estado: Estado
  tokens: number
  enFondo: boolean
  workflow?: { runId: string; indice: number; nombre?: string }
  // Only for /equipo demo's make-believe agents: how long each runs, how it ends and its tokens at the end.
  demo?: { dura: number; final: Estado; tokens: number }
}

// One usage window as the engine reports it: which one (five_hour, seven_day, a gateway's spend_limit), how much of it
// is used, from 0 to 100 (past 100 on an exceeded spend limit), and when it renews, as an ISO 8601 timestamp.
export type Limite = { tipo: string; porcentaje: number; renueva?: string }

// What the panel's foot shows from the engine's last measurement: the context window and the usage windows.
export type Consumo = {
  contexto?: { tokens?: number; ventana: number; porcentaje?: number }
  limites: Limite[]
}

// The main conversation's prompt cache: when its last request that got an answer went out, and whether a turn of it is running.
export type Cache = { ultimaPeticion?: number; enUso: boolean }

declare module 'claude-code' {
  interface PluginState {
    'equipo-clawd': { agentes: Shaped<Agente[]>; tic: number; sonido: boolean; consumo: Shaped<Consumo>; cache: Shaped<Cache> }
  }
}
