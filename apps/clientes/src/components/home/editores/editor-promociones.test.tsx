import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULTS_HOME, type PromocionesContent } from "@/data/home-defaults";

vi.mock("@/lib/home-acciones", () => ({
  productosParaPromo: vi.fn(async () => ({ ok: true, productos: [] })),
  sucursalesParaPromo: vi.fn(async () => []),
  resolverProductosHome: vi.fn(async () => ({ ok: true, productos: [] })),
  buscarProductosHome: vi.fn(async () => ({ ok: true, productos: [] })),
}));

import { EditorPromociones, ResumenPrecio } from "./EditorPromociones";
import { aplicarUnidades, cambiarEstrella, enteroPesos, necesitaStockBase } from "./promociones-editor";

const base: PromocionesContent = { ...DEFAULTS_HOME.promociones, fin: "2026-11-13T23:59:00-03:00" };

describe("aplicarUnidades", () => {
  it("guarda las unidades y el stock de ese momento", () => {
    const r = aplicarUnidades({ ...base, estrella: { sku: "NK-1" } }, { unidades: 5, stock: 10, sucursal: "mdp" });
    expect(r.estrella).toEqual({ sku: "NK-1", unidadesPromo: 5, stockBase: 10, sucursal: "mdp" });
  });

  it("sin unidades quita el contador", () => {
    const r = aplicarUnidades({ ...base, estrella: { sku: "NK-1", unidadesPromo: 5, stockBase: 10 } }, { unidades: undefined, stock: 10, sucursal: "mdp" });
    expect(r.estrella).toEqual({ sku: "NK-1" });
  });
});

describe("necesitaStockBase", () => {
  const antes = { sku: "NK-1", unidadesPromo: 5, stockBase: 10, sucursal: "mdp" };
  it("no, si nada cambió", () => {
    expect(necesitaStockBase(antes, antes)).toBe(false);
  });
  it.each([
    ["la estrella", { ...antes, sku: "OTRO" }],
    ["la sucursal", { ...antes, sucursal: "igz" }],
    ["las unidades", { ...antes, unidadesPromo: 3 }],
  ])("sí, si cambia %s", (_, despues) => {
    expect(necesitaStockBase(antes, despues)).toBe(true);
  });
  it("sí, si hay unidades y todavía no hay stockBase", () => {
    expect(necesitaStockBase(undefined, { sku: "NK-1", unidadesPromo: 5 })).toBe(true);
  });
  it("no, sin unidades de promo", () => {
    expect(necesitaStockBase(antes, { sku: "OTRO" })).toBe(false);
  });
});

describe("ResumenPrecio", () => {
  const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  it("precio por transferencia y ahorro contra la referencia", () => {
    const t = texto(renderToStaticMarkup(<ResumenPrecio precio={109999} esTransferencia referencia={150000} />));
    expect(t).toContain("por transferencia");
    expect(t).toContain("109.999");
    expect(t).toContain("−26 %");
  });
  it("sin ahorro no muestra porcentaje", () => {
    const t = texto(renderToStaticMarkup(<ResumenPrecio precio={160000} esTransferencia={false} referencia={150000} />));
    expect(t).not.toContain("%");
  });
});

describe("EditorPromociones", () => {
  it("muestra las fechas en hora de Argentina", () => {
    const html = renderToStaticMarkup(<EditorPromociones valor={base} onChange={() => {}} />);
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-11-13T23:59"');
  });
});

describe("cambiarEstrella", () => {
  const antes = { sku: "NK-1", precioReferencia: 150000, video: "https://youtu.be/x", titulo: "Noak", unidadesPromo: 5, stockBase: 10, sucursal: "mdp" };
  it("al cambiar de producto no arrastra referencia, video, textos ni contador (sí la sucursal)", () => {
    expect(cambiarEstrella(antes, { sku: "OTRO" })).toEqual({ sku: "OTRO", sucursal: "mdp" });
  });
  it("otros cambios se aplican sobre la estrella actual", () => {
    expect(cambiarEstrella(antes, { precioReferencia: 140000 })).toMatchObject({ sku: "NK-1", precioReferencia: 140000, video: antes.video });
  });
  it("cambiar unidades o sucursal invalida el stock base", () => {
    expect(cambiarEstrella(antes, { unidadesPromo: 3 }).stockBase).toBeUndefined();
    expect(cambiarEstrella(antes, { sucursal: "igz" }).stockBase).toBeUndefined();
  });
});

describe("enteroPesos", () => {
  it.each([
    ["150000", 150000],
    ["150.000", 150000],
    ["$ 150.000", 150000],
    ["149999,50", 150000],
    ["149.999,49", 149999],
    ["", undefined],
    ["0", undefined],
    ["abc", undefined],
  ])("%s → %s", (v, esperado) => {
    expect(enteroPesos(v)).toBe(esperado);
  });
});
