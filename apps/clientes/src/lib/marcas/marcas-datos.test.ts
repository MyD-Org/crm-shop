import { beforeEach, describe, expect, it, vi } from "vitest";

const leer = vi.fn<(prefijo: string) => Promise<Map<string, unknown>>>();
vi.mock("@/lib/home-guardar", () => ({ leerSeccionesHomePorPrefijo: (p: string) => leer(p) }));
const cacheLife = vi.fn();
vi.mock("next/cache", () => ({ cacheLife: (p: string) => cacheLife(p), cacheTag: vi.fn() }));

import { getPaginaMarca, getPaginasMarca, getPaginasMarcaPublicadas } from "./marcas-datos";

const fila = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  nombre: slug.toUpperCase(),
  nivel: "marca",
  publicada: true,
  orden: 1,
  marcasCatalogo: [slug.toUpperCase()],
  bajada: "",
  bloques: {},
  visibilidad: {},
  ...extra,
});

beforeEach(() => {
  leer.mockReset();
  cacheLife.mockReset();
  leer.mockResolvedValue(
    new Map<string, unknown>([
      ["pagina-marca:macro", fila("macro", { orden: 2 })],
      ["pagina-marca:basura", { cualquier: "cosa" }],
      ["pagina-marca:acme", fila("acme", { nivel: "oficial", orden: 9 })],
      ["pagina-marca:oculta", fila("oculta", { publicada: false, orden: 0 })],
    ]),
  );
});

describe("marcas-datos", () => {
  it("lee las filas con el prefijo propio, descarta la basura y ordena", async () => {
    const ps = await getPaginasMarca();
    expect(leer).toHaveBeenCalledWith("pagina-marca:");
    expect(ps.map((p) => p.slug)).toEqual(["acme", "oculta", "macro"]);
    expect(cacheLife).toHaveBeenCalledWith("home");
  });

  it("una fila cuya clave no coincide con su slug se descarta", async () => {
    leer.mockResolvedValue(new Map([["pagina-marca:otra", fila("acme")]]));
    expect(await getPaginasMarca()).toEqual([]);
  });

  it("las publicadas excluyen las ocultas", async () => {
    expect((await getPaginasMarcaPublicadas()).map((p) => p.slug)).toEqual(["acme", "macro"]);
  });

  it("una por slug, o null si no existe", async () => {
    expect((await getPaginaMarca("macro"))?.nombre).toBe("MACRO");
    expect(await getPaginaMarca("no-existe")).toBeNull();
  });

  it("si la base falla devuelve [] con el perfil degradado", async () => {
    leer.mockRejectedValue(new Error("caída"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getPaginasMarca()).toEqual([]);
    expect(cacheLife).toHaveBeenCalledWith("degradado");
  });
});
