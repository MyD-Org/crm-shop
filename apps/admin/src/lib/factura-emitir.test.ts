import { describe, expect, it, vi } from "vitest"
import type { AlegraNumberTemplate, AlegraTax } from "./alegra"
import {
  armarLineasFactura,
  elegirImpuestoParaLinea,
  elegirNumeracionPorDefecto,
  puedeEmitir,
  resolverItemsAlegra,
  resolverPreviewEmision,
  tieneCuit,
  validarNumeracionElegida,
  type ResolverPreviewEmisionDeps,
} from "./factura-emitir"
import type { PedidoItemRow, PedidoRow } from "./pedidos-repo"

// Lógica pura de "Emitir factura" (preview, rebanada B): qué numeración sugerir, cómo armar las
// líneas y si se puede confirmar la emisión. Nada de esto toca Alegra. Datos inventados.

const pedido = (over: Partial<PedidoRow> = {}): PedidoRow =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    numero: 123,
    clienteCodigo: null,
    clienteEmail: "ana@cliente.example",
    contactoNombre: "Ana Compradora",
    facturacionTipoDoc: null,
    facturacionNroDoc: null,
    facturacionRazonSocial: null,
    requiereRevision: false,
    subtotal: "1000.00",
    iva: "210.00",
    costoEnvio: "0.00",
    total: "1210.00",
    ...over,
  }) as PedidoRow

const item = (over: Partial<PedidoItemRow> = {}): PedidoItemRow =>
  ({
    id: "22222222-2222-4222-8222-222222222222",
    orderId: "11111111-1111-4111-8111-111111111111",
    alegraItemId: "item-9",
    code: "SKU-9",
    name: "Lámpara de prueba",
    brand: null,
    qty: "2.000",
    precioUnitario: "500.00",
    ivaPorcentaje: "21.00",
    subtotal: "1000.00",
    iva: "210.00",
    total: "1210.00",
    ...over,
  }) as PedidoItemRow

const numeracion = (over: Partial<AlegraNumberTemplate> = {}): AlegraNumberTemplate => ({
  alegraId: "1",
  name: "Factura A",
  prefix: "0001",
  subDocumentType: "INVOICE_A",
  isElectronic: false,
  status: "active",
  ...over,
})

describe("tieneCuit", () => {
  it("CUIT con número no vacío → true", () => {
    expect(tieneCuit(pedido({ facturacionTipoDoc: "CUIT", facturacionNroDoc: "30712345678" }))).toBe(true)
  })

  it.each([
    ["DNI", "12345678"],
    ["otro", "X123"],
    ["CUIT", ""],
    ["CUIT", "   "],
    [null, null],
  ])("tipoDoc=%s nroDoc=%s → false", (tipoDoc, nroDoc) => {
    expect(
      tieneCuit(pedido({ facturacionTipoDoc: tipoDoc, facturacionNroDoc: nroDoc })),
    ).toBe(false)
  })

  it("pedido sin datos de facturación → false", () => {
    expect(tieneCuit(pedido({ facturacionTipoDoc: null, facturacionNroDoc: null }))).toBe(false)
  })
})

describe("elegirNumeracionPorDefecto", () => {
  const A = numeracion({ alegraId: "1", subDocumentType: "INVOICE_A", status: "active" })
  const AInactiva = numeracion({ alegraId: "1b", subDocumentType: "INVOICE_A", status: "inactive" })
  const B = numeracion({ alegraId: "2", subDocumentType: "INVOICE_B", status: "active" })
  const C = numeracion({ alegraId: "3", subDocumentType: "INVOICE_C", status: "active" })

  it("CUIT → primera INVOICE_A activa", () => {
    expect(elegirNumeracionPorDefecto([B, A, C], { tieneCuit: true })).toBe("1")
  })

  it("sin CUIT → primera INVOICE_B activa", () => {
    expect(elegirNumeracionPorDefecto([A, B, C], { tieneCuit: false })).toBe("2")
  })

  it("no hay ninguna del tipo default (activa o inexistente) → null, nunca cae a C", () => {
    expect(elegirNumeracionPorDefecto([B, C], { tieneCuit: true })).toBeNull()
    expect(elegirNumeracionPorDefecto([A, C], { tieneCuit: false })).toBeNull()
    expect(elegirNumeracionPorDefecto([], { tieneCuit: true })).toBeNull()
  })

  it("del tipo default mezclada con una inactiva del mismo tipo → toma la activa, no la inactiva", () => {
    expect(elegirNumeracionPorDefecto([AInactiva, A], { tieneCuit: true })).toBe("1")
  })

  it("sólo existe la inactiva del tipo default → null (no se ofrece una inactiva)", () => {
    expect(elegirNumeracionPorDefecto([AInactiva, B, C], { tieneCuit: true })).toBeNull()
  })
})

describe("armarLineasFactura", () => {
  it("mapea cada order_item a una línea, sin agregar una línea por costo_envio", () => {
    const { lineas, avisos } = armarLineasFactura([item()])
    expect(avisos).toEqual([])
    expect(lineas).toEqual([
      { alegraItemId: "item-9", nombre: "Lámpara de prueba", cantidad: 2, precioUnitario: 500, ivaPorcentaje: 21 },
    ])
  })

  it("varios ítems, cada uno su línea", () => {
    const { lineas } = armarLineasFactura([
      item({ alegraItemId: "a", name: "Uno", qty: "1.000" }),
      item({ alegraItemId: "b", name: "Dos", qty: "3.000" }),
    ])
    expect(lineas.map((l) => l.alegraItemId)).toEqual(["a", "b"])
    expect(lineas.map((l) => l.cantidad)).toEqual([1, 3])
  })

  it("ítem sin alegra_item_id → aviso bloqueante en vez de línea, sin lanzar excepción", () => {
    const { lineas, avisos } = armarLineasFactura([
      item({ alegraItemId: "", name: "Ítem roto" }),
      item({ alegraItemId: "ok-1", name: "Ítem sano" }),
    ])
    expect(lineas).toEqual([
      { alegraItemId: "ok-1", nombre: "Ítem sano", cantidad: 2, precioUnitario: 500, ivaPorcentaje: 21 },
    ])
    expect(avisos).toHaveLength(1)
    expect(avisos[0].motivo).toBe("item_sin_alegra_id")
    expect(avisos[0].detalle).toContain("Ítem roto")
  })

  it("alegra_item_id sólo con espacios → también aviso bloqueante", () => {
    const { lineas, avisos } = armarLineasFactura([item({ alegraItemId: "   " })])
    expect(lineas).toEqual([])
    expect(avisos).toHaveLength(1)
  })

  it("sin ítems → sin líneas ni avisos", () => {
    expect(armarLineasFactura([])).toEqual({ lineas: [], avisos: [] })
  })
})

describe("puedeEmitir", () => {
  it("pedido sin aviso de IVA → nunca bloquea, sin importar la numeración", () => {
    expect(puedeEmitir(pedido({ requiereRevision: false }), null).bloqueo).toBeNull()
    expect(puedeEmitir(pedido({ requiereRevision: false }), { subDocumentType: "INVOICE_A" }).bloqueo).toBeNull()
  })

  it("pedido con aviso de IVA y numeración A/B/C (o ninguna elegida) → bloquea", () => {
    const p = pedido({ requiereRevision: true })
    expect(puedeEmitir(p, null).bloqueo).not.toBeNull()
    expect(puedeEmitir(p, { subDocumentType: "INVOICE_A" }).bloqueo).not.toBeNull()
    expect(puedeEmitir(p, { subDocumentType: "INVOICE_B" }).bloqueo).not.toBeNull()
    expect(puedeEmitir(p, { subDocumentType: "INVOICE_C" }).bloqueo).not.toBeNull()
  })

  it('pedido con aviso de IVA pero numeración "Presupuesto X" (INVOICE_X) → exime el bloqueo', () => {
    const p = pedido({ requiereRevision: true })
    expect(puedeEmitir(p, { subDocumentType: "INVOICE_X" }).bloqueo).toBeNull()
  })

  it("el bloqueo trae motivo y detalle", () => {
    const { bloqueo } = puedeEmitir(pedido({ requiereRevision: true, motivoRevision: "documento_incompatible" }), null)
    expect(bloqueo).toMatchObject({ motivo: "documento_incompatible" })
    expect(bloqueo?.detalle).toMatch(/IVA/)
  })

  it('"otra lista de precios" es un aviso: no bloquea la emisión', () => {
    const p = pedido({ requiereRevision: true, motivoRevision: "otra_lista_precios" })
    expect(puedeEmitir(p, { subDocumentType: "INVOICE_B" }).bloqueo).toBeNull()
  })

  it("cada motivo que bloquea explica SU problema, no el del documento", () => {
    const motivo = (m: string | null) =>
      puedeEmitir(pedido({ requiereRevision: true, motivoRevision: m }), { subDocumentType: "INVOICE_B" }).bloqueo
    expect(motivo("condicion_iva_desconocida")).toMatchObject({ motivo: "condicion_iva_desconocida" })
    expect(motivo("condicion_iva_desconocida")?.detalle).not.toMatch(/Documento incompatible/)
    expect(motivo("facturacion_en_pedido")).toMatchObject({ motivo: "facturacion_en_pedido" })
    expect(motivo("facturacion_en_pedido")?.detalle).not.toMatch(/Documento incompatible/)
    expect(motivo(null)).toMatchObject({ motivo: "requiere_revision" })
    expect(motivo(null)?.detalle).not.toMatch(/Documento incompatible/)
  })
})

describe("resolverPreviewEmision", () => {
  const A = numeracion({ alegraId: "1", subDocumentType: "INVOICE_A", status: "active" })
  const B = numeracion({ alegraId: "2", subDocumentType: "INVOICE_B", status: "active" })
  const C = numeracion({ alegraId: "3", subDocumentType: "INVOICE_C", status: "active" })

  const TAX_21 = { alegraId: "1", name: "IVA 21%", percentage: 21, status: "active" } as AlegraTax

  function deps(over: Partial<ResolverPreviewEmisionDeps> = {}): ResolverPreviewEmisionDeps {
    return {
      listNumberTemplates: vi.fn(async () => [A, B, C]),
      findContactByIdentifier: vi.fn(async () => null),
      listTaxes: vi.fn(async () => [TAX_21]),
      ...over,
    }
  }

  it("pedido con cliente_codigo: usa ese contacto, esNuevo false, no llama findContactByIdentifier", async () => {
    const d = deps()
    const preview = await resolverPreviewEmision(pedido({ clienteCodigo: "ct-1" }), [item()], d)
    expect(preview.contacto).toEqual({ alegraId: "ct-1", esNuevo: false, nombre: "Ana Compradora" })
    expect(d.findContactByIdentifier).not.toHaveBeenCalled()
  })

  it("sin cliente_codigo y findContactByIdentifier encuentra: usa ese, esNuevo false", async () => {
    const d = deps({ findContactByIdentifier: vi.fn(async () => ({ alegraId: "ct-99" })) })
    const preview = await resolverPreviewEmision(
      pedido({ clienteCodigo: null, facturacionNroDoc: "20111222333" }),
      [item()],
      d,
    )
    expect(preview.contacto.alegraId).toBe("ct-99")
    expect(preview.contacto.esNuevo).toBe(false)
    expect(d.findContactByIdentifier).toHaveBeenCalledWith("20111222333")
  })

  it("sin cliente_codigo y no encuentra: alegraId null, esNuevo true", async () => {
    const d = deps()
    const preview = await resolverPreviewEmision(
      pedido({ clienteCodigo: null, facturacionNroDoc: "20111222333" }),
      [item()],
      d,
    )
    expect(preview.contacto).toEqual({ alegraId: null, esNuevo: true, nombre: "Ana Compradora" })
  })

  it("usa la razón social de facturación como nombre del contacto si está cargada", async () => {
    const preview = await resolverPreviewEmision(
      pedido({ clienteCodigo: "ct-1", facturacionRazonSocial: "Ana SRL" }),
      [item()],
      deps(),
    )
    expect(preview.contacto.nombre).toBe("Ana SRL")
  })

  it("numeraciones: filtra a INVOICE_* activas y sugiere según el receptor", async () => {
    const inactivaA = numeracion({ alegraId: "1b", subDocumentType: "INVOICE_A", status: "inactive" })
    const otroTipo = numeracion({ alegraId: "9", subDocumentType: "OTRO", status: "active" })
    const d = deps({ listNumberTemplates: vi.fn(async () => [A, B, C, inactivaA, otroTipo]) })
    const preview = await resolverPreviewEmision(
      pedido({ facturacionTipoDoc: "CUIT", facturacionNroDoc: "30712345678" }),
      [item()],
      d,
    )
    expect(preview.numeraciones.map((n) => n.alegraId).sort()).toEqual(["1", "2", "3"])
    expect(preview.numeracionSugeridaId).toBe("1")
  })

  it("pedido con requiereRevision: bloqueo presente, pero igual arma líneas y numeraciones", async () => {
    const preview = await resolverPreviewEmision(pedido({ requiereRevision: true }), [item()], deps())
    expect(preview.bloqueo).not.toBeNull()
    expect(preview.lineas).toHaveLength(1)
    expect(preview.numeraciones).toHaveLength(3)
  })

  it("total: suma de líneas con IVA, sin envío; totalPedido = subtotal + iva del pedido", async () => {
    const preview = await resolverPreviewEmision(pedido({ subtotal: "1000.00", iva: "210.00" }), [item()], deps())
    expect(preview.total).toBe(1210)
    expect(preview.totalPedido).toBe(1210)
    expect(preview.avisos).toEqual([])
  })

  it("ítem sin alegra_item_id: aviso bloqueante viaja en `avisos` del preview", async () => {
    const preview = await resolverPreviewEmision(pedido(), [item({ alegraItemId: "" })], deps())
    expect(preview.lineas).toEqual([])
    expect(preview.avisos.some((a) => a.motivo === "item_sin_alegra_id")).toBe(true)
  })

  it("diferencia de total > $1 entre líneas y pedido → aviso bloqueante adicional", async () => {
    // El pedido dice 1210 pero el único ítem, sin IVA cargado, sólo suma 1000: diferencia de 210.
    const preview = await resolverPreviewEmision(
      pedido({ subtotal: "1000.00", iva: "210.00" }),
      [item({ ivaPorcentaje: "0.00" })],
      deps(),
    )
    expect(preview.total).toBe(1000)
    expect(preview.totalPedido).toBe(1210)
    expect(preview.avisos.some((a) => a.motivo === "diferencia_total")).toBe(true)
  })

  it("diferencia de hasta $1 no dispara el aviso (tolerancia de redondeo)", async () => {
    const preview = await resolverPreviewEmision(
      pedido({ subtotal: "1000.00", iva: "210.50" }),
      [item()],
      deps(),
    )
    expect(preview.avisos.some((a) => a.motivo === "diferencia_total")).toBe(false)
  })

  it("línea sin impuesto que coincida en /taxes: aviso bloqueante 'impuesto_sin_mapear'", async () => {
    // El ítem tiene 27% de IVA pero listTaxes sólo devuelve el 21% activo.
    const preview = await resolverPreviewEmision(pedido(), [item({ ivaPorcentaje: "27.00" })], deps())
    expect(preview.avisos.some((a) => a.motivo === "impuesto_sin_mapear")).toBe(true)
  })
})

// ───────────────────────── Impuestos por línea (rebanada C) ─────────────────────────

describe("elegirImpuestoParaLinea", () => {
  const IVA_21 = { alegraId: "1", name: "IVA 21%", percentage: 21, status: "active" } as AlegraTax
  const IVA_27_INACTIVO = { alegraId: "2", name: "IVA 27%", percentage: 27, status: "inactive" } as AlegraTax
  const IVA_105 = { alegraId: "3", name: "IVA 10.5%", percentage: 10.5, status: "active" } as AlegraTax
  const EXENTO = { alegraId: "4", name: "Exento de IVA", percentage: 0, status: "active" } as AlegraTax
  const taxes = [IVA_21, IVA_27_INACTIVO, IVA_105, EXENTO]

  it("encuentra el impuesto activo con el porcentaje exacto", () => {
    expect(elegirImpuestoParaLinea(taxes, 21)).toEqual(IVA_21)
    expect(elegirImpuestoParaLinea(taxes, 10.5)).toEqual(IVA_105)
  })

  it("0% mapea al impuesto Exento", () => {
    expect(elegirImpuestoParaLinea(taxes, 0)).toEqual(EXENTO)
  })

  it("ignora un impuesto inactivo aunque el porcentaje coincida", () => {
    expect(elegirImpuestoParaLinea(taxes, 27)).toBeNull()
  })

  it("sin ningún impuesto que coincida, null", () => {
    expect(elegirImpuestoParaLinea(taxes, 5)).toBeNull()
  })

  it("tolera el error de punto flotante (20.999999999999996 ~ 21)", () => {
    expect(elegirImpuestoParaLinea(taxes, 0.07 * 300)).toEqual(IVA_21)
  })
})

describe("resolverItemsAlegra", () => {
  const IVA_21 = { alegraId: "1", name: "IVA 21%", percentage: 21, status: "active" } as AlegraTax

  it("mapea cada línea a AlegraInvoiceLineInput con price NETO y el tax resuelto", () => {
    const linea = { alegraItemId: "it-1", nombre: "Lámpara", cantidad: 2, precioUnitario: 500, ivaPorcentaje: 21 }
    const { items, avisos } = resolverItemsAlegra([linea], [IVA_21])
    expect(items).toEqual([{ alegraId: "it-1", quantity: 2, price: 500, tax: [{ id: "1" }] }])
    expect(avisos).toEqual([])
  })

  it("línea sin impuesto que coincida: aviso bloqueante, sin agregar el item", () => {
    const linea = { alegraItemId: "it-1", nombre: "Lámpara", cantidad: 2, precioUnitario: 500, ivaPorcentaje: 27 }
    const { items, avisos } = resolverItemsAlegra([linea], [IVA_21])
    expect(items).toEqual([])
    expect(avisos).toEqual([
      {
        motivo: "impuesto_sin_mapear",
        detalle:
          'El ítem "Lámpara" tiene IVA 27% y no hay un impuesto activo con ese porcentaje ' +
          "en la cuenta de Alegra. Revise los impuestos de la cuenta antes de emitir.",
      },
    ])
  })
})

describe("validarNumeracionElegida", () => {
  const A = numeracion({ alegraId: "1", subDocumentType: "INVOICE_A", status: "active" })
  const A_INACTIVA = numeracion({ alegraId: "4", subDocumentType: "INVOICE_A", status: "inactive" })
  const numeraciones = [A, A_INACTIVA]

  it("id presente, activo y de tipo invoice → true", () => {
    expect(validarNumeracionElegida("1", numeraciones)).toBe(true)
  })

  it("id inactivo → false", () => {
    expect(validarNumeracionElegida("4", numeraciones)).toBe(false)
  })

  it("id inexistente → false", () => {
    expect(validarNumeracionElegida("999", numeraciones)).toBe(false)
  })
})
