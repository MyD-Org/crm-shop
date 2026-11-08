import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * Claves de home_content por sitio (change `marca-por-dominio`, S3). Un sitio propio guarda y lee
 * `sitio:<etiqueta>:<key>`; el principal y los alias, la clave sola. Dominios de ejemplo (.example).
 */
const EXTRAS = [
  { etiqueta: "tienda-b", url: "https://tienda-b.example", marca: { nombre: "Tienda B" } },
  { etiqueta: "alias", url: "https://alias.example" },
];

let extrasLegibles = true;
let grabadora = dbGrabadora();
const responder = (c: { sql: string }) => (c.sql.includes("shop_destinos_extra") ? [[EXTRAS]] : undefined);
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/sitio-datos", async () => ({
  leerDestinosExtra: async () => {
    if (!extrasLegibles) throw new Error("sin permiso");
    return EXTRAS;
  },
}));

import {
  borrarSeccionHome,
  guardarSeccionHome,
  leerSeccionesHome,
  leerSeccionesHomePorPrefijo,
  leerSeccionHome,
  leerTodasSeccionesHome,
  leerWhatsappDelPrincipal,
} from "./home-guardar";

const PROPIO = "https://tienda-b.example|";
const ALIAS = "https://alias.example|";
const PRINCIPAL = "https://cliente.example|";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-sitio");
  extrasLegibles = true;
  grabadora = dbGrabadora(responder);
});
afterEach(() => vi.unstubAllEnvs());

describe("guardar y borrar", () => {
  it("un sitio propio escribe bajo sitio:<etiqueta>:", async () => {
    grabadora = dbGrabadora(() => [[new Date()]]);
    await guardarSeccionHome("anuncio", { texto: "x" }, PROPIO);
    expect(grabadora.consultas[0].params).toContain("sitio:tienda-b:anuncio");
  });

  it("el principal y un alias escriben la clave sin prefijo", async () => {
    for (const sitio of ["|", PRINCIPAL, ALIAS]) {
      grabadora = dbGrabadora(() => [[new Date()]]);
      await guardarSeccionHome("anuncio", { texto: "x" }, sitio);
      const params = grabadora.consultas.at(-1)!.params;
      expect(params).toContain("anuncio");
      expect(params.some((p) => typeof p === "string" && p.startsWith("sitio:"))).toBe(false);
    }
  });

  it("borrar apunta a la clave del sitio", async () => {
    await borrarSeccionHome("anuncio", PROPIO);
    expect(grabadora.consultas.at(-1)!.params).toContain("sitio:tienda-b:anuncio");
  });

  it("sin poder leer los destinos extra, no escribe (nunca cae al espacio del principal)", async () => {
    extrasLegibles = false;
    await expect(guardarSeccionHome("anuncio", {}, PROPIO)).rejects.toThrow();
    expect(grabadora.consultas).toHaveLength(0);
  });
});

describe("leer", () => {
  it("leerSeccionHome pide la clave con prefijo", async () => {
    await leerSeccionHome("footer", PROPIO);
    expect(grabadora.consultas.at(-1)!.params).toContain("sitio:tienda-b:footer");
  });

  it("leerSeccionesHome pide y devuelve claves sin prefijo", async () => {
    grabadora = dbGrabadora((c) => (c.sql.includes("home_content") ? [["sitio:tienda-b:footer", { whatsapp: "1" }]] : undefined));
    const mapa = await leerSeccionesHome(["legal", "footer"], PROPIO);
    expect(grabadora.consultas.at(-1)!.params).toEqual(expect.arrayContaining(["sitio:tienda-b:legal", "sitio:tienda-b:footer"]));
    expect([...mapa.keys()]).toEqual(["footer"]);
  });

  it("leerSeccionesHomePorPrefijo antepone el prefijo del sitio y lo quita al devolver", async () => {
    grabadora = dbGrabadora((c) => (c.sql.includes("home_content") ? [["sitio:tienda-b:pagina-marca:a", { slug: "a" }]] : undefined));
    const mapa = await leerSeccionesHomePorPrefijo("pagina-marca:", PROPIO);
    expect(grabadora.consultas.at(-1)!.params).toContain("sitio:tienda-b:pagina-marca:%");
    expect([...mapa.keys()]).toEqual(["pagina-marca:a"]);
  });

  it("leerTodas: el sitio propio sólo ve las suyas; el principal excluye las de los sitios propios", async () => {
    await leerTodasSeccionesHome(PROPIO);
    expect(grabadora.consultas.at(-1)!.params).toContain("sitio:tienda-b:%");
    for (const sitio of ["|", PRINCIPAL, ALIAS]) {
      grabadora = dbGrabadora(responder);
      await leerTodasSeccionesHome(sitio);
      const c = grabadora.consultas.at(-1)!;
      expect(c.sql).toMatch(/"key" not like/);
      expect(c.params).toContain("sitio:%");
    }
  });

  it("leerTodas devuelve las claves sin prefijo", async () => {
    grabadora = dbGrabadora((c) => (c.sql.includes("home_content") ? [["sitio:tienda-b:hero", { titulo: "x" }]] : undefined));
    expect((await leerTodasSeccionesHome(PROPIO)).map((f) => f.key)).toEqual(["hero"]);
  });

  it("leerWhatsappDelPrincipal devuelve sólo el número", async () => {
    grabadora = dbGrabadora((c) => (c.sql.includes("home_content") ? [[{ whatsapp: " 5491100000000 ", redes: [{ usuario: "x" }] }]] : undefined));
    expect(await leerWhatsappDelPrincipal()).toBe("5491100000000");
    expect(grabadora.consultas.at(-1)!.params).toContain("footer");
  });
});
