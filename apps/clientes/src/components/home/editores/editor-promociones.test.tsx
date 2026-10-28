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
import { aplicarUnidades, cambiarEstrella, completarHabituales, enteroPesos, necesitaStockBase } from "./promociones-editor";

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
  it("precio de hoy y descuento contra el habitual: confirma que el ajuste del CRM ya está", () => {
    const t = texto(renderToStaticMarkup(<ResumenPrecio precio={109999} esTransferencia habitual={132172} />));
    expect(t).toContain("por transferencia");
    expect(t).toContain("109.999");
    expect(t).toContain("16 % de descuento");
  });
  it("sin rebaja todavía, lo avisa", () => {
    const t = texto(renderToStaticMarkup(<ResumenPrecio precio={132172} esTransferencia habitual={132172} />));
    expect(t).not.toContain("% de descuento");
    expect(t).toContain("Todavía sin descuento");
  });
});

describe("completarHabituales", () => {
  it("completa con el precio de hoy sólo los productos que no tienen habitual", () => {
    const c = { ...base, estrella: { sku: "nk-1" }, items: [{ sku: "A1", precioHabitual: 50000 }, { sku: "B2" }] };
    const r = completarHabituales(c, { "NK-1": 132172.4, A1: 1, B2: 26800 });
    expect(r.estrella?.precioHabitual).toBe(132172);
    expect(r.items.map((i) => i.precioHabitual)).toEqual([50000, 26800]);
  });
  it("sin nada que completar devuelve el mismo objeto (no dispara un guardado)", () => {
    const c = { ...base, items: [{ sku: "A1", precioHabitual: 50000 }] };
    expect(completarHabituales(c, { A1: 1 })).toBe(c);
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
  const antes = {
    sku: "NK-1",
    precioHabitual: 132172,
    referencias: [{ etiqueta: "Tiendas online", precio: 165000 }],
    video: "https://youtu.be/x",
    titulo: "Noak",
    unidadesPromo: 5,
    stockBase: 10,
    sucursal: "mdp",
  };
  it("al cambiar de producto no arrastra referencia, video, textos ni contador (sí la sucursal)", () => {
    expect(cambiarEstrella(antes, { sku: "OTRO" })).toEqual({ sku: "OTRO", sucursal: "mdp" });
  });
  it("otros cambios se aplican sobre la estrella actual", () => {
    expect(cambiarEstrella(antes, { precioHabitual: 140000 })).toMatchObject({ sku: "NK-1", precioHabitual: 140000, video: antes.video });
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
