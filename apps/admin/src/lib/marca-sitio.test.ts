import { describe, expect, it } from "vitest"
import { marcaParaSitio } from "@/lib/marca-sitio"

// Marca de los mails de pedido según el sitio donde se compró. Datos ficticios, dominios .example.

const tenant = {
  id: "tenant-b",
  name: "Empresa Central",
  logoPath: "https://cliente.example/logo-central.png",
  resendFrom: "ventas@cliente.example",
  shopUrl: "https://cliente.example",
  shopDestinosExtra: [
    {
      etiqueta: "tienda-b",
      url: "https://tienda-b.example",
      marca: { nombre: "Tienda B", logoMailUrl: "https://tienda-b.example/logo-mail.png" },
      remitente: "pedidos@tienda-b.example",
    },
    { etiqueta: "alias", url: "https://alias.example" },
    { etiqueta: "sin-logo", url: "https://sin-logo.example", marca: { nombre: "Sin Logo" } },
    {
      etiqueta: "logo-feo",
      url: "https://logo-feo.example",
      marca: { nombre: "Logo Feo", logoMailUrl: "javascript:alert(1)" },
    },
  ],
}

describe("marcaParaSitio", () => {
  it("sitio propio: su nombre, su remitente y su logo de mail", () => {
    expect(marcaParaSitio(tenant, "https://tienda-b.example")).toEqual({
      name: "Tienda B",
      resendFrom: "pedidos@tienda-b.example",
      logoUrl: "https://tienda-b.example/logo-mail.png",
    })
  })

  it("sitio propio sin remitente: conserva el del tenant", () => {
    const r = marcaParaSitio(tenant, "https://sin-logo.example")
    expect(r.name).toBe("Sin Logo")
    expect(r.resendFrom).toBe("ventas@cliente.example")
  })

  it("sitio propio sin logo de mail (o inseguro): null, nunca el de Central", () => {
    expect(marcaParaSitio(tenant, "https://sin-logo.example").logoUrl).toBeNull()
    expect(marcaParaSitio(tenant, "https://logo-feo.example").logoUrl).toBeNull()
  })

  it("alias, principal, sitio desconocido o null: lo de siempre", () => {
    const base = { name: "Empresa Central", resendFrom: "ventas@cliente.example", logoUrl: "https://cliente.example/logo-central.png" }
    expect(marcaParaSitio(tenant, "https://alias.example")).toEqual(base)
    expect(marcaParaSitio(tenant, "https://cliente.example")).toEqual(base)
    expect(marcaParaSitio(tenant, "https://ajeno.example")).toEqual(base)
    expect(marcaParaSitio(tenant, null)).toEqual(base)
    expect(marcaParaSitio(tenant, undefined)).toEqual(base)
  })

  it("el origen se compara normalizado (barra final, mayúsculas)", () => {
    expect(marcaParaSitio(tenant, "https://TIENDA-B.example/").name).toBe("Tienda B")
  })
})
