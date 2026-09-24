import { describe, expect, it } from "vitest";
import { contactoWhatsApp, enlaceWhatsApp, mensajeFacturas, mensajePagos, mensajePresupuestos } from "./whatsapp";

const DATOS = { empresa: "Empresa Demo", razonsocial: "Cliente Uno SA", cuit: "20-12345678-9" };

describe("enlaceWhatsApp", () => {
  it("sin número: null", () => {
    expect(enlaceWhatsApp("", "hola")).toBeNull();
    expect(enlaceWhatsApp(null, "hola")).toBeNull();
  });

  it("deja sólo dígitos y codifica el texto", () => {
    expect(enlaceWhatsApp("+54 9 11 0000-0000", "a b")).toBe("https://wa.me/5491100000000?text=a%20b");
  });
});

describe("mensajes", () => {
  const facturas = [
    { id: "A-1", emision: "01/09/2026", importe: 1000, estado: "vencida" as const, pagado: 0 },
    { id: "A-2", emision: "05/09/2026", importe: 500, estado: "pendiente" as const, pagado: 200 },
  ];

  it("facturas: razón social, CUIT, número, fecha, saldo y total", () => {
    const m = mensajeFacturas("consultar", DATOS, facturas);
    expect(m).toContain("Cliente Uno SA (CUIT 20-12345678-9)");
    expect(m).toContain("A-1 del 01/09/2026");
    expect(m).toContain("(Vencida)");
    expect(m).toMatch(/A-2 del 05\/09\/2026: saldo \$\s?300,00/);
    expect(m).toMatch(/Saldo total: \$\s?1\.300,00/);
    expect(m.endsWith("Consulta: ")).toBe(true);
  });

  it("pagar no deja el cierre de consulta", () => {
    expect(mensajeFacturas("pagar", DATOS, facturas)).not.toContain("Consulta:");
  });

  it("pagos y presupuestos", () => {
    expect(mensajePagos(DATOS, [{ id: "RC-1", fecha: "10/09/2026", medio: "Transferencia", monto: 300 }])).toContain(
      "RC-1 del 10/09/2026 (Transferencia)",
    );
    expect(mensajePresupuestos("avanzar", DATOS, [{ id: "P-1", fecha: "01/09/2026", total: 10 }])).toContain(
      "Queremos avanzar",
    );
  });

  it("sin voseo ni tuteo", () => {
    const todos = [
      mensajeFacturas("pagar", DATOS, facturas),
      mensajeFacturas("consultar", DATOS, facturas),
      mensajePagos(DATOS, [{ id: "1", fecha: "x", medio: "", monto: 1 }]),
      mensajePresupuestos("consultar", DATOS, [{ id: "1", fecha: "x", total: 1 }]),
    ].join("\n");
    expect(todos).not.toMatch(/\b(tu|tus|te|vos)\b/i);
    expect(todos).not.toMatch(/\b\w+á\b(?! )/);
  });
});

describe("contactoWhatsApp (WA-1)", () => {
  const tenant = { nombre: "Empresa Demo", whatsapp: "5491100000000" };

  it("sin número de la empresa o sin razón social: null (no hay botones)", () => {
    expect(contactoWhatsApp(null, { razonsocial: "Cliente Uno SA" })).toBeNull();
    expect(contactoWhatsApp({ ...tenant, whatsapp: null }, { razonsocial: "Cliente Uno SA" })).toBeNull();
    expect(contactoWhatsApp(tenant, { razonsocial: "" })).toBeNull();
  });

  it("con los dos: número y datos del mensaje", () => {
    expect(contactoWhatsApp(tenant, { razonsocial: "Cliente Uno SA", cuit: null })).toEqual({
      numero: "5491100000000",
      datos: { empresa: "Empresa Demo", razonsocial: "Cliente Uno SA", cuit: "" },
    });
  });
});
