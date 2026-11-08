import { describe, expect, it } from "vitest";
import { keyHomeNueva, keyHomeVieja, parsearHomeVieja, reescribirUrlsHome, urlHomeNueva } from "./home-variantes";

const ID = "48d9ae91-da35-476b-9aaa-c8306efd9b49";
const BASE = "https://medios.plataforma.example/";
const vieja = `${BASE}home/central-led/${ID}-1600.webp`;
const nueva = `${BASE}home/central-led/v/${ID}-1600.webp`;

describe("parsearHomeVieja", () => {
  it("reconoce la URL vieja y la key vieja", () => {
    expect(parsearHomeVieja(vieja)).toEqual({ base: BASE, tenant: "central-led", id: ID });
    expect(parsearHomeVieja(`home/central-led/${ID}-1600.webp`)).toEqual({ base: "", tenant: "central-led", id: ID });
  });

  it("no toca las nuevas, las de productos ni otras", () => {
    expect(parsearHomeVieja(nueva)).toBeNull();
    expect(parsearHomeVieja(`${BASE}productos/central-led/1/${ID}-1600.webp`)).toBeNull();
    expect(parsearHomeVieja(`${BASE}home/central-led/${ID}-800.webp`)).toBeNull();
    expect(parsearHomeVieja("/images/hero.webp")).toBeNull();
    expect(parsearHomeVieja(`${vieja}?x=1`)).toBeNull();
  });
});

describe("keys y url nuevas", () => {
  it("arman las rutas con v/", () => {
    const p = { tenant: "central-led", id: ID };
    expect(keyHomeNueva(p, 800)).toBe(`home/central-led/v/${ID}-800.webp`);
    expect(keyHomeNueva(p, 1600)).toBe(`home/central-led/v/${ID}-1600.webp`);
    expect(keyHomeVieja(p)).toBe(`home/central-led/${ID}-1600.webp`);
    expect(urlHomeNueva({ base: BASE, ...p })).toBe(nueva);
  });
});

describe("reescribirUrlsHome", () => {
  it("reemplaza en cualquier profundidad, cuenta y no muta el original", () => {
    const original = {
      hero: { imagen: vieja, alt: "x" },
      items: [{ foto: vieja }, { foto: "/images/a.webp" }, null, 3],
      texto: `ver ${vieja} acá`,
    };
    const vistas: string[] = [];
    const { valor, cambios } = reescribirUrlsHome(original, (p) => vistas.push(p.id));

    expect(cambios).toBe(2);
    expect(vistas).toEqual([ID, ID]);
    expect(valor).toEqual({
      hero: { imagen: nueva, alt: "x" },
      items: [{ foto: nueva }, { foto: "/images/a.webp" }, null, 3],
      texto: `ver ${vieja} acá`,
    });
    expect(original.hero.imagen).toBe(vieja);
  });

  it("es idempotente", () => {
    const una = reescribirUrlsHome({ a: vieja }).valor;
    expect(reescribirUrlsHome(una).cambios).toBe(0);
  });
});
