import { describe, expect, it } from "vitest"
import {
  buscarConversacion, esAdjuntoDeDatos, inicial, mapsUrl, numeroDelContacto, telefonoVisible,
} from "./tarjetas-adjunto"

describe("tarjetas de adjunto", () => {
  it("contacto y ubicación son adjuntos de datos; un archivo no", () => {
    expect(esAdjuntoDeDatos({ id: "c", kind: "contacts", contacts: [] })).toBe(true)
    expect(esAdjuntoDeDatos({ id: "l", kind: "location", location: { latitude: 1, longitude: 2 } })).toBe(true)
    expect(esAdjuntoDeDatos({ id: "a", kind: "audio", mime: "audio/ogg", size_bytes: 1, url: null })).toBe(false)
  })

  it("el número sale del wa_id y si no, de los dígitos del teléfono", () => {
    expect(numeroDelContacto({ phones: [{ phone: "+54 9 223 668-0026", waId: "5492236680026" }] })).toBe("5492236680026")
    expect(numeroDelContacto({ phones: [{ phone: "+54 9 223 668-0026" }] })).toBe("5492236680026")
    expect(numeroDelContacto({ phones: [] })).toBeNull()
  })

  it("teléfono visible e inicial", () => {
    expect(telefonoVisible({ waId: "5491100001111" })).toBe("+5491100001111")
    expect(telefonoVisible({ phone: "+54 11 0000-1111", waId: "5491100001111" })).toBe("+54 11 0000-1111")
    expect(inicial({ name: "bruno", phones: [] })).toBe("B")
    expect(inicial({ phones: [] })).toBe("?")
  })

  it("busca la conversación del número, prefiriendo el canal del hilo", () => {
    const contacts = [
      { phone: "5492236680026", channel_account_id: "otro", end_user_id: "u1" },
      { phone: "+54 9 223 668-0026", channel_account_id: "este", end_user_id: "u2" },
      { phone: "5491100001111", channel_account_id: "este", end_user_id: "u3" },
    ]
    expect(buscarConversacion(contacts, "5492236680026", "este")?.end_user_id).toBe("u2")
    expect(buscarConversacion(contacts, "5492236680026", "ninguno")?.end_user_id).toBe("u1")
    expect(buscarConversacion(contacts, "5490000000000", "este")).toBeNull()
  })

  it("link a Maps por coordenadas", () => {
    expect(mapsUrl({ latitude: -38, longitude: -57.5 })).toBe("https://www.google.com/maps?q=-38,-57.5")
  })
})
