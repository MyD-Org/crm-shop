import { describe, expect, it } from "vitest"
import { SECCIONES, SECCION_POR_CLAVE, seccionesVisibles } from "@/lib/secciones"

// El menú sale del catálogo de secciones (lib/secciones.ts): fija que "Pedidos" exista, admin+
// por defecto (el operador no la ve), sin `flag`, justo después de Mensajes.
describe("menú: entrada Pedidos", () => {
  const entrada = SECCION_POR_CLAVE.pedidos

  it("existe una sola vez, con la etiqueta Pedidos", () => {
    expect(SECCIONES.filter((s) => s.href === "/admin/pedidos")).toHaveLength(1)
    expect(entrada.label).toBe("Pedidos")
  })

  it("es admin+ por defecto y sin feature flag: el operador no la ve", () => {
    expect(entrada.rolMin).toBe("admin")
    expect(entrada.flag).toBeUndefined()
    expect(seccionesVisibles({ role: "operator" }, { compras: true, usagePanel: true })).not.toContain("pedidos")
  })

  it("va justo después de Mensajes", () => {
    expect(SECCIONES[0].clave).toBe("inbox")
    expect(SECCIONES[1].clave).toBe("pedidos")
  })
})
