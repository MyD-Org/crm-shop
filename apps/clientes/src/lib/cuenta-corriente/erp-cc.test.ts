import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";
import type { ContactoEspejo } from "../contactos-espejo";

/**
 * Mapeos y lecturas de la cuenta corriente. La matriz de estados y los casos de
 * borradores están copiados de apps/admin/src/lib/erp-facturas.test.ts y del
 * mapeo de apps/admin/src/lib/erp.ts: si el portal del CRM cambia una regla,
 * este test es el que avisa que el Shop quedó distinto.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

const state = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  total: 0,
  abiertas: [] as Record<string, unknown>[],
  contacto: null as ContactoEspejo | null,
}));

vi.mock("./alegra-cc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./alegra-cc")>()),
  listInvoicesPageByContact: async () => ({ items: state.items, total: state.total }),
  listOpenInvoicesByContact: async () => state.abiertas,
}));
const contactoPorId = vi.hoisted(() => vi.fn());
vi.mock("../contactos-espejo", () => ({
  contactoPorId: (...a: unknown[]) => {
    contactoPorId(...a);
    return Promise.resolve(state.contacto);
  },
}));

import {
  ContactoNoEncontradoError,
  facturaEstado,
  getCondiciones,
  getCuenta,
  getFacturasPage,
  mapEstimate,
  mapPayment,
  muestraLimite,
  presupuestoEstado,
} from "./erp-cc";

const HOY = "2026-09-23";

const CONTACTO: ContactoEspejo = {
  alegraId: "42",
  nombre: "Cliente Uno SA",
  identificacion: "20-12345678-9",
  email: "compras@cliente.example",
  tipoCuenta: "corriente",
  listaPrecios: "Mayorista",
  vendedor: "Vendedor Uno",
  plazoNombre: "30 días",
  plazoDias: 30,
  limiteCredito: 1_000_000,
  origen: "espejo",
};

const factura = (id: string, status: string, balance = 0, dueDate = "2026-09-30") => ({
  alegraId: id,
  date: "2026-09-01",
  dueDate,
  total: 1000,
  balance,
  number: null,
  clientAlegraId: "42",
  status,
});

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T15:00:00Z"));
  state.items = [];
  state.total = 0;
  state.abiertas = [];
  state.contacto = CONTACTO;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("facturaEstado (FAC-4)", () => {
  it.each([
    [{ status: "open", balance: 100, dueDate: "2026-09-01" }, "vencida"],
    [{ status: "open", balance: 100, dueDate: "2026-09-30" }, "pendiente"],
    [{ status: "open", balance: 100, dueDate: null }, "pendiente"],
    [{ status: "open", balance: 100, dueDate: HOY }, "pendiente"],
    [{ status: "open", balance: 0, dueDate: "2026-09-22" }, "pagada"],
    [{ status: "closed", balance: 0, dueDate: "2026-09-01" }, "pagada"],
    [{ status: "void", balance: 100, dueDate: "2026-09-01" }, "anulada"],
    [{ status: "void", balance: 0, dueDate: null }, "anulada"],
  ])("%o ⇒ %s", (inv, esperado) => {
    expect(facturaEstado(inv, HOY)).toBe(esperado);
  });
});

describe("presupuestoEstado", () => {
  it.each([
    [{ status: "billed", dueDate: "2026-01-01" }, "aceptado"],
    [{ status: "unbilled", dueDate: "2026-01-01" }, "vencido"],
    [{ status: "unbilled", dueDate: "2026-12-01" }, "vigente"],
    [{ status: "unbilled", dueDate: null }, "vigente"],
  ])("%o ⇒ %s", (e, esperado) => {
    expect(presupuestoEstado(e, HOY)).toBe(esperado);
  });
});

describe("mapPayment (PAG-2: imputaciones)", () => {
  it("pago de 300 imputado 200 a F1 y 100 a F2", () => {
    const p = mapPayment({
      alegraId: "55",
      number: "RC-0001",
      date: "2026-09-10",
      amount: 300,
      method: "Transferencia",
      invoices: [
        { invoiceAlegraId: "1", invoiceNumber: "F1", amount: 200 },
        { invoiceAlegraId: "2", invoiceNumber: null, amount: 100 },
      ],
    });
    expect(p).toEqual({
      id: "RC-0001",
      alegraId: "55",
      fecha: "10/09/2026",
      medio: "Transferencia",
      monto: 300,
      // Sin número legible, el id de Alegra (igual que el portal).
      facturas: [
        { factura: "F1", imputado: 200 },
        { factura: "2", imputado: 100 },
      ],
    });
  });

  it("sin número: el id de Alegra", () => {
    const p = mapPayment({ alegraId: "56", number: null, date: "2026-09-11", amount: 1, method: "", invoices: [] });
    expect(p.id).toBe("56");
    expect(p.facturas).toEqual([]);
  });
});

describe("mapEstimate", () => {
  it("fechas en DD/MM/YYYY y estado según hoy", () => {
    const e = mapEstimate(
      { alegraId: "7", number: "P-7", date: "2026-08-01", dueDate: "2026-09-01", clientAlegraId: "42", status: "unbilled", total: 900 },
      HOY,
    );
    expect(e).toEqual({ id: "P-7", alegraId: "7", fecha: "01/08/2026", validoHasta: "01/09/2026", total: 900, estado: "vencido" });
  });
});

describe("getFacturasPage: borradores (copiado de erp-facturas.test.ts)", () => {
  it("un solo borrador: sin facturas y total 0", async () => {
    state.items = [factura("1", "draft")];
    state.total = 1;
    expect(await getFacturasPage("42")).toEqual({ facturas: [], total: 0 });
  });

  it("descuenta del total los borradores escondidos en la ventana", async () => {
    state.items = [factura("1", "open", 1000), factura("2", "draft"), factura("3", "closed")];
    state.total = 3;
    const page = await getFacturasPage("42");
    expect(page.facturas).toHaveLength(2);
    expect(page.total).toBe(2);
  });

  it("sin borradores el total es el de Alegra", async () => {
    state.items = [factura("1", "open", 1000)];
    state.total = 40;
    expect((await getFacturasPage("42")).total).toBe(40);
  });

  it("mapea número, fechas DD/MM/YYYY y pagado", async () => {
    state.items = [{ ...factura("7", "open", 400), number: "A-0001-00000123" }];
    state.total = 1;
    const [f] = (await getFacturasPage("42")).facturas;
    expect(f).toEqual({
      id: "A-0001-00000123",
      alegraId: "7",
      tipo: "Factura",
      emision: "01/09/2026",
      vencimiento: "30/09/2026",
      importe: 1000,
      estado: "pendiente",
      pagado: 600,
    });
  });
});

describe("getCuenta (SAL-1)", () => {
  it("escenario mezcla: 150 / 100 / 50 y la de saldo 0 no aparece", async () => {
    state.abiertas = [
      { ...factura("A", "open", 100, "2026-09-01") },
      { ...factura("B", "open", 50, "2026-10-01") },
      { ...factura("C", "open", 0, "2026-08-01") },
    ];
    const cuenta = await getCuenta("42");
    expect(cuenta.cliente).toMatchObject({
      codigocliente: "42",
      razonsocial: "Cliente Uno SA",
      cuit: "20-12345678-9",
      tipoCuenta: "corriente",
      limitecredito: 1_000_000,
      deudatotal: 150,
      saldovencido: 100,
      saldoavencer: 50,
    });
    expect(cuenta.abiertas.map((f) => [f.alegraId, f.estado])).toEqual([
      ["A", "vencida"],
      ["B", "pendiente"],
    ]);
  });

  it("sin contacto en espejo ni en Alegra: ContactoNoEncontradoError", async () => {
    state.contacto = null;
    await expect(getCuenta("42")).rejects.toBeInstanceOf(ContactoNoEncontradoError);
  });
});

describe("muestraLimite (decisión: sólo cuenta corriente)", () => {
  it.each([
    [{ tipoCuenta: "corriente", limitecredito: 1000 }, true],
    [{ tipoCuenta: "corriente", limitecredito: 0 }, false],
    [{ tipoCuenta: "corriente", limitecredito: null }, false],
    [{ tipoCuenta: "contado", limitecredito: 1000 }, false],
  ] as const)("%o ⇒ %s", (c, esperado) => {
    expect(muestraLimite(c)).toBe(esperado);
  });
});

describe("getCondiciones (CON-1)", () => {
  it("sólo espejo: plazo y vendedor sin teléfono, sin descuentos ni transporte", async () => {
    grabadora = dbGrabadora(() => []);
    expect(await getCondiciones("42")).toEqual({
      condicionPago: "30 días",
      plazoDias: 30,
      listaPrecios: "Mayorista",
      descuentos: [],
      vendedor: { nombre: "Vendedor Uno", telefono: null, email: null },
      transporte: null,
    });
    const [consulta] = grabadora.consultas;
    expect(consulta.sql).toContain('from "public"."client_commercial_conditions"');
    expect(consulta.params).toEqual(expect.arrayContaining(["tenant-test", "42"]));
  });

  it("fila propia completa: suma descuentos, transporte y contacto del vendedor", async () => {
    grabadora = dbGrabadora(() => [
      [
        "15 días",
        15,
        "Otra",
        [{ concepto: "Iluminación", porcentaje: 10 }],
        { nombre: "Otro", telefono: "1100000000", email: "ventas@cliente.example" },
        { modalidad: "Expreso", observaciones: "" },
      ],
    ]);
    const c = await getCondiciones("42");
    // Lo del espejo manda sobre la fila propia.
    expect(c.condicionPago).toBe("30 días");
    expect(c.vendedor).toEqual({ nombre: "Vendedor Uno", telefono: "1100000000", email: "ventas@cliente.example" });
    expect(c.descuentos).toEqual([{ concepto: "Iluminación", porcentaje: 10 }]);
    expect(c.transporte).toEqual({ modalidad: "Expreso", observaciones: "" });
  });

  it("con el contacto ya leído por la página: no vuelve a leer el espejo", async () => {
    contactoPorId.mockClear();
    grabadora = dbGrabadora(() => []);
    const c = await getCondiciones("42", { ...CONTACTO, plazoNombre: "60 días", plazoDias: 60 });
    expect(contactoPorId).not.toHaveBeenCalled();
    expect(c.condicionPago).toBe("60 días");
  });

  it("sin nada en ninguna fuente: todo vacío, sin datos de ejemplo", async () => {
    state.contacto = null;
    grabadora = dbGrabadora(() => []);
    expect(await getCondiciones("42")).toEqual({
      condicionPago: null,
      plazoDias: null,
      listaPrecios: null,
      descuentos: [],
      vendedor: null,
      transporte: null,
    });
  });
});
