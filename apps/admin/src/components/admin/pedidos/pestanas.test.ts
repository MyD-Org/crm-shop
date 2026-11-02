import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { PESTANAS_PEDIDOS, pestanaValida, urlConPestana } from "./pestanas"

const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

describe("pestañas de Pedidos", () => {
  it("son tres, con las etiquetas pedidas y en orden", () => {
    expect(PESTANAS_PEDIDOS.map((p) => p.label)).toEqual(["Pedidos", "Carritos abandonados", "Intentos de pago"])
  })

  it("?tab= inválido o deshabilitado cae en Pedidos", () => {
    expect(pestanaValida("intentos")).toBe("intentos")
    expect(pestanaValida("carritos")).toBe("carritos")
    expect(pestanaValida("zzz")).toBe("pedidos")
    expect(pestanaValida(null)).toBe("pedidos")
    expect(pestanaValida(undefined)).toBe("pedidos")
    expect(pestanaValida("carritos", ["pedidos", "intentos"])).toBe("pedidos")
  })

  it("la URL conserva el resto de los parámetros y Pedidos quita ?tab=", () => {
    expect(urlConPestana("http://x.example/admin/pedidos", "intentos")).toBe("/admin/pedidos?tab=intentos")
    expect(urlConPestana("http://x.example/admin/pedidos?tab=intentos&otro=1", "pedidos")).toBe("/admin/pedidos?otro=1")
    expect(urlConPestana("/admin/pedidos?tab=intentos", "carritos")).toBe("/admin/pedidos?tab=carritos")
  })
})

describe("PedidosPestanas: fuente", () => {
  const fuente = leer("./PedidosPestanas.tsx")

  it("usa Tabs del DS y no pisa estilos del DS con className", () => {
    expect(fuente).toMatch(/import \{[^}]*\bTabs\b[^}]*\} from "@myd-org\/ui"/)
    const tabs = fuente.match(/<Tabs[\s\S]*?\/>/)?.[0] ?? ""
    expect(tabs).not.toContain("className")
    expect(tabs).not.toContain("listClassName")
  })

  it("no agrega entradas al menú: Pedidos sigue siendo una sola entrada del sidebar", () => {
    const shell = leer("../AdminShell.tsx")
    expect(shell.split("\n").filter((l) => l.includes("Carritos abandonados") || l.includes("Intentos de pago"))).toEqual([])
  })

  it("el panel de Pedidos queda siempre montado (oculto con hidden), los demás se montan al primer uso", () => {
    expect(fuente).toContain('hidden={activa !== "pedidos"}')
    expect(fuente).toContain('vistas.has("intentos")')
    expect(fuente).toContain('vistas.has("carritos")')
  })

  it("las tres pestañas quedan habilitadas en la página (sin recorte de `pestanas`)", () => {
    const pagina = leer("../../../app/admin/(protected)/pedidos/page.tsx")
    expect(pagina).not.toContain("pestanas=")
    expect(fuente).toContain("CarritosAbandonadosShell")
    expect(fuente).toContain("IntentosPagoShell")
  })

  it("la página Pedidos exige admin+ antes de armar las pestañas", () => {
    const pagina = leer("../../../app/admin/(protected)/pedidos/page.tsx")
    expect(pagina).toContain('roleRank(guard.user.role) < roleRank("admin")) notFound()')
    expect(pagina).toContain("PedidosPestanas")
  })
})
