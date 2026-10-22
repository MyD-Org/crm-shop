import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ToastProvider } from "@myd-org/ui"
import { describe, expect, it, vi } from "vitest"
import type { SucursalDto } from "@/lib/sucursales-repo"
import {
  DESCRIPCION_CUENTA_ALEGRA,
  HINT_SUCURSAL_QUE_FACTURA,
} from "@/lib/sucursales-texto"
import { SucursalesTab } from "./SucursalesTab"

// Leyendas de la pestaña Sucursales sobre la cuenta de Mercado Pago / Payway (change
// `cuentas-procesador-por-sucursal`, R3): la misma regla que decide la cuenta de Alegra decide con
// qué cuenta de cobro vende la tienda. Texto en usted, exacto según la spec.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))

const sucursal = (over: Partial<SucursalDto>): SucursalDto => ({
  slug: "igz",
  nombre: "Iguazú",
  direccion: "Calle 1",
  ciudad: "Puerto Iguazú",
  provincia: "Misiones",
  whatsapp: "",
  emailPedidos: null,
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden: 1,
  activa: true,
  predeterminada: false,
  maestra: false,
  ...over,
})

const render = (sucursales: SucursalDto[]) =>
  renderToStaticMarkup(
    createElement(
      ToastProvider,
      null,
      createElement(SucursalesTab, {
        initialSucursales: sucursales,
        initialCuentas: { cuentas: [], asignaciones: {} },
        initialReceiptsEmail: "",
      }),
    ),
  )

describe("textos de cobro en Sucursales", () => {
  it("textos exactos de la spec", () => {
    expect(HINT_SUCURSAL_QUE_FACTURA).toBe(
      "Solo si factura una cuenta distinta de la que despacha. Esa misma cuenta es la que cobra en Mercado Pago y Payway.",
    )
    expect(DESCRIPCION_CUENTA_ALEGRA).toBe(
      "La cuenta define de dónde se toma el stock de la sucursal y por cuál se factura. También decide con qué cuenta de Mercado Pago y de Payway se cobran los pedidos que esta sucursal factura. El token se guarda en el servidor y no se vuelve a mostrar.",
    )
  })

  it("Sucursales ya no muestra las zonas: viven en Envíos", () => {
    const html = render([sucursal({ predeterminada: true })])
    expect(html).not.toContain("Zonas de venta")
    expect(html).toContain("se configura en Datos, Envíos")
  })

  it("el hint de «Sucursal que factura» y la descripción del diálogo de la cuenta usan los textos", () => {
    const fuente = readFileSync(new URL("./SucursalesTab.tsx", import.meta.url), "utf8")
    const envios = readFileSync(new URL("./EnviosSucursalesCard.tsx", import.meta.url), "utf8")
    expect(envios).toContain("{HINT_SUCURSAL_QUE_FACTURA}")
    expect(fuente).toContain("description={DESCRIPCION_CUENTA_ALEGRA}")
    // El copy viejo sin la mención al cobro ya no está.
    expect(fuente).not.toContain("Solo si factura una cuenta distinta de la que despacha.\"")
  })
})
