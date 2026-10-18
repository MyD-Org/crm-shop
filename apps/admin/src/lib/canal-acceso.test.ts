import { describe, expect, it } from "vitest"
import { buildCanalTabs, canalKey } from "@/lib/inbox-canales"
import {
  canalesVisibles,
  esRestringido,
  filtrarNombres,
  filtrarNumerosRaw,
  filtrarPorCanal,
  opcionesDeCanales,
  operadoresConAcceso,
  parseCanalesPermitidos,
  puedeVerCanal,
  tieneAlgunCanal,
  type ActorCanales,
} from "@/lib/canal-acceso"

const actor = (role: string, canalesPermitidos: string[] | null): ActorCanales => ({
  id: "u1",
  role,
  canalesPermitidos,
})

describe("esRestringido", () => {
  it("operator con NULL no es restringido", () => {
    expect(esRestringido(actor("operator", null))).toBe(false)
  })
  it("operator con lista (también vacía) es restringido", () => {
    expect(esRestringido(actor("operator", ["canal-a"]))).toBe(true)
    expect(esRestringido(actor("operator", []))).toBe(true)
  })
  it("admin y superadmin con valor guardado quedan exentos", () => {
    expect(esRestringido(actor("admin", ["canal-a"]))).toBe(false)
    expect(esRestringido(actor("superadmin", []))).toBe(false)
  })
})

describe("puedeVerCanal", () => {
  it("restringido a canal-a ve canal-a y no canal-b", () => {
    const a = actor("operator", ["canal-a"])
    expect(puedeVerCanal(a, "canal-a")).toBe(true)
    expect(puedeVerCanal(a, "canal-b")).toBe(false)
  })
  it("lista vacía no ve ninguno", () => {
    expect(puedeVerCanal(actor("operator", []), "canal-a")).toBe(false)
  })
  it("clave null o undefined: restringido deniega (fail-closed), irrestricto permite", () => {
    expect(puedeVerCanal(actor("operator", ["canal-a"]), null)).toBe(false)
    expect(puedeVerCanal(actor("operator", ["canal-a"]), undefined)).toBe(false)
    expect(puedeVerCanal(actor("operator", null), null)).toBe(true)
    expect(puedeVerCanal(actor("admin", ["canal-a"]), undefined)).toBe(true)
  })
  it("admin con valor residual ve todo", () => {
    expect(puedeVerCanal(actor("admin", ["canal-a"]), "canal-b")).toBe(true)
  })
  it("claves canal:<canal> se evalúan igual que las cuentas", () => {
    expect(puedeVerCanal(actor("operator", ["canal:instagram"]), "canal:instagram")).toBe(true)
    expect(puedeVerCanal(actor("operator", ["canal-a"]), "canal:instagram")).toBe(false)
  })
  it("las solapas correo:<id> no intervienen con esta lista", () => {
    expect(puedeVerCanal(actor("operator", ["canal-a"]), "correo:abc")).toBe(false)
  })
})

describe("filtrarPorCanal / canalesVisibles / tieneAlgunCanal", () => {
  const items = [{ k: "canal-a" }, { k: "canal-b" }, { k: null as string | null }]
  it("irrestricto devuelve el mismo arreglo", () => {
    const todos = actor("operator", null)
    expect(filtrarPorCanal(todos, items, (i) => i.k)).toBe(items)
  })
  it("restringido deja solo lo accesible y descarta sin clave", () => {
    expect(filtrarPorCanal(actor("operator", ["canal-a"]), items, (i) => i.k)).toEqual([{ k: "canal-a" }])
  })
  it("canalesVisibles recorta la lista de canales", () => {
    expect(canalesVisibles(actor("operator", ["canal-b"]), ["canal-a", "canal-b"])).toEqual(["canal-b"])
    expect(canalesVisibles(actor("admin", null), ["canal-a", "canal-b"])).toEqual(["canal-a", "canal-b"])
  })
  it("tieneAlgunCanal es false solo con restringido y lista vacía", () => {
    expect(tieneAlgunCanal(actor("operator", []))).toBe(false)
    expect(tieneAlgunCanal(actor("operator", ["canal-a"]))).toBe(true)
    expect(tieneAlgunCanal(actor("operator", null))).toBe(true)
    expect(tieneAlgunCanal(actor("admin", []))).toBe(true)
  })
})

describe("operadoresConAcceso", () => {
  const ops = [
    { id: "1", role: "operator", canalesPermitidos: ["canal-a"] as string[] | null },
    { id: "2", role: "operator", canalesPermitidos: null as string[] | null },
    { id: "3", role: "admin", canalesPermitidos: ["canal-a"] as string[] | null },
  ]
  it("filtra por el canal de la conversación", () => {
    expect(operadoresConAcceso(ops, "canal-b").map((o) => o.id)).toEqual(["2", "3"])
    expect(operadoresConAcceso(ops, "canal-a").map((o) => o.id)).toEqual(["1", "2", "3"])
  })
  it("sin canal conocido solo quedan los irrestrictos", () => {
    expect(operadoresConAcceso(ops, null).map((o) => o.id)).toEqual(["2", "3"])
  })
  it("un restringido sin canal conocido se excluye", () => {
    expect(operadoresConAcceso([ops[0]], null)).toEqual([])
  })
})

describe("parseCanalesPermitidos", () => {
  it("acepta null y []", () => {
    expect(parseCanalesPermitidos(null)).toEqual({ ok: true, value: null })
    expect(parseCanalesPermitidos([])).toEqual({ ok: true, value: [] })
  })
  it("acepta claves válidas y recorta espacios", () => {
    expect(parseCanalesPermitidos([" canal-a ", "canal:instagram"])).toEqual({
      ok: true,
      value: ["canal-a", "canal:instagram"],
    })
  })
  it("rechaza lo que no es arreglo ni null", () => {
    expect(parseCanalesPermitidos("canal-a").ok).toBe(false)
    expect(parseCanalesPermitidos(undefined).ok).toBe(false)
    expect(parseCanalesPermitidos({}).ok).toBe(false)
  })
  it("rechaza elementos vacíos, no string o con caracteres inválidos", () => {
    expect(parseCanalesPermitidos([""]).ok).toBe(false)
    expect(parseCanalesPermitidos(["   "]).ok).toBe(false)
    expect(parseCanalesPermitidos([1]).ok).toBe(false)
    expect(parseCanalesPermitidos(["a b"]).ok).toBe(false)
    expect(parseCanalesPermitidos(["a/b"]).ok).toBe(false)
  })
  it("rechaza duplicados", () => {
    expect(parseCanalesPermitidos(["x", "x"]).ok).toBe(false)
    expect(parseCanalesPermitidos(["x", " x "]).ok).toBe(false)
  })
  it("respeta los límites de largo y cantidad", () => {
    expect(parseCanalesPermitidos(["a".repeat(200)]).ok).toBe(true)
    expect(parseCanalesPermitidos(["a".repeat(201)]).ok).toBe(false)
    const cien = Array.from({ length: 100 }, (_, i) => `c${i}`)
    expect(parseCanalesPermitidos(cien).ok).toBe(true)
    expect(parseCanalesPermitidos([...cien, "extra"]).ok).toBe(false)
  })
  it("los mensajes de error van en usted", () => {
    const r = parseCanalesPermitidos("x")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Indique|no (es|son) válid/)
  })
})

describe("filtrarNombres (sin fuga de nombres de canales ajenos)", () => {
  const nombres = { "canal-a": "Sucursal A", "canal-b": "Sucursal B", "canal:instagram": "Instagram" }
  it("irrestricto recibe el mismo objeto", () => {
    expect(filtrarNombres(actor("operator", null), nombres)).toBe(nombres)
    expect(filtrarNombres(actor("admin", ["canal-a"]), nombres)).toBe(nombres)
  })
  it("restringido solo recibe los nombres de sus canales", () => {
    expect(filtrarNombres(actor("operator", ["canal-a"]), nombres)).toEqual({ "canal-a": "Sucursal A" })
    expect(filtrarNombres(actor("operator", []), nombres)).toEqual({})
  })
  it("las solapas armadas con los nombres filtrados no muestran canales ajenos", () => {
    const a = actor("operator", ["canal-a"])
    const contactos = filtrarPorCanal(
      a,
      [
        { channel: "whatsapp", channel_account_id: "canal-a", business_phone: null, awaiting_reply: true },
        { channel: "whatsapp", channel_account_id: "canal-b", business_phone: null, awaiting_reply: true },
      ],
      canalKey,
    )
    const tabs = buildCanalTabs(contactos, filtrarNombres(a, nombres))
    expect(tabs.map((t) => t.key)).toEqual(["canal-a"])
    expect(tabs[0].pending).toBe(1)
  })
})

describe("filtrarNumerosRaw (respuesta de /v1/staff/whatsapp-numbers)", () => {
  const lista = [
    { channelAccountId: "canal-a", displayPhoneNumber: "+54 11 0000-0001", isTest: false },
    { channelAccountId: "canal-b", displayPhoneNumber: "+54 11 0000-0002" },
    { displayPhoneNumber: "sin id" },
  ]
  it("irrestricto: devuelve lo mismo, tal cual", () => {
    expect(filtrarNumerosRaw(actor("operator", null), lista)).toBe(lista)
    const envuelta = { numbers: lista }
    expect(filtrarNumerosRaw(actor("admin", []), envuelta)).toBe(envuelta)
  })
  it("restringido: conserva el shape y solo los números de sus canales", () => {
    const a = actor("operator", ["canal-a"])
    expect(filtrarNumerosRaw(a, lista)).toEqual([lista[0]])
    expect(filtrarNumerosRaw(a, { numbers: lista, otro: 1 })).toEqual({ numbers: [lista[0]], otro: 1 })
  })
  it("restringido: formato desconocido o ítems sin id no filtran nada ajeno", () => {
    const a = actor("operator", ["canal-a"])
    expect(filtrarNumerosRaw(a, "raro")).toEqual([])
    expect(filtrarNumerosRaw(a, [{ id: "canal-a" }, { id: "canal-b" }, null, 7])).toEqual([{ id: "canal-a" }])
  })
})

describe("opcionesDeCanales (selector de la gestión de usuarios)", () => {
  it("une números, contactos, nombres y claves ya guardadas, sin repetir", () => {
    const opts = opcionesDeCanales({
      numeros: [{ id: "canal-a", phone: "+54 11 0000-0001" }, { id: "canal-b", phone: null }],
      contactos: [
        { channel: "instagram", channel_account_id: null, business_phone: null, awaiting_reply: false },
        { channel: "whatsapp", channel_account_id: "canal-a", business_phone: "+54 11 0000-0001", awaiting_reply: false },
      ],
      nombres: { "canal-a": "Sucursal Centro" },
      guardadas: ["canal-a", "canal-vieja"],
    })
    expect(opts).toEqual([
      { key: "canal-a", label: "Sucursal Centro" },
      { key: "canal-b", label: "WhatsApp" },
      { key: "canal:instagram", label: "Instagram" },
      { key: "canal-vieja", label: "canal-vieja" },
    ])
  })
  it("una clave guardada de canal sin cuenta se rotula con el nombre del canal", () => {
    const opts = opcionesDeCanales({ numeros: [], contactos: [], nombres: {}, guardadas: ["canal:instagram"] })
    expect(opts).toEqual([{ key: "canal:instagram", label: "Instagram" }])
  })
})
