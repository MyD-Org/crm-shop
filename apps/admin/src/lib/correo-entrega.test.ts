import { describe, expect, it } from "vitest"
import { avisoDeEntrega } from "./correo-entrega"

describe("avisoDeEntrega", () => {
  it.each([
    ["bounced", "danger", "No entregado: la dirección no existe o rechazó el mensaje."],
    ["failed", "danger", "No entregado: no se pudo enviar el mensaje."],
    ["complained", "danger", "No entregado: el destinatario lo marcó como spam."],
    ["suppressed", "danger", "No entregado: la dirección está en la lista de supresión."],
    ["delivery_delayed", "warning", "Entrega demorada."],
  ])("%s", (evento, tono, texto) => {
    expect(avisoDeEntrega(evento)).toEqual({ tono, texto })
  })
  it("sin problema devuelve null", () => {
    for (const e of ["sent", "delivered", "opened", "clicked", "queued", "", null, undefined]) expect(avisoDeEntrega(e)).toBeNull()
  })
})
