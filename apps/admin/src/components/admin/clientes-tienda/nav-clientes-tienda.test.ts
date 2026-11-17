import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SECCIONES, SECCION_POR_CLAVE, seccionesVisibles } from "@/lib/secciones"

// El menú sale del catálogo de secciones (lib/secciones.ts): fija que "Clientes de la tienda"
// exista, admin+ por defecto (el operador no la ve), sin `flag`, justo después de Catálogo.
const fuente = readFileSync(fileURLToPath(new URL("../AdminShell.tsx", import.meta.url)), "utf8")

describe("menú: entrada Clientes de la tienda", () => {
  const entrada = SECCION_POR_CLAVE["clientes-tienda"]

  it("existe una sola vez, con la etiqueta y el ícono UserRound", () => {
    expect(SECCIONES.filter((s) => s.href === "/admin/clientes-tienda")).toHaveLength(1)
    expect(entrada.label).toBe("Clientes de la tienda")
    expect(fuente).toMatch(/"clientes-tienda": <UserRound /)
  })

  it("es admin+ por defecto y sin feature flag: el operador no la ve", () => {
    expect(entrada.rolMin).toBe("admin")
    expect(entrada.flag).toBeUndefined()
    expect(seccionesVisibles({ role: "operator" }, { compras: true, usagePanel: true })).not.toContain("clientes-tienda")
  })

  it("va en el grupo Datos, justo después de Catálogo", () => {
    expect(entrada.grupo).toBe("Datos")
    const i = SECCIONES.findIndex((s) => s.clave === "catalogo")
    expect(SECCIONES[i + 1].clave).toBe("clientes-tienda")
  })
})
