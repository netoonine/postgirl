import fs from 'fs'
import WebSocket from 'ws'
import { io as ioClient, Socket } from 'socket.io-client'
import mqtt, { MqttClient } from 'mqtt'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { GrpcReflection } from 'grpc-js-reflection-client'
import type { RealtimeEvent } from '@shared/types'

type Emit = (e: RealtimeEvent) => void

interface Conn {
  close: () => void
  send: (data: string, opts?: any) => void
  end?: () => void
}

const conns = new Map<string, Conn>()

const asText = (d: any): { data: string; binary: boolean } => {
  if (typeof d === 'string') return { data: d, binary: false }
  const buf = Buffer.isBuffer(d) ? d : Array.isArray(d) ? Buffer.concat(d) : Buffer.from(d)
  const text = buf.toString('utf8')
  // texto que não sobrevive à volta para bytes é binário: mostramos em base64
  return Buffer.from(text, 'utf8').equals(buf) ? { data: text, binary: false } : { data: buf.toString('base64'), binary: true }
}

const stringify = (v: any) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

export function disconnect(connId: string) {
  conns.get(connId)?.close()
  conns.delete(connId)
}

export function send(connId: string, data: string, opts?: any) {
  conns.get(connId)?.send(data, opts)
}

export function endStream(connId: string) {
  conns.get(connId)?.end?.()
}

// ---------------- WebSocket ----------------

export function wsConnect(o: { connId: string; url: string; headers: Record<string, string>; protocols?: string[] }, emit: Emit) {
  disconnect(o.connId)
  emit({ connId: o.connId, type: 'status', status: 'connecting' })
  const ws = new WebSocket(o.url, o.protocols?.length ? o.protocols : undefined, { headers: o.headers, rejectUnauthorized: false })
  ws.on('open', () => emit({ connId: o.connId, type: 'status', status: 'connected', detail: ws.protocol || undefined }))
  ws.on('message', (d, isBinary) => {
    const t = isBinary ? { data: Buffer.from(d as Buffer).toString('base64'), binary: true } : asText(d)
    emit({ connId: o.connId, type: 'message', direction: 'in', ...t, at: Date.now() })
  })
  ws.on('unexpected-response', (_req, res) =>
    emit({ connId: o.connId, type: 'status', status: 'error', detail: `Handshake recusado: HTTP ${res.statusCode} ${res.statusMessage}` })
  )
  ws.on('error', (e) => emit({ connId: o.connId, type: 'status', status: 'error', detail: e.message }))
  ws.on('close', (code, reason) => {
    conns.delete(o.connId)
    emit({ connId: o.connId, type: 'status', status: 'disconnected', detail: `código ${code}${reason.length ? ` · ${reason}` : ''}` })
  })
  conns.set(o.connId, {
    close: () => ws.close(1000),
    send: (data) => {
      ws.send(data)
      emit({ connId: o.connId, type: 'message', direction: 'out', data, at: Date.now() })
    }
  })
}

// ---------------- Socket.IO ----------------

export function ioConnect(o: { connId: string; url: string; path?: string; headers: Record<string, string>; auth?: string; events: string[] }, emit: Emit) {
  disconnect(o.connId)
  emit({ connId: o.connId, type: 'status', status: 'connecting' })
  let auth: any
  try {
    auth = o.auth ? JSON.parse(o.auth) : undefined
  } catch {
    auth = undefined
  }
  const socket: Socket = ioClient(o.url, {
    path: o.path || '/socket.io',
    extraHeaders: o.headers,
    auth,
    transports: ['websocket', 'polling'],
    reconnection: false,
    rejectUnauthorized: false
  } as any)
  socket.on('connect', () => emit({ connId: o.connId, type: 'status', status: 'connected', detail: `id ${socket.id}` }))
  socket.on('connect_error', (e) => emit({ connId: o.connId, type: 'status', status: 'error', detail: e.message }))
  socket.on('disconnect', (reason) => {
    conns.delete(o.connId)
    emit({ connId: o.connId, type: 'status', status: 'disconnected', detail: reason })
  })
  // escuta todos os eventos; a lista `events` existe só para documentar o que é esperado
  socket.onAny((event, ...args) => emit({ connId: o.connId, type: 'message', direction: 'in', event, data: args.map(stringify).join('\n'), at: Date.now() }))
  conns.set(o.connId, {
    close: () => socket.disconnect(),
    send: (data, opts: { event: string; json?: boolean; ack?: boolean }) => {
      let payload: any = data
      if (opts?.json) {
        try {
          payload = JSON.parse(data)
        } catch {
          payload = data
        }
      }
      const event = opts?.event || 'message'
      emit({ connId: o.connId, type: 'message', direction: 'out', event, data, at: Date.now() })
      if (opts?.ack) {
        socket.emit(event, payload, (...ack: any[]) =>
          emit({ connId: o.connId, type: 'message', direction: 'in', event: `${event} (ack)`, data: ack.map(stringify).join('\n'), at: Date.now() })
        )
      } else {
        socket.emit(event, payload)
      }
    }
  })
}

// ---------------- MQTT ----------------

export function mqttConnect(
  o: {
    connId: string
    url: string
    clientId?: string
    username?: string
    password?: string
    subscriptions: { topic: string; qos: 0 | 1 | 2 }[]
    version?: 4 | 5
  },
  emit: Emit
) {
  disconnect(o.connId)
  emit({ connId: o.connId, type: 'status', status: 'connecting' })
  const client: MqttClient = mqtt.connect(o.url, {
    clientId: o.clientId || `postgirl_${Math.random().toString(16).slice(2, 10)}`,
    username: o.username || undefined,
    password: o.password || undefined,
    protocolVersion: o.version || 4,
    reconnectPeriod: 0,
    rejectUnauthorized: false
  })
  client.on('connect', () => {
    emit({ connId: o.connId, type: 'status', status: 'connected' })
    for (const s of o.subscriptions.filter((s) => s.topic)) {
      client.subscribe(s.topic, { qos: s.qos }, (err) =>
        emit({
          connId: o.connId,
          type: 'message',
          direction: 'out',
          topic: s.topic,
          data: err ? `Falha ao assinar: ${err.message}` : `Assinado (QoS ${s.qos})`,
          at: Date.now()
        })
      )
    }
  })
  client.on('message', (topic, payload) => emit({ connId: o.connId, type: 'message', direction: 'in', topic, ...asText(payload), at: Date.now() }))
  client.on('error', (e) => emit({ connId: o.connId, type: 'status', status: 'error', detail: e.message }))
  client.on('close', () => {
    conns.delete(o.connId)
    emit({ connId: o.connId, type: 'status', status: 'disconnected' })
  })
  conns.set(o.connId, {
    close: () => client.end(true),
    send: (data, opts: { topic: string; qos?: 0 | 1 | 2; retain?: boolean }) => {
      client.publish(opts.topic, data, { qos: opts.qos ?? 0, retain: !!opts.retain })
      emit({ connId: o.connId, type: 'message', direction: 'out', topic: opts.topic, data, at: Date.now() })
    }
  })
}

// ---------------- gRPC ----------------

export interface GrpcMethodInfo {
  service: string
  method: string
  path: string
  requestStream: boolean
  responseStream: boolean
  sample: string
}

const loaderOpts: protoLoader.Options = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
// definição carregada por URL/arquivo, para invocar depois sem recarregar
const definitions = new Map<string, protoLoader.PackageDefinition>()

const creds = (tls: boolean) => (tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure())
const target = (url: string) => url.replace(/^grpcs?:\/\//, '').replace(/\/$/, '')

function sampleFor(def: protoLoader.PackageDefinition, type: any, depth = 0): any {
  if (!type || depth > 4) return {}
  const out: any = {}
  for (const f of type.field || []) {
    let v: any
    switch (f.type) {
      case 'TYPE_STRING':
        v = ''
        break
      case 'TYPE_BOOL':
        v = false
        break
      case 'TYPE_BYTES':
        v = ''
        break
      case 'TYPE_MESSAGE':
        v = sampleFor(def, (def[f.typeName.replace(/^\./, '')] as any)?.type, depth + 1)
        break
      case 'TYPE_ENUM': {
        const en: any = def[f.typeName.replace(/^\./, '')]
        v = en?.type?.value?.[0]?.name ?? 0
        break
      }
      default:
        v = 0
    }
    out[f.name] = f.label === 'LABEL_REPEATED' ? [v] : v
  }
  return out
}

function methodsOf(def: protoLoader.PackageDefinition): GrpcMethodInfo[] {
  const list: GrpcMethodInfo[] = []
  for (const [name, entry] of Object.entries(def)) {
    if ((entry as any).format) continue // mensagem/enum, não serviço
    for (const [method, m] of Object.entries(entry as Record<string, protoLoader.MethodDefinition<any, any>>)) {
      if (!m?.path) continue
      list.push({
        service: name,
        method,
        path: m.path,
        requestStream: m.requestStream,
        responseStream: m.responseStream,
        sample: JSON.stringify(sampleFor(def, (m.requestType as any).type), null, 2)
      })
    }
  }
  return list
}

export async function grpcLoad(o: { url: string; protoPath?: string; includeDirs?: string[]; tls: boolean }): Promise<GrpcMethodInfo[]> {
  let def: protoLoader.PackageDefinition
  if (o.protoPath) {
    if (!fs.existsSync(o.protoPath)) throw new Error(`Arquivo .proto não encontrado: ${o.protoPath}`)
    def = await protoLoader.load(o.protoPath, { ...loaderOpts, includeDirs: o.includeDirs })
  } else {
    const r = new GrpcReflection(target(o.url), creds(o.tls))
    const services = (await r.listServices()).filter((s) => !s.startsWith('grpc.reflection.'))
    def = {}
    for (const s of services) {
      const d = await r.getDescriptorBySymbol(s)
      Object.assign(def, d.getPackageDefinition(loaderOpts))
    }
  }
  definitions.set(`${o.url}|${o.protoPath || 'reflection'}`, def)
  return methodsOf(def)
}

export function grpcInvoke(
  o: { connId: string; url: string; protoPath?: string; path: string; message: string; metadata: Record<string, string>; tls: boolean; deadlineMs?: number },
  emit: Emit
) {
  disconnect(o.connId)
  const def = definitions.get(`${o.url}|${o.protoPath || 'reflection'}`)
  if (!def) throw new Error('Carregue os métodos (reflection ou .proto) antes de invocar')
  let m: protoLoader.MethodDefinition<any, any> | undefined
  for (const entry of Object.values(def)) {
    for (const md of Object.values(entry as any)) if ((md as any)?.path === o.path) m = md as any
  }
  if (!m) throw new Error(`Método ${o.path} não está na definição carregada`)

  const Client = grpc.makeGenericClientConstructor({}, '')
  const client = new Client(target(o.url), creds(o.tls))
  const md = new grpc.Metadata()
  for (const [k, v] of Object.entries(o.metadata)) if (k) md.add(k, v)
  const callOpts: grpc.CallOptions = o.deadlineMs ? { deadline: Date.now() + o.deadlineMs } : {}
  const started = Date.now()
  const parse = (s: string) => (s.trim() ? JSON.parse(s) : {})
  const onData = (resp: any) => emit({ connId: o.connId, type: 'message', direction: 'in', data: JSON.stringify(resp, null, 2), at: Date.now() })
  const mdObj = (meta: grpc.Metadata) => Object.fromEntries(Object.entries(meta.getMap()).map(([k, v]) => [k, String(v)]))

  let call: any
  emit({ connId: o.connId, type: 'status', status: 'connected' })
  const finish = (err: grpc.ServiceError | null, trailers?: grpc.Metadata) => {
    conns.delete(o.connId)
    emit({
      connId: o.connId,
      type: 'grpc-end',
      status: err ? `${grpc.status[err.code] || err.code}: ${err.details || err.message}` : 'OK',
      code: err ? err.code : 0,
      trailers: trailers ? mdObj(trailers) : err?.metadata ? mdObj(err.metadata) : undefined,
      time: Date.now() - started
    })
    client.close()
  }

  if (!m.requestStream && !m.responseStream) {
    call = client.makeUnaryRequest(o.path, m.requestSerialize, m.responseDeserialize, parse(o.message), md, callOpts, (err, resp) => {
      if (resp) onData(resp)
      finish(err)
    })
  } else if (!m.requestStream && m.responseStream) {
    call = client.makeServerStreamRequest(o.path, m.requestSerialize, m.responseDeserialize, parse(o.message), md, callOpts)
  } else if (m.requestStream && !m.responseStream) {
    call = client.makeClientStreamRequest(o.path, m.requestSerialize, m.responseDeserialize, md, callOpts, (err, resp) => {
      if (resp) onData(resp)
      finish(err)
    })
  } else {
    call = client.makeBidiStreamRequest(o.path, m.requestSerialize, m.responseDeserialize, md, callOpts)
  }

  call.on('metadata', (meta: grpc.Metadata) =>
    emit({ connId: o.connId, type: 'message', direction: 'in', event: 'metadata', data: JSON.stringify(mdObj(meta), null, 2), at: Date.now() })
  )
  if (m.responseStream) {
    call.on('data', onData)
    call.on('error', (e: grpc.ServiceError) => finish(e))
    call.on('status', (s: grpc.StatusObject) => s.code === grpc.status.OK && finish(null, s.metadata))
  }

  conns.set(o.connId, {
    close: () => call.cancel(),
    send: (data) => {
      call.write(parse(data))
      emit({ connId: o.connId, type: 'message', direction: 'out', data, at: Date.now() })
    },
    end: () => call.end()
  })
  // na chamada unária/server-stream a mensagem já foi enviada na abertura
  if (m.requestStream) {
    if (o.message.trim()) conns.get(o.connId)!.send(o.message)
  } else {
    emit({ connId: o.connId, type: 'message', direction: 'out', data: o.message, at: Date.now() })
  }
}
