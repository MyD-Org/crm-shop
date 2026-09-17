import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CuotasLinea } from "./CuotasLinea";
import { CuotasResumen } from "./CuotasResumen";
import { MediosDePagoDetalle } from "./MediosDePagoDetalle";
import { resumenCuotas, bloquesMediosDePago } from "@/lib/cuotas-exhibicion";
import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import type { OfertaCuotas, OpcionCuotas, OpcionOfertada } from "@/lib/pagos/cuotas-tipos";

/** Render estático (sin jsdom, ver vitest.config.ts): verifica QUÉ se muestra. */
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const opcion = (p: Partial<OpcionCuotas>): OpcionCuotas => ({
  proveedor: "mercadopago",
  proveedorNombre: "Mercado Pago",
  cuotas: 6,
  montoCuota: 20000,
  total: 120000,
  precioContado: 120000,
  cftPct: null,
  teaPct: null,
  sinInteres: true,
  ...p,
});

const ofertada = (p: Partial<OpcionOfertada> & { cuotas: number }): OpcionOfertada => ({
  sinInteres: (p.tasaPct ?? 0) === 0,
  tasaPct: 0,
  cftPct: null,
  teaPct: null,
  montoMin: null,
  montoMax: null,
  ...p,
});

const oferta = (
  escalones: OfertaCuotas["proveedores"][number]["escalones"],
  opciones: OpcionOfertada[],
): OfertaCuotas => ({
  proveedores: [{ proveedor: "mercadopago", nombre: "Mercado Pago", orden: 0, escalones, opciones }],
  planesFetchedAt: null,
  configVersion: null,
});

describe("CuotasLinea (card y ficha)", () => {
  it("sin interés", () => {
    const t = texto(renderToStaticMarkup(createElement(CuotasLinea, { opcion: opcion({}) })));
    expect(t).toBe("6 cuotas sin interés de $20.000");
  });

  it("con interés: 'Hasta N cuotas de $X', no dice 'sin interés'", () => {
    const t = texto(
      renderToStaticMarkup(
        createElement(CuotasLinea, { opcion: opcion({ cuotas: 12, montoCuota: 13500, sinInteres: false }) }),
      ),
    );
    expect(t).toBe("Hasta 12 cuotas de $13.500");
    expect(t).not.toContain("sin interés");
  });

  it("sin opción → nada", () => {
    expect(renderToStaticMarkup(createElement(CuotasLinea, { opcion: null }))).toBe("");
  });
});

describe("MediosDePagoDetalle (modal de la ficha)", () => {
  const o = oferta(
    [{ cuotasMax: 12, montoMinimo: 0 }],
    [
      ofertada({ cuotas: 6 }),
      ofertada({ cuotas: 12, tasaPct: 40, cftPct: 55.5, teaPct: 42.1 }),
      ofertada({ cuotas: 18, tasaPct: 60, cftPct: 90, teaPct: 70 }),
    ],
  );

  const html = renderToStaticMarkup(
    createElement(MediosDePagoDetalle, { bloques: bloquesMediosDePago(120000, o) }),
  );
  const t = texto(html);

  it("un bloque por proveedor titulado 'Tarjetas de crédito (Mercado Pago)' con 1 pago", () => {
    expect(t).toContain("Tarjetas de crédito (Mercado Pago)");
    expect(t.match(/1 pago Precio contado/g)).toHaveLength(1);
    expect(t).toContain("$120.000");
  });

  it("todas las cantidades hasta el máximo; con interés CFT destacado y TEA, sin interés sin CFT", () => {
    expect(t).toContain("6 cuotas de $20.000 Sin interés");
    expect(t).toContain("12 cuotas de $14.000");
    expect(t).toContain("CFT 55,50%");
    expect(t).toContain("TEA 42,10%");
    expect(html).toMatch(/font-bold[^>]*>CFT 55,50%/);
    expect(t).not.toContain("18 cuotas");
    expect(t.match(/CFT/g)).toHaveLength(1);
  });

  it("proveedor sin opciones para el precio: sólo 1 pago", () => {
    const soloUnPago = texto(
      renderToStaticMarkup(
        createElement(MediosDePagoDetalle, {
          bloques: bloquesMediosDePago(1000, oferta([{ cuotasMax: 6, montoMinimo: 50000 }], [ofertada({ cuotas: 6 })])),
        }),
      ),
    );
    expect(soloUnPago).toContain(TEXTOS_CUOTAS.sinOpcionesMedio);
  });

  it("incluye la leyenda de referencia", () => {
    expect(t).toContain(TEXTOS_CUOTAS.leyenda);
  });

  it("secciones con encabezado accesible", () => {
    expect(html).toContain('aria-labelledby="proveedor-mercadopago"');
    expect(html).toContain('id="proveedor-mercadopago"');
  });
});

describe("CuotasResumen (carrito)", () => {
  const o = oferta(
    [{ cuotasMax: 3, montoMinimo: 0 }, { cuotasMax: 6, montoMinimo: 150000 }],
    [ofertada({ cuotas: 3 }), ofertada({ cuotas: 6 })],
  );

  it("máximo, te faltan, barra al 80% y leyenda", () => {
    const html = renderToStaticMarkup(createElement(CuotasResumen, { resumen: resumenCuotas(120000, o) }));
    const t = texto(html);
    expect(t).toContain("Hasta 3 cuotas sin interés");
    expect(t).toContain("Te faltan $30.000 para hasta 6 cuotas");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="80"');
    expect(html).toContain("width:80%");
    expect(t).toContain(TEXTOS_CUOTAS.leyenda);
  });

  it("sin resumen (carrito vacío, flag off, sin datos) → nada", () => {
    expect(renderToStaticMarkup(createElement(CuotasResumen, { resumen: null }))).toBe("");
  });

  it("checkout: plan del pedido con título y sin barra", () => {
    const html = renderToStaticMarkup(
      createElement(CuotasResumen, {
        resumen: resumenCuotas(200000, o, { cuotasMax: 6 }),
        titulo: TEXTOS_CUOTAS.checkoutTitulo,
      }),
    );
    const t = texto(html);
    expect(t).toContain("Hasta 6 cuotas sin interés");
    expect(html).not.toContain("progressbar");
  });
});
