import type {
  AlegraCategory,
  AlegraProduct,
  AlegraContact,
  AlegraPriceList,
  AlegraPaymentTerm,
  AlegraSeller,
  AlegraTax,
  AlegraCurrency,
  AlegraEstimate,
  AlegraEstimateInput,
  AlegraInvoice,
  AlegraInvoiceCreateInput,
  AlegraInvoiceCreated,
  AlegraNumberTemplate,
  AlegraPayment,
  AlegraItemCreateInput,
} from "./alegra"

// Fixtures para desarrollo sin credenciales de Alegra (alegraMock=true). Sirven tanto para la
// sync (poblar la cache) como para el endpoint live (precio/stock al momento). Ver ADR catálogo.

export const mockCategories: AlegraCategory[] = [
  { alegraId: "cat-led", name: "Iluminación LED", parentAlegraId: null, status: "active" },
  { alegraId: "cat-paneles", name: "Paneles y plafones", parentAlegraId: "cat-led", status: "active" },
  { alegraId: "cat-reflectores", name: "Reflectores", parentAlegraId: "cat-led", status: "active" },
  { alegraId: "cat-cables", name: "Cables", parentAlegraId: null, status: "active" },
  { alegraId: "cat-tableros", name: "Tableros y protección", parentAlegraId: null, status: "active" },
]

// Precios con dos listas (público / mayorista) para ejercitar el diseño flexible de varias listas.
function prices(publico: number, mayorista: number): AlegraProduct["prices"] {
  return [
    { idPriceList: "1", name: "Público", price: publico },
    { idPriceList: "2", name: "Mayorista", price: mayorista },
  ]
}

export const mockItems: AlegraProduct[] = [
  { alegraId: "it-1", code: "LED-12W-FRIA", name: "Lámpara LED 12W E27 luz fría", description: "Bajo consumo, 6500K", categoryAlegraId: "cat-led", prices: prices(1890, 1490), stock: 240, status: "active", images: [], brand: null, ivaPorcentaje: 21, raw: {} },
  { alegraId: "it-2", code: "LED-9W-CALIDA", name: "Lámpara LED 9W E27 luz cálida", description: "3000K", categoryAlegraId: "cat-led", prices: prices(1590, 1250), stock: 180, status: "active", images: [], brand: null, ivaPorcentaje: 21, raw: {} },
  { alegraId: "it-3", code: "PANEL-18W", name: "Panel LED 18W embutir redondo", description: "Plafón 22cm", categoryAlegraId: "cat-paneles", prices: prices(4290, 3490), stock: 60, status: "active", images: [], brand: null, ivaPorcentaje: 21, raw: {} },
  { alegraId: "it-4", code: "PANEL-48W", name: "Panel LED 48W 60x60 embutir", description: "Para cielorraso desmontable", categoryAlegraId: "cat-paneles", prices: prices(11900, 9900), stock: 25, status: "active", images: [], brand: null, ivaPorcentaje: 21, raw: {} },
  { alegraId: "it-5", code: "REFL-50W", name: "Reflector LED 50W exterior IP65", description: "Luz fría, alta potencia", categoryAlegraId: "cat-reflectores", prices: prices(9800, 7900), stock: 40, status: "active", images: [], brand: null, ivaPorcentaje: 21, raw: {} },
  { alegraId: "it-6", code: "REFL-100W", name: "Reflector LED 100W exterior IP65", description: "Para canchas y playas de estacionamiento", categoryAlegraId: "cat-reflectores", prices: prices(18900, 15500), stock: 12, status: "active", images: [], brand: null, ivaPorcentaje: 21, raw: {} },
  { alegraId: "it-7", code: "CAB-TALLER-2X075", name: "Cable taller 2x0.75mm (rollo 100m)", description: "Flexible, envainado", categoryAlegraId: "cat-cables", prices: prices(34500, 29900), stock: 8, status: "active", images: [], brand: null, ivaPorcentaje: 21, raw: {} },
  { alegraId: "it-8", code: "CAB-UNIP-2.5", name: "Cable unipolar 2.5mm (rollo 100m)", description: "Norma IRAM", categoryAlegraId: "cat-cables", prices: prices(41200, 35800), stock: 15, status: "active", images: [], brand: null, ivaPorcentaje: 21, raw: {} },
  { alegraId: "it-9", code: "TERM-2X16", name: "Termomagnética 2x16A", description: "Curva C", categoryAlegraId: "cat-tableros", prices: prices(8700, 6900), stock: 50, status: "active", images: [], brand: null, ivaPorcentaje: 21, raw: {} },
  { alegraId: "it-10", code: "DISY-2X25-30MA", name: "Disyuntor 2x25A 30mA", description: "Protección diferencial", categoryAlegraId: "cat-tableros", prices: prices(16400, 13200), stock: 22, status: "active", images: [], brand: null, ivaPorcentaje: 21, raw: {} },
]

const itemsById = new Map(mockItems.map((it) => [it.alegraId, it]))

/** Versión "en vivo" de un ítem del mock. Aplica un pequeño override opcional (process-local) para
 *  poder demostrar que el live difiere de la cache (ver ADR / verificación). */
const liveOverrides = new Map<string, Partial<AlegraProduct>>()
export function __setMockLiveOverride(alegraId: string, patch: Partial<AlegraProduct>) {
  liveOverrides.set(alegraId, patch)
}

export function getMockItemLive(alegraId: string): AlegraProduct | null {
  const base = itemsById.get(alegraId)
  if (!base) return null
  const patch = liveOverrides.get(alegraId)
  return patch ? { ...base, ...patch } : base
}

// ── Contactos ──

export const mockContacts: AlegraContact[] = [
  { alegraId: "ct-1", name: "Electricidad San Martín SRL", identification: "30712345678", email: "compras@proveedor.example", phone: "+54 11 4555-1234", priceListId: "2", sellerId: "sl-1", paymentTermId: "tm-30", status: "active", paymentTermName: "30 días", paymentTermDays: 30, priceListName: "Mayorista", sellerName: "Martín Gutiérrez", creditLimit: 2500000 },
  { alegraId: "ct-2", name: "Ferretería El Tornillo", identification: "20281234567", email: "eltornillo@correo.example", phone: "+54 223 495-8877", priceListId: "1", sellerId: "sl-2", paymentTermId: "tm-contado", status: "active", paymentTermName: "De contado", paymentTermDays: 0, priceListName: "Público", sellerName: "Laura Pérez", creditLimit: null },
  { alegraId: "ct-3", name: "Constructora Delta SA", identification: "30587654321", email: "proveedores@constructora.example", phone: "+54 11 4788-9900", priceListId: "2", sellerId: "sl-1", paymentTermId: "tm-60", status: "active", paymentTermName: "60 días", paymentTermDays: 60, priceListName: "Mayorista", sellerName: "Martín Gutiérrez", creditLimit: 8000000 },
  // Cuenta interna con un teléfono cargado por arrastre. Existe en las cuentas reales
  // ("Stock general", "NO USAR", "POS") y no es un cliente al que se le pueda atribuir un
  // pedido: la búsqueda por teléfono tiene que dejarla afuera.
  { alegraId: "ct-4", name: "Stock general", identification: null, email: null, phone: "+54 11 4788-9900", priceListId: "1", sellerId: null, paymentTermId: "tm-contado", status: "active", paymentTermName: "De contado", paymentTermDays: 0, priceListName: "Público", sellerName: null, creditLimit: null },
]

// ── Configuración de venta ──

export const mockPriceLists: AlegraPriceList[] = [
  { alegraId: "1", name: "Público", type: null, status: "active" },
  { alegraId: "2", name: "Mayorista", type: null, status: "active" },
]

export const mockPaymentTerms: AlegraPaymentTerm[] = [
  { alegraId: "tm-contado", name: "De contado", days: 0 },
  { alegraId: "tm-30", name: "30 días", days: 30 },
  { alegraId: "tm-60", name: "60 días", days: 60 },
]

export const mockSellers: AlegraSeller[] = [
  { alegraId: "sl-1", name: "Federico Cabeza", identification: null, status: "active" },
  { alegraId: "sl-2", name: "Vendedor Demo", identification: null, status: "active" },
]

// Shape real confirmado el 2026-09-27 contra la cuenta de Alegra Argentina (GET /taxes): id "1"
// IVA 21% activo, id "2" IVA 27% INACTIVO, id "3" IVA 10.5% activo, id "4" Exento de IVA (0%)
// activo. "Emitir factura" (rebanada C) mapea `order_items.iva_porcentaje` a uno de estos ids
// buscando el impuesto ACTIVO cuyo `percentage` coincide (0 → Exento).
export const mockTaxes: AlegraTax[] = [
  { alegraId: "1", name: "IVA 21%", percentage: 21, status: "active" },
  { alegraId: "2", name: "IVA 27%", percentage: 27, status: "inactive" },
  { alegraId: "3", name: "IVA 10.5%", percentage: 10.5, status: "active" },
  { alegraId: "4", name: "Exento de IVA", percentage: 0, status: "active" },
]

export const mockCurrencies: AlegraCurrency[] = [
  { code: "ARS", name: "Peso argentino", symbol: "$", exchangeRate: null },
  { code: "USD", name: "Dólar estadounidense", symbol: "US$", exchangeRate: 1480 },
]

// ── Cotizaciones (in-memory, process-local — suficiente para dev y tests) ──

const mockEstimates: AlegraEstimate[] = []
let nextEstimateId = 1

export function mockCreateEstimate(input: AlegraEstimateInput): AlegraEstimate {
  const contact = mockContacts.find((c) => c.alegraId === input.contactAlegraId)
  const items = input.items.map((it) => {
    const product = itemsById.get(it.alegraId)
    const listId = input.priceListId ?? contact?.priceListId ?? "1"
    const price = it.price ?? product?.prices.find((p) => p.idPriceList === listId)?.price ?? 0
    return {
      alegraId: it.alegraId,
      name: product?.name ?? it.alegraId,
      quantity: it.quantity,
      price,
      discount: it.discount ?? 0,
    }
  })
  const total = items.reduce((acc, it) => acc + it.price * it.quantity * (1 - it.discount / 100), 0)
  const estimate: AlegraEstimate = {
    alegraId: `est-${nextEstimateId}`,
    number: String(nextEstimateId),
    date: new Date().toISOString().slice(0, 10),
    dueDate: input.dueDate ?? null,
    clientAlegraId: input.contactAlegraId,
    clientName: contact?.name ?? "Cliente",
    status: "active",
    total: Math.round(total * 100) / 100,
    observations: input.observations ?? null,
    items,
  }
  nextEstimateId += 1
  mockEstimates.push(estimate)
  return estimate
}

export function mockListEstimates(): AlegraEstimate[] {
  return mockEstimates
}

export function mockDeleteEstimate(alegraId: string): void {
  const idx = mockEstimates.findIndex((e) => e.alegraId === alegraId)
  if (idx >= 0) mockEstimates.splice(idx, 1)
}

// ── Facturas y pagos (fixtures de la capa Alegra, ligados a mockContacts) ──
// Fechas en YYYY-MM-DD como Alegra. El portal en modo mock usa mock-data.ts (CLI001);
// estas fixtures ejercitan el cliente Alegra (listInvoicesByContact/PaymentsByContact).

const mockInvoices: AlegraInvoice[] = [
  { alegraId: "inv-1", number: "FV-1-00012876", date: "2026-05-28", dueDate: "2026-06-27", total: 98252, balance: 98252, status: "open", clientAlegraId: "ct-1" },
  { alegraId: "inv-2", number: "FV-1-00012588", date: "2026-04-22", dueDate: "2026-05-22", total: 151250, balance: 151250, status: "open", clientAlegraId: "ct-1" },
  { alegraId: "inv-3", number: "FV-1-00012390", date: "2026-03-28", dueDate: "2026-04-27", total: 90750, balance: 0, status: "closed", clientAlegraId: "ct-1" },
  { alegraId: "inv-4", number: "FV-1-00011045", date: "2026-05-10", dueDate: "2026-06-09", total: 42000, balance: 42000, status: "open", clientAlegraId: "ct-2" },
]

const mockPayments: AlegraPayment[] = [
  { alegraId: "pay-1", number: "RC-1-00000191", date: "2026-04-08", amount: 90750, method: "Transferencia", invoices: [{ invoiceAlegraId: "inv-3", invoiceNumber: "FV-1-00012390", amount: 90750 }] },
]

export function mockInvoicesByContact(contactAlegraId: string): AlegraInvoice[] {
  return mockInvoices.filter((i) => i.clientAlegraId === contactAlegraId)
}

/** Todas las facturas de las fixtures (para "Vincular factura" en modo mock). */
export function mockAllInvoices(): AlegraInvoice[] {
  return mockInvoices
}

export function mockPaymentsByContact(contactAlegraId: string): AlegraPayment[] {
  // Un pago pertenece al contacto si alguna factura imputada es suya.
  const contactInvoiceIds = new Set(mockInvoicesByContact(contactAlegraId).map((i) => i.alegraId))
  return mockPayments.filter((p) => p.invoices.some((inv) => contactInvoiceIds.has(inv.invoiceAlegraId)))
}

// ── Numeraciones (number templates) — "Emitir factura" (rebanada A) ──
// `documentType` no es parte de AlegraNumberTemplate (esa es la forma normalizada que ya
// filtró por tipo invoice): acá se mantiene porque `listNumberTemplates` en modo mock aplica
// el MISMO filtro documentType === "invoice" que aplicaría sobre el crudo real de Alegra,
// antes de mapear/exponer AlegraNumberTemplate.
export type MockNumberTemplate = AlegraNumberTemplate & { documentType: string }

export const mockNumberTemplates: MockNumberTemplate[] = [
  { alegraId: "1", name: "Factura A", prefix: "0001", subDocumentType: "INVOICE_A", isElectronic: false, status: "active", documentType: "invoice" },
  { alegraId: "2", name: "Factura B", prefix: "0002", subDocumentType: "INVOICE_B", isElectronic: false, status: "active", documentType: "invoice" },
  { alegraId: "3", name: "Factura C", prefix: "0003", subDocumentType: "INVOICE_C", isElectronic: false, status: "active", documentType: "invoice" },
  // Numeración de invoice dada de baja: sirve para testear que B/C (rebanada B) no la eligen.
  { alegraId: "4", name: "Factura A (punto de venta 2, dado de baja)", prefix: "0004", subDocumentType: "INVOICE_A", isElectronic: false, status: "inactive", documentType: "invoice" },
  // Numeración de otro tipo de documento: listNumberTemplates debe excluirla siempre.
  { alegraId: "18", name: "Presupuesto X", prefix: "00029", subDocumentType: "INVOICE_X", isElectronic: false, status: "active", documentType: "invoice" },
]

// ── Facturas creadas (createInvoice) — misma cola que lee mockAllInvoices() ──

let nextInvoiceId = 1000

export function mockCreateInvoice(input: AlegraInvoiceCreateInput): AlegraInvoiceCreated {
  const total = input.items.reduce((acc, it) => acc + it.price * it.quantity, 0)
  const id = `inv-${nextInvoiceId}`
  nextInvoiceId += 1
  const created: AlegraInvoice = {
    alegraId: id,
    number: String(nextInvoiceId - 1),
    date: new Date().toISOString().slice(0, 10),
    dueDate: null,
    total: Math.round(total * 100) / 100,
    balance: Math.round(total * 100) / 100,
    status: "open",
    clientAlegraId: input.contactAlegraId,
  }
  mockInvoices.push(created)
  return { alegraId: created.alegraId, number: created.number, date: created.date, total: created.total }
}

// ── Remitos (rebanada D: "Emitir remito" / "Vincular remito existente") ──
// Fixtures propias, sin relación con `mockInvoices`: remito y factura son documentos
// independientes en Alegra (ver el comentario de `createRemission` en alegra.ts).

interface MockRemision {
  alegraId: string
  numero: string | null
  fecha: string
  clienteAlegraId: string | null
  clienteNombre: string | null
}

const mockRemisiones: MockRemision[] = [
  { alegraId: "rem-1", numero: "0001-00000512", fecha: "2026-05-20", clienteAlegraId: "ct-1", clienteNombre: "Cliente Uno" },
]

/** Todos los remitos de las fixtures (para "Vincular remito existente" en modo mock). */
export function mockAllRemisiones(): MockRemision[] {
  return mockRemisiones
}

let nextRemisionId = 900

export function mockCreateRemission(input: {
  contactAlegraId: string
  items: { alegraId: string; quantity: number; description?: string }[]
  observations?: string
}): { alegraId: string; number: string | null; date: string } {
  const id = `rem-${nextRemisionId}`
  nextRemisionId += 1
  const created: MockRemision = {
    alegraId: id,
    numero: String(nextRemisionId - 1),
    fecha: new Date().toISOString().slice(0, 10),
    clienteAlegraId: input.contactAlegraId,
    clienteNombre: null,
  }
  mockRemisiones.push(created)
  return { alegraId: created.alegraId, number: created.numero, date: created.fecha }
}

// ── Ítems creados al facturar (D6) ──
// En mock no hay "cuentas": los ítems creados viven en memoria del proceso y `buscar` mira los del
// fixture y los creados. Para probar el multicuenta en serio, los tests inyectan las funciones.
const itemsCreados: AlegraProduct[] = []
let nextItemId = 5000

export function mockBuscarItemsPorCodigo(codigoNormalizado: string): AlegraProduct[] {
  return [...mockItems, ...itemsCreados].filter((it) => (it.code ?? "").trim().toLowerCase() === codigoNormalizado)
}

export function mockCreateItem(input: AlegraItemCreateInput): AlegraProduct {
  const creado: AlegraProduct = {
    alegraId: `it-${nextItemId++}`,
    code: input.code,
    name: input.name,
    description: null,
    categoryAlegraId: null,
    prices: [{ idPriceList: "1", name: "Público", price: input.price }],
    stock: 0,
    status: "active",
    images: [],
    brand: null,
    ivaPorcentaje: null,
    raw: {},
  }
  itemsCreados.push(creado)
  return creado
}
