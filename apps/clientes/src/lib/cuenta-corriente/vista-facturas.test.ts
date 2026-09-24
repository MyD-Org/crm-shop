import { describe, expect, it } from "vitest";
import type { Factura } from "./tipos";
import {
  dmyAIso,
  esFiltroDeAbiertas,
  esPagoParcial,
  filtrarAbiertas,
  porVencimiento,
  queryFacturas,
  saldoDe,
  TONO_ESTADO,
  urlDocumento,
} from "./vista-facturas";

const f = (p: Partial<Factura>): Factura => ({
  id: "FV-1",
  alegraId: "1",
  tipo: "Factura",
  emision: "01/09/2026",
  vencimiento: "",
  importe: 100,
  estado: "pendiente",
  pagado: 0,
  ...p,
});

describe("saldo y pago parcial (como el portal)", () => {
  it("saldo = importe − pagado; anulada = 0", () => {
    expect(saldoDe(f({ importe: 100, pagado: 40 }))).toBe(60);
    expect(saldoDe(f({ estado: "anulada", importe: 100, pagado: 0 }))).toBe(0);
  });

  it("parcial sólo con algo pagado y no todo", () => {
    expect(esPagoParcial(f({ pagado: 40 }))).toBe(true);
    expect(esPagoParcial(f({ pagado: 0 }))).toBe(false);
    expect(esPagoParcial(f({ pagado: 100 }))).toBe(false);
  });
});

describe("estados", () => {
  it("FAC-4: tonos del Badge", () => {
    expect(TONO_ESTADO).toEqual({ pendiente: "warning", vencida: "danger", pagada: "success", anulada: "neutral" });
  });

  it("Pendientes y Vencidas salen de las abiertas; el resto de la API", () => {
    expect(esFiltroDeAbiertas("pendiente")).toBe(true);
    expect(esFiltroDeAbiertas("vencida")).toBe(true);
    expect(esFiltroDeAbiertas("pagada")).toBe(false);
    expect(esFiltroDeAbiertas("todas")).toBe(false);
  });
});

describe("filtrarAbiertas (FAC-3 vencidas)", () => {
  const abiertas = [
    f({ alegraId: "1", estado: "vencida", emision: "01/08/2026" }),
    f({ alegraId: "2", estado: "vencida", emision: "15/08/2026" }),
    f({ alegraId: "3", estado: "pendiente", emision: "01/09/2026" }),
    f({ alegraId: "4", estado: "vencida", emision: "01/07/2026" }),
  ];

  it("exactamente las vencidas", () => {
    expect(filtrarAbiertas(abiertas, "vencida", {}).map((x) => x.alegraId)).toEqual(["1", "2", "4"]);
  });

  it("con rango de emisión", () => {
    expect(
      filtrarAbiertas(abiertas, "vencida", { start: "2026-08-01", end: "2026-08-10" }).map((x) => x.alegraId),
    ).toEqual(["1"]);
  });
});

describe("porVencimiento (top de las tarjetas)", () => {
  it("vencimiento más viejo primero, sin vencimiento al final", () => {
    const abiertas = [
      f({ alegraId: "a", estado: "vencida", vencimiento: "10/09/2026" }),
      f({ alegraId: "b", estado: "vencida", vencimiento: "" }),
      f({ alegraId: "c", estado: "vencida", vencimiento: "01/08/2026" }),
      f({ alegraId: "d", estado: "pendiente", vencimiento: "01/01/2026" }),
    ];
    expect(porVencimiento(abiertas, "vencida").map((x) => x.alegraId)).toEqual(["c", "a", "b"]);
  });
});

describe("URLs", () => {
  it("query de la API sin parámetros vacíos", () => {
    expect(queryFacturas("todas", {})).toBe("");
    expect(queryFacturas("pagada", { start: "2026-01-01" }, 30)).toBe("?start=30&estado=pagada&desde=2026-01-01");
  });

  it("PDF por la ruta proxy, con descarga opcional", () => {
    expect(urlDocumento("factura", "987")).toBe("/api/mi-cuenta/documentos/factura/987");
    expect(urlDocumento("factura", "987", true)).toBe("/api/mi-cuenta/documentos/factura/987?download=1");
  });

  it("dmyAIso", () => {
    expect(dmyAIso("23/09/2026")).toBe("2026-09-23");
    expect(dmyAIso("")).toBe("");
  });
});
