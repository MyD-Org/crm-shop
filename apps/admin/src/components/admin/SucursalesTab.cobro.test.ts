import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ToastProvider } from "@myd-org/ui"
import { describe, expect, it, vi } from "vitest"
import type { SucursalDto } from "@/lib/sucursales-repo"
import {
  DESCRIPCION_CUENTA_ALEGRA,
  HINT_SUCURSAL_QUE_FACTURA,
  LEYENDA_COBRO_ZONAS,
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
        initialZonas: [],
        initialCuentas: { cuentas: [], asignaciones: {} },
        initialReceiptsEmail: "",
      }),
    ),
  )

describe("textos de cobro en Sucursales", () => {
  it("textos exactos de la spec", () => {
    expect(LEYENDA_COBRO_ZONAS).toBe(
      " La misma regla decide con qué cuenta de Mercado Pago y de Payway cobra la tienda: la del CUIT de la sucursal que factura.",
    )
    expect(HINT_SUCURSAL_QUE_FACTURA).toBe(
      "Solo si factura una cuenta distinta de la que despacha. Esa misma cuenta es la que cobra en Mercado Pago y Payway.",
    )
    expect(DESCRIPCION_CUENTA_ALEGRA).toBe(
      "La cuenta define de dónde se toma el stock de la sucursal y por cuál se factura. También decide con qué cuenta de Mercado Pago y de Payway se cobran los pedidos que esta sucursal factura. El token se guarda en el servidor y no se vuelve a mostrar.",
    )
  })

  it("Card «Zonas de venta» termina con la leyenda, con y sin sucursal predeterminada", () => {
    const con = render([sucursal({ predeterminada: true })])
    expect(con).toContain(
      "Las provincias sin zona se asignan a Iguazú (predeterminada)." + LEYENDA_COBRO_ZONAS,
    )
    const sin = render([sucursal({ predeterminada: false })])
    expect(sin).toContain("Las provincias sin zona se asignan a la sucursal predeterminada." + LEYENDA_COBRO_ZONAS)
  })

  it("el hint de «Sucursal que factura» y la descripción del diálogo de la cuenta usan los textos", () => {
    const fuente = readFileSync(new URL("./SucursalesTab.tsx", import.meta.url), "utf8")
    expect(fuente).toContain("hint={HINT_SUCURSAL_QUE_FACTURA}")
    expect(fuente).toContain("description={DESCRIPCION_CUENTA_ALEGRA}")
    // El copy viejo sin la mención al cobro ya no está.
    expect(fuente).not.toContain("Solo si factura una cuenta distinta de la que despacha.\"")
  })
})
