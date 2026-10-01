import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import { armarMailPedido, transferenciaParaMail } from "./pedido-mail";

const base = {
  numero: "PED-00000042",
  contactoNombre: "Ana",
  comercio: "Tienda Demo",
  pedidosUrl: "https://tienda.cliente.example/mi-cuenta/pedidos",
};

describe("transferenciaParaMail", () => {
  const cuenta = { v: 1 as const, cuentaId: "c", alias: "a", cbu: "1", banco: "", titular: "", cuit: "", motivo: "regla" as const, sucursal: null, totalEvaluado: 1, congeladaEn: "x" };

  it("sólo para transferencia; sin snapshot, cuenta null (mensaje neutro)", () => {
    expect(transferenciaParaMail("transferencia", cuenta)).toEqual({ cuenta });
    expect(transferenciaParaMail("transferencia", null)).toEqual({ cuenta: null });
    expect(transferenciaParaMail("transferencia", undefined)).toEqual({ cuenta: null });
    expect(transferenciaParaMail("mercadopago", cuenta)).toBeUndefined();
    expect(transferenciaParaMail("efectivo", null)).toBeUndefined();
  });
});

describe("armarMailPedido: cuenta para transferir", () => {
  const cuenta = {
    v: 1 as const,
    cuentaId: "c1",
    alias: "tienda.<ejemplo>",
    cbu: "0000000000000000000000",
    banco: "Banco Ejemplo",
    titular: "Titular Ejemplo SA",
    cuit: "30000000000",
    motivo: "regla" as const,
    sucursal: null,
    totalEvaluado: 12100,
    congeladaEn: "2026-10-01T12:00:00.000Z",
  };

  it("recibido por transferencia: incluye los datos del snapshot (escapados) y el importe", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido", total: 12100, transferencia: { cuenta } });
    expect(m.html).toContain("Datos para transferir");
    expect(m.html).toContain("tienda.&lt;ejemplo&gt;");
    expect(m.html).not.toContain("tienda.<ejemplo>");
    expect(m.html).toContain("0000000000000000000000");
    expect(m.text).toContain("Alias: tienda.<ejemplo>");
    expect(m.text).toContain("CBU: 0000000000000000000000");
    expect(m.text).toContain("Banco: Banco Ejemplo");
    expect(m.text).toContain("Titular: Titular Ejemplo SA");
    expect(m.text).toContain("CUIT: 30000000000");
    expect(m.text).toMatch(/Importe: \$\s?12\.100,00/);
  });

  it("sin snapshot: mensaje neutro, sin datos bancarios", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido", transferencia: { cuenta: null } });
    expect(m.text).toContain("Le enviaremos los datos para transferir");
    expect(m.html).toContain("Le enviaremos los datos para transferir");
    expect(m.text).not.toContain("CBU");
  });

  it("omite banco, titular y CUIT vacíos", () => {
    const m = armarMailPedido({
      ...base,
      aviso: "recibido",
      transferencia: { cuenta: { ...cuenta, banco: "", titular: "", cuit: "" } },
    });
    expect(m.text).toContain("Alias:");
    expect(m.text).not.toContain("Banco:");
    expect(m.text).not.toContain("Titular:");
    expect(m.text).not.toContain("CUIT:");
  });

  it("los avisos de pago no llevan el bloque", () => {
    const m = armarMailPedido({ ...base, aviso: "pago_recibido", transferencia: { cuenta } });
    expect(m.html).not.toContain("Datos para transferir");
    expect(m.text).not.toContain("CBU");
  });

  it("sin transferencia el mail queda como siempre; y en usted", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido" });
    expect(m.text).not.toContain("transferir");
    const con = armarMailPedido({ ...base, aviso: "recibido", transferencia: { cuenta } });
    expect(infracciones(con.text, REGISTRO)).toEqual([]);
    expect(infracciones(con.html, REGISTRO)).toEqual([]);
  });
});
