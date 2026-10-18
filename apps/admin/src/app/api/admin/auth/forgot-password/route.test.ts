import { describe, it, expect, beforeEach, vi } from "vitest"
import type { NextRequest } from "next/server"

// Caso real: un usuario de una empresa pide recuperar la contraseña desde su subdominio y el
// link del mail apuntaba a NEXT_PUBLIC_BASE_URL (un host fijo, de otra empresa). Definía la
// clave bien, pero entraba por el login de ese otro tenant y recibía "Credenciales incorrectas".
// Sin DB: `@/db` es un fake que captura los `where` y devuelve filas en orden.

const state = vi.hoisted(() => ({
  results: [] as Record<string, unknown>[][],
  wheres: [] as unknown[],
  inserts: 0,
  resetUrls: [] as string[],
}))

vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          state.wheres.push(cond)
          return Promise.resolve(state.results.shift() ?? [])
        },
      }),
    }),
    insert: () => ({
      values: async () => {
        state.inserts += 1
      },
    }),
  }),
}))

vi.mock("@/lib/rate-limit", () => ({
  ipDe: () => "127.0.0.1",
  permitirAsync: async () => true,
  respuestaLimite: () => new Response(null, { status: 429 }),
}))

vi.mock("@/lib/email", () => ({ sendEmail: async () => true }))

vi.mock("@/lib/forgot-password-email", () => ({
  buildForgotPasswordEmail: ({ resetUrl }: { resetUrl: string }) => {
    state.resetUrls.push(resetUrl)
    return { subject: "s", html: "h", text: "t" }
  },
}))

async function loadRoute() {
  vi.resetModules()
  process.env.TENANT_IDS = "tenant-a,tenant-b"
  process.env.NEXT_PUBLIC_BASE_URL = "https://tenant-b.example.com"
  delete process.env.TENANT_OVERRIDE
  delete process.env.VERCEL_ENV
  return (await import("./route")).POST
}

function forgotReq(host: string, email: string): NextRequest {
  return new Request(`http://${host}/api/admin/auth/forgot-password`, {
    method: "POST",
    headers: { host, "x-forwarded-proto": "https", "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }) as unknown as NextRequest
}

/** Junta los valores de parámetros de una condición de drizzle (`and(eq(...), eq(...))`). */
function paramValues(node: unknown, out: unknown[] = [], seen = new WeakSet<object>()): unknown[] {
  if (!node || typeof node !== "object") return out
  if (seen.has(node)) return out
  seen.add(node)
  const obj = node as Record<string, unknown>
  if ("value" in obj && typeof obj.value !== "object") out.push(obj.value)
  for (const v of Object.values(obj)) paramValues(v, out, seen)
  return out
}

const usuario = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ana",
  email: "ana@cliente.example",
  tenantId: "tenant-a",
  passwordHash: "salt:hash",
}

beforeEach(() => {
  state.results = []
  state.wheres = []
  state.inserts = 0
  state.resetUrls = []
})

describe("forgot-password", () => {
  it("el link del mail va al host del tenant, no a NEXT_PUBLIC_BASE_URL", async () => {
    const POST = await loadRoute()
    state.results = [[usuario]]

    const res = await POST(forgotReq("tenant-a.example.com", " Ana@Cliente.example "))

    expect(res.status).toBe(200)
    expect(state.resetUrls).toHaveLength(1)
    expect(state.resetUrls[0]).toMatch(/^https:\/\/tenant-a\.example\.com\/admin\/reset-password\/[0-9a-f]{64}$/)
  })

  it("busca el usuario por email AND tenant del host", async () => {
    const POST = await loadRoute()

    await POST(forgotReq("tenant-a.example.com", "ana@cliente.example"))

    const values = paramValues(state.wheres[0])
    expect(values).toContain("ana@cliente.example")
    expect(values).toContain("tenant-a")
  })

  it("host no resoluble: responde ok sin consultar ni generar token", async () => {
    const POST = await loadRoute()
    state.results = [[usuario]]

    const res = await POST(forgotReq("atacante.example.com", "ana@cliente.example"))

    expect(await res.json()).toEqual({ ok: true })
    expect(state.inserts).toBe(0)
    expect(state.resetUrls).toHaveLength(0)
  })
})
