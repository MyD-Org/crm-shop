import { describe, expect, it } from "vitest"
import { ESTADOS_PEDIDO } from "@/lib/pedidos-transiciones"
import {
  condicionIvaLabel,
  entregaLabel,
  fmtCantidad,
  fmtFechaPedido,
  fmtMoneda,
  pagoEstadoLabel,
  pagoMetodoLabel,
  revisionInfo,
  textoUltimoCambio,
  tituloRevision,
  tonoEstado,
  type DatosRevision,
} from "./format"

// Intl separa el símbolo del número con un espacio duro (U+00A0): se normaliza para comparar.
const plano = (s: string | null) => (s ?? "").replace(/\s/g, " ")

describe("fmtMoneda", () => {
  it("formatea pesos argentinos con dos decimales", () => {
    expect(plano(fmtMoneda(123456.7))).toBe("$ 123.456,70")
    expect(plano(fmtMoneda(0))).toBe("$ 0,00")
  })

  it("no revienta con un número inválido", () => {
    expect(fmtMoneda(Number.NaN)).toBe("—")
  })
})

describe("fmtFechaPedido", () => {
  it("usa SIEMPRE la hora de Argentina, no la del proceso (server UTC vs navegador -03)", () => {
    // 02:30 UTC del 22 = 23:30 del 21 en Buenos Aires: si faltara el timeZone, el server
    // (UTC) y el navegador darían días distintos y React marcaría hydration mismatch.
    expect(plano(fmtFechaPedido("2026-09-22T02:30:00.000Z"))).toBe("21/09/2026, 23:30")
  })

  it("no usa espacios raros (U+202F) que difieren entre Node y el navegador", () => {
    expect(fmtFechaPedido("2026-09-22T02:30:00.000Z")).not.toMatch(/ /)
  })

  it("devuelve una raya ante un ISO inválido o ausente", () => {
    expect(fmtFechaPedido("no-es-fecha")).toBe("—")
    expect(fmtFechaPedido(null)).toBe("—")
  })
})

describe("fmtCantidad", () => {
  it("muestra enteros sin decimales y fracciones con coma", () => {
    expect(fmtCantidad(3)).toBe("3")
    expect(fmtCantidad(1.5)).toBe("1,5")
    expect(fmtCantidad(1200)).toBe("1.200")
  })
})

describe("tonoEstado", () => {
  it("tiene un tono para cada uno de los 6 estados", () => {
    expect(ESTADOS_PEDIDO.map(tonoEstado)).toEqual([
      "warning",
      "info",
      "info",
      "info",
      "success",
      "danger",
    ])
  })
})

describe("etiquetas", () => {
  it("entrega: Retiro / Envío; lo desconocido se muestra crudo", () => {
    expect(entregaLabel("retiro")).toBe("Retiro")
    expect(entregaLabel("envio")).toBe("Envío")
    expect(entregaLabel("dron")).toBe("dron")
  })

  it("medio de pago: a_coordinar con la etiqueta del Shop; lo desconocido, crudo", () => {
    expect(pagoMetodoLabel("a_coordinar")).toBe("A coordinar con un asesor")
    expect(pagoMetodoLabel("transferencia")).toBe("Transferencia bancaria")
    expect(pagoMetodoLabel("cripto")).toBe("cripto")
    // Una clave heredada de Object.prototype no es un medio de pago.
    expect(pagoMetodoLabel("toString")).toBe("toString")
  })

  it("estado del pago", () => {
    expect(pagoEstadoLabel("pendiente")).toBe("Pago pendiente")
    expect(pagoEstadoLabel("pagado")).toBe("Pagado")
    expect(pagoEstadoLabel("fallido")).toBe("Pago rechazado")
    expect(pagoEstadoLabel("otro")).toBe("otro")
  })

  it("condición de IVA", () => {
    expect(condicionIvaLabel("responsable_inscripto")).toBe("Responsable inscripto")
    expect(condicionIvaLabel("consumidor_final")).toBe("Consumidor final")
    expect(condicionIvaLabel("monotributo")).toBe("Monotributo")
    expect(condicionIvaLabel("exento")).toBe("Exento")
    // Un valor que el Shop congeló tal cual de Alegra (no mapeado) se muestra sin traducir.
    expect(condicionIvaLabel("OTRO_VALOR")).toBe("OTRO_VALOR")
    expect(condicionIvaLabel(null)).toBe("—")
  })
})

describe("textoUltimoCambio", () => {
  it("por {nombre} el {fecha}", () => {
    expect(plano(textoUltimoCambio("Ana Pérez", "2026-09-22T02:30:00.000Z"))).toBe(
      "por Ana Pérez el 21/09/2026, 23:30",
    )
  })

  it("sin nombre sólo dice la fecha", () => {
    expect(plano(textoUltimoCambio(null, "2026-09-22T02:30:00.000Z"))).toBe("el 21/09/2026, 23:30")
  })

  it("sin fecha no hay nada que mostrar", () => {
    expect(textoUltimoCambio("Ana", null)).toBeNull()
  })
})

describe("revisionInfo (motivo_revision del Shop, 0010)", () => {
  const base: DatosRevision = {
    motivo: null,
    condicionIva: "monotributo",
    tipoDoc: "DNI",
    nroDoc: "12345678",
    listaPrecios: null,
  }

  it("documento_incompatible: condición, tipo y número del pedido (caso vinculado monotributo con DNI)", () => {
    const r = revisionInfo({ ...base, motivo: "documento_incompatible" })
    expect(r.titulo).toBe("Documento incompatible con la condición de IVA")
    expect(r.detalle).toBe(
      "La condición de IVA Monotributo requiere CUIT y el contacto tiene DNI 12345678 en Alegra. " +
        "Corrija el documento en Alegra antes de facturar.",
    )
    // No habla de "no vinculó su cuenta": el comprador SÍ vinculó.
    expect(r.detalle).not.toMatch(/vincul/)
  })

  it("condicion_iva_desconocida", () => {
    expect(revisionInfo({ ...base, motivo: "condicion_iva_desconocida" }).detalle).toBe(
      "La condición de IVA del contacto en Alegra no es una de las que maneja la tienda. Revísela antes de facturar.",
    )
  })

  it("facturacion_en_pedido", () => {
    expect(revisionInfo({ ...base, motivo: "facturacion_en_pedido" }).detalle).toBe(
      "Los datos de facturación que cargó el comprador no llegaron a Alegra (se guardaron sólo en el pedido). " +
        "Cárguelos en el contacto antes de facturar.",
    )
  })

  it("otra_lista_precios: con la lista del contacto y el aviso de no duplicar", () => {
    const r = revisionInfo({
      ...base,
      motivo: "otra_lista_precios",
      condicionIva: "consumidor_final",
      listaPrecios: "Mayorista",
    })
    expect(r.titulo).toBe("Cliente con otra lista de precios")
    expect(r.detalle).toBe(
      "El documento DNI 12345678 ya está registrado en Alegra con la lista de precios Mayorista, pero el " +
        "comprador compró a la lista general. Facture a ese contacto existente en lugar de crear uno nuevo, " +
        "y verifique si corresponde aplicarle su lista.",
    )
  })

  it("otra_lista_precios sin nombre de lista ⇒ 'con otra lista de precios'", () => {
    expect(revisionInfo({ ...base, motivo: "otra_lista_precios" }).detalle).toContain(
      "ya está registrado en Alegra con otra lista de precios, pero",
    )
  })

  it("pedido anterior a la 0010 (motivo NULL) o motivo desconocido ⇒ el texto genérico de siempre", () => {
    for (const motivo of [null, "algo_nuevo"]) {
      const r = revisionInfo({ ...base, motivo })
      expect(r.titulo).toBe("Revise el cliente antes de facturar")
      expect(r.detalle).toBe(
        "El documento DNI 12345678 ya está registrado en Alegra, pero el comprador no vinculó su cuenta y " +
          "compró a precio de lista. Facture a ese contacto existente en lugar de crear uno nuevo, y verifique " +
          "si corresponde aplicarle su lista de precios.",
      )
    }
  })

  it("sin documento en el pedido no deja huecos", () => {
    const sinDoc = { ...base, tipoDoc: null, nroDoc: null }
    expect(revisionInfo({ ...sinDoc, motivo: "documento_incompatible" }).detalle).toContain(
      "el contacto tiene un documento que no es CUIT en Alegra",
    )
    expect(revisionInfo({ ...sinDoc, motivo: null }).detalle).toMatch(/^El documento de facturación ya está/)
  })

  it("en usted: nada de voseo ni tuteo", () => {
    const motivos = [null, "documento_incompatible", "condicion_iva_desconocida", "facturacion_en_pedido", "otra_lista_precios"]
    for (const motivo of motivos) {
      const { titulo, detalle } = revisionInfo({ ...base, motivo })
      expect(`${titulo} ${detalle}`).not.toMatch(/\b(tu|tus|te|vos|revisá|cargá|corregí)\b/i)
    }
  })

  it("tituloRevision (tooltip del listado) coincide con el del aviso", () => {
    expect(tituloRevision("otra_lista_precios")).toBe("Cliente con otra lista de precios")
    expect(tituloRevision(null)).toBe("Revise el cliente antes de facturar")
    expect(tituloRevision("toString")).toBe("Revise el cliente antes de facturar")
  })
})
