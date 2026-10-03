import { beforeEach, describe, expect, it, vi } from "vitest"

// sendPushToCasilla: los destinatarios los resuelve correo-repo (con integración propia); acá
// se prueba que se notifica a cada uno, sin filtro de disponibilidad, y que no revienta.

const state = vi.hoisted(() => ({
  destinatarios: [] as string[],
  enviados: [] as string[], // endpoints a los que se mandó
}))

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }) => {
      state.enviados.push(sub.endpoint)
    },
  },
}))

vi.mock("@/lib/correo-repo", () => ({
  destinatariosCasilla: async () => state.destinatarios,
}))

// Una suscripción por operador: el endpoint lleva el id para poder afirmar a quién llegó.
let consulta = 0
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => {
          const op = state.destinatarios[consulta++]
          return [{ id: `sub-${op}`, endpoint: `https://push.example/${op}`, p256dh: "k", auth: "a" }]
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    delete: () => ({ where: async () => {} }),
  }),
}))

import { sendPushToCasilla } from "./push"

describe("sendPushToCasilla", () => {
  beforeEach(() => {
    consulta = 0
    state.enviados = []
    process.env.VAPID_PUBLIC_KEY = "pub"
    process.env.VAPID_PRIVATE_KEY = "priv"
  })

  // Va primero: push.ts memoiza la configuración VAPID al primer uso.
  it("sin claves VAPID es no-op", async () => {
    delete process.env.VAPID_PUBLIC_KEY
    state.destinatarios = ["ana"]
    expect(await sendPushToCasilla("tenant-a", "casilla-1", { title: "t", body: "b" })).toBe(0)
    expect(state.enviados).toEqual([])
  })

  it("notifica a cada destinatario de la casilla y devuelve cuántos recibieron", async () => {
    state.destinatarios = ["ana", "beto", "admin1"]
    const n = await sendPushToCasilla("tenant-a", "casilla-1", { title: "Correo nuevo en Ventas", body: "Consulta" })
    expect(n).toBe(3)
    expect(state.enviados.sort()).toEqual(["https://push.example/admin1", "https://push.example/ana", "https://push.example/beto"])
  })

  it("sin destinatarios no envía nada", async () => {
    state.destinatarios = []
    expect(await sendPushToCasilla("tenant-a", "casilla-1", { title: "t", body: "b" })).toBe(0)
    expect(state.enviados).toEqual([])
  })
})
