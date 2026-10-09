import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Las claves llevan un prefijo distinto por test porque el store vive en el módulo.

/**
 * Cliente de node-redis falso: lo que se prueba es el contrato (qué comandos manda, cómo lee la
 * respuesta) y, sobre todo, que ante CUALQUIER problema cae al contador en memoria en vez de
 * bloquear o de lanzar.
 */
const exec = vi.fn<() => Promise<unknown>>()
const connect = vi.fn<() => Promise<void>>()
const comandos: Array<[string, ...unknown[]]> = []
const clienteFalso = {
  isOpen: true,
  on: vi.fn(),
  connect,
  destroy: vi.fn(),
  multi: () => {
    const multi = {
      incr: (k: string) => {
        comandos.push(["INCR", k])
        return multi
      },
      pExpire: (k: string, ms: number) => {
        comandos.push(["PEXPIRE", k, ms])
        return multi
      },
      exec,
    }
    return multi
  },
}
const createClient = vi.fn((_opciones: unknown) => clienteFalso)
vi.mock("redis", () => ({ createClient: (opciones: unknown) => createClient(opciones) }))

import { REDIS_PAUSA_TRAS_FALLO_MS, REDIS_TIMEOUT_MS, ipDe, permitir, permitirAsync } from "./rate-limit"

const URL_REDIS = "rediss://default:s3cr3t-placeholder@redis.example:6379"

function olvidarCliente() {
  delete (globalThis as { crmRateLimitRedis?: unknown }).crmRateLimitRedis
}

describe("permitir", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("deja pasar hasta el máximo y corta después", () => {
    const clave = "tope:x"
    expect(permitir(clave, 3, 60_000)).toBe(true)
    expect(permitir(clave, 3, 60_000)).toBe(true)
    expect(permitir(clave, 3, 60_000)).toBe(true)
    expect(permitir(clave, 3, 60_000)).toBe(false)
  })

  it("no consume usos cuando ya cortó y reabre al vencer la ventana", () => {
    const clave = "ventana:x"
    permitir(clave, 1, 60_000)
    permitir(clave, 1, 60_000)
    vi.advanceTimersByTime(59_000)
    expect(permitir(clave, 1, 60_000)).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(permitir(clave, 1, 60_000)).toBe(true)
  })

  it("cuenta cada clave por separado y un máximo de 0 no deja pasar a nadie", () => {
    expect(permitir("aislado:a", 1, 60_000)).toBe(true)
    expect(permitir("aislado:a", 1, 60_000)).toBe(false)
    expect(permitir("aislado:b", 1, 60_000)).toBe(true)
    expect(permitir("cero:a", 0, 60_000)).toBe(false)
  })
})

describe("permitirAsync", () => {
  beforeEach(() => {
    olvidarCliente()
    comandos.length = 0
    clienteFalso.isOpen = true
    connect.mockResolvedValue(undefined)
    vi.stubEnv("REDIS_URL", URL_REDIS)
    vi.stubEnv("UPSTASH_REDIS_REST_REDIS_URL", "")
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    exec.mockReset()
    connect.mockReset()
    createClient.mockClear()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    olvidarCliente()
  })

  it("cuenta en Redis con INCR + PEXPIRE en un MULTI y respeta el tope", async () => {
    exec.mockResolvedValueOnce([1, true]).mockResolvedValueOnce([2, true]).mockResolvedValueOnce([3, true])

    expect(await permitirAsync("redis:tope", 2, 60_000)).toBe(true)
    expect(await permitirAsync("redis:tope", 2, 60_000)).toBe(true)
    expect(await permitirAsync("redis:tope", 2, 60_000)).toBe(false)

    expect(exec).toHaveBeenCalledTimes(3)
    const ventana = Math.floor(Date.now() / 60_000)
    expect(comandos.slice(0, 2)).toEqual([
      ["INCR", `rl:redis:tope:${ventana}`],
      ["PEXPIRE", `rl:redis:tope:${ventana}`, 60_000],
    ])
  })

  it("crea UN cliente por proceso (singleton en globalThis), con timeout corto y sin reintentos infinitos", async () => {
    exec.mockResolvedValue([1, true])
    await permitirAsync("redis:singleton", 5, 60_000)
    await permitirAsync("redis:singleton", 5, 60_000)

    expect(createClient).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledTimes(1)
    const opciones = createClient.mock.calls[0]![0] as {
      url: string
      disableOfflineQueue: boolean
      socket: { connectTimeout: number; reconnectStrategy: (n: number) => false | number }
    }
    expect(opciones.url).toBe(URL_REDIS)
    expect(opciones.disableOfflineQueue).toBe(true)
    expect(opciones.socket.connectTimeout).toBe(REDIS_TIMEOUT_MS)
    expect(opciones.socket.reconnectStrategy(0)).toBeTypeOf("number")
    expect(opciones.socket.reconnectStrategy(3)).toBe(false)
    expect(clienteFalso.on).toHaveBeenCalledWith("error", expect.any(Function))
  })

  it("acepta la variable del Shop (UPSTASH_REDIS_REST_REDIS_URL) como alternativa", async () => {
    vi.stubEnv("REDIS_URL", "")
    vi.stubEnv("UPSTASH_REDIS_REST_REDIS_URL", "rediss://default:s3cr3t-placeholder@shop.example:6379")
    exec.mockResolvedValue([1, true])

    expect(await permitirAsync("redis:shop-var", 1, 60_000)).toBe(true)
    expect((createClient.mock.calls[0]![0] as { url: string }).url).toContain("shop.example")
  })

  it("sin URL no crea cliente y cuenta en memoria", async () => {
    vi.stubEnv("REDIS_URL", "")

    expect(await permitirAsync("memoria:sin-url", 1, 60_000)).toBe(true)
    expect(await permitirAsync("memoria:sin-url", 1, 60_000)).toBe(false)
    expect(createClient).not.toHaveBeenCalled()
  })

  it("con máximo 0 no deja pasar ni toca Redis", async () => {
    expect(await permitirAsync("redis:cero", 0, 60_000)).toBe(false)
    expect(createClient).not.toHaveBeenCalled()
  })

  it("si no se puede conectar cae al contador en memoria (fail-open al local)", async () => {
    connect.mockRejectedValue(new Error("ECONNREFUSED"))

    expect(await permitirAsync("memoria:conexion", 1, 60_000)).toBe(true)
    expect(await permitirAsync("memoria:conexion", 1, 60_000)).toBe(false)
    expect(exec).not.toHaveBeenCalled()
  })

  it("ante un error del comando o una respuesta inesperada cae a memoria", async () => {
    exec.mockRejectedValueOnce(new Error("WRONGTYPE"))
    expect(await permitirAsync("memoria:comando", 2, 60_000)).toBe(true)

    olvidarCliente() // sin la pausa tras el fallo, para probar el segundo caso
    exec.mockResolvedValueOnce(["no-es-un-numero", true])
    expect(await permitirAsync("memoria:comando", 2, 60_000)).toBe(true)

    olvidarCliente()
    exec.mockResolvedValueOnce([1, true])
    // El tercero sí llega a Redis y Redis dice 1 ≤ 2, pero el contador en memoria ya tenía 2:
    // los caminos son independientes y eso es lo esperado (Redis manda cuando está).
    expect(await permitirAsync("memoria:comando", 2, 60_000)).toBe(true)
  })

  it(`tras un fallo no vuelve a intentar con Redis durante ${REDIS_PAUSA_TRAS_FALLO_MS / 1000} s`, async () => {
    exec.mockRejectedValueOnce(new Error("se cayó"))
    await permitirAsync("memoria:pausa", 10, 60_000)
    expect(exec).toHaveBeenCalledTimes(1)

    exec.mockResolvedValue([1, true])
    await permitirAsync("memoria:pausa", 10, 60_000)
    await permitirAsync("memoria:pausa", 10, 60_000)
    expect(exec).toHaveBeenCalledTimes(1) // sigue en memoria, sin pegarle a Redis

    vi.useFakeTimers({ now: Date.now() + REDIS_PAUSA_TRAS_FALLO_MS + 1 })
    await permitirAsync("memoria:pausa", 10, 60_000)
    expect(exec).toHaveBeenCalledTimes(2) // pasada la pausa, vuelve a intentar
    vi.useRealTimers()
  })

  it("si el cliente quedó cerrado (reconexión rendida) crea uno nuevo pasada la pausa", async () => {
    exec.mockResolvedValue([1, true])
    await permitirAsync("redis:cerrado", 10, 60_000)
    clienteFalso.isOpen = false
    await permitirAsync("redis:cerrado", 10, 60_000)
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(clienteFalso.destroy).toHaveBeenCalledTimes(1)
  })

  it(`corta la espera a ${REDIS_TIMEOUT_MS} ms y cae a memoria`, async () => {
    exec.mockImplementation(() => new Promise(() => {})) // nunca responde

    const inicio = Date.now()
    expect(await permitirAsync("memoria:timeout", 1, 60_000)).toBe(true)
    const tardo = Date.now() - inicio
    expect(tardo).toBeGreaterThanOrEqual(REDIS_TIMEOUT_MS - 20)
    expect(tardo).toBeLessThan(REDIS_TIMEOUT_MS + 1_000)

    // El segundo entra en la pausa tras el fallo: no espera nada y cuenta en memoria.
    const inicio2 = Date.now()
    expect(await permitirAsync("memoria:timeout", 1, 60_000)).toBe(false)
    expect(Date.now() - inicio2).toBeLessThan(REDIS_TIMEOUT_MS)
  })
})

describe("ipDe", () => {
  it("toma la primera IP de x-forwarded-for, después x-real-ip y por último una clave compartida", () => {
    const con = (h: Record<string, string>) => new Request("http://crm.example/x", { headers: h })
    expect(ipDe(con({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" }))).toBe("203.0.113.1")
    expect(ipDe(con({ "x-real-ip": "203.0.113.2" }))).toBe("203.0.113.2")
    expect(ipDe(con({}))).toBe("desconocida")
  })
})
