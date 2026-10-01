import { describe, it, expect } from "vitest"
import {
  CANAL_TODAS,
  buildCanalTabs,
  canalKey,
  canalesEditables,
  filterByCanal,
  parseNombresBody,
  parseWhatsappNumbers,
  resolveSelected,
  type CanalContacto,
} from "./inbox-canales"

const c = (o: Partial<CanalContacto>): CanalContacto => ({
  channel: "whatsapp",
  channel_account_id: null,
  business_phone: null,
  awaiting_reply: false,
  ...o,
})

describe("canalKey", () => {
  it("usa la cuenta; sin cuenta, el canal", () => {
    expect(canalKey(c({ channel_account_id: "acc-1" }))).toBe("acc-1")
    expect(canalKey(c({ channel: "instagram" }))).toBe("canal:instagram")
  })
})

describe("buildCanalTabs", () => {
  const contacts = [
    c({ channel_account_id: "a", business_phone: "+54 9 11 0000-0000", awaiting_reply: true }),
    c({ channel_account_id: "a", business_phone: "+54 9 11 0000-0000", awaiting_reply: true }),
    c({ channel_account_id: "b", business_phone: "+54 9 11 0000-0001" }),
    c({ channel: "instagram" }),
  ]

  it("una solapa por canal, con teléfono o nombre del canal y conteo de pendientes", () => {
    expect(buildCanalTabs(contacts, {})).toEqual([
      { key: "a", label: "+54 9 11 0000-0000", pending: 2 },
      { key: "b", label: "+54 9 11 0000-0001", pending: 0 },
      { key: "canal:instagram", label: "Instagram", pending: 0 },
    ])
  })

  it("el nombre del admin gana sobre el teléfono; vacío o espacios no cuentan", () => {
    const tabs = buildCanalTabs(contacts, { a: "Sucursal Centro", b: "   " })
    expect(tabs.map((t) => t.label)).toEqual(["Sucursal Centro", "+54 9 11 0000-0001", "Instagram"])
  })

  it("un solo canal da una sola solapa (la UI oculta la fila)", () => {
    expect(buildCanalTabs([c({ channel_account_id: "a" })], {})).toHaveLength(1)
  })
})

describe("filterByCanal / resolveSelected", () => {
  const contacts = [c({ channel_account_id: "a" }), c({ channel_account_id: "b" }), c({ channel: "instagram" })]
  it("filtra por clave y 'all' deja todo", () => {
    expect(filterByCanal(contacts, CANAL_TODAS)).toHaveLength(3)
    expect(filterByCanal(contacts, "b")).toHaveLength(1)
    expect(filterByCanal(contacts, "canal:instagram")).toHaveLength(1)
  })
  it("una selección que ya no existe vuelve a Todas", () => {
    const tabs = buildCanalTabs(contacts, {})
    expect(resolveSelected("b", tabs)).toBe("b")
    expect(resolveSelected("zzz", tabs)).toBe(CANAL_TODAS)
  })
})

describe("parseWhatsappNumbers / canalesEditables", () => {
  it("acepta lista o {numbers} y descarta lo ilegible", () => {
    const item = { id: "a", business_phone: "+54 9 11 0000-0000" }
    expect(parseWhatsappNumbers([item, null, { x: 1 }])).toEqual([{ id: "a", phone: "+54 9 11 0000-0000" }])
    expect(parseWhatsappNumbers({ numbers: [item] })).toHaveLength(1)
    expect(parseWhatsappNumbers("nada")).toEqual([])
  })
  it("une números de ai-api con los canales de los contactos sin duplicar", () => {
    const r = canalesEditables(
      [c({ channel_account_id: "a", business_phone: "+54 9 11 0000-0000" }), c({ channel: "instagram" })],
      [{ id: "a", phone: null }, { id: "z", phone: "+54 9 11 0000-0002" }],
    )
    expect(r).toEqual([
      { key: "a", referencia: "+54 9 11 0000-0000" },
      { key: "z", referencia: "+54 9 11 0000-0002" },
      { key: "canal:instagram", referencia: "Instagram" },
    ])
  })
})

describe("parseNombresBody", () => {
  it("recorta y acepta vacíos", () => {
    expect(parseNombresBody({ nombres: { a: "  Centro ", b: "" } })).toEqual({ ok: true, nombres: { a: "Centro", b: "" } })
  })
  it("rechaza formas inválidas y nombres largos", () => {
    expect(parseNombresBody(null).ok).toBe(false)
    expect(parseNombresBody({ nombres: [] }).ok).toBe(false)
    expect(parseNombresBody({ nombres: { a: 1 } }).ok).toBe(false)
    expect(parseNombresBody({ nombres: { a: "x".repeat(61) } }).ok).toBe(false)
  })
})
