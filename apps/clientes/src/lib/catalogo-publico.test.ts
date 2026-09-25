import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/products";

/**
 * Lecturas públicas cacheadas del catálogo. Con `next/cache` mockeado se
 * verifica lo que no se ve en el código: tag y perfil de cada entrada, que
 * una lectura fallida nunca se guarde con la vida del catálogo, que el flag
 * viaje como argumento (clave) y que lo de muchos valores (búsqueda, rango de
 * precio) no entre en la caché.
 */
const { cat, cacheTagMock, cacheLifeMock } = vi.hoisted(() => ({
  cat: {
    getCatalogo: vi.fn(),
    getCategorias: vi.fn(),
    getFacetas: vi.fn(),
    getPaginaCatalogo: vi.fn(),
    getProducto: vi.fn(),
  },
  cacheTagMock: vi.fn(),
  cacheLifeMock: vi.fn(),
}));

vi.mock("./catalog", () => cat);
vi.mock("next/cache", () => ({ cacheTag: cacheTagMock, cacheLife: cacheLifeMock }));

import {
  categoriasNav,
  destacadosHome,
  facetasPublicas,
  filtrosCacheables,
  paginaCatalogoPublica,
  productoPublico,
} from "./catalogo-publico";

const prod = (id: string, sku: string): Product =>
  ({ id, sku, name: `Producto ${id}`, brand: "M", price: 100, stock: "in" }) as Product;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("filtrosCacheables", () => {
  it("sin búsqueda ni rango de precio: sí", () => {
    expect(filtrosCacheables({})).toBe(true);
    expect(filtrosCacheables({ categorias: ["ILUMINACION"], marcas: ["X"], soloStock: true })).toBe(true);
    expect(filtrosCacheables({ busqueda: "   " })).toBe(true);
  });

  it("con búsqueda por texto o rango de precio: no", () => {
    expect(filtrosCacheables({ busqueda: "led" })).toBe(false);
    expect(filtrosCacheables({ precioMin: 0 })).toBe(false);
    expect(filtrosCacheables({ precioMax: 5000 })).toBe(false);
  });
});

describe("paginaCatalogoPublica / facetasPublicas", () => {
  const pagina = { productos: [prod("1", "A")], total: 1, pagina: 1, paginas: 1 };

  it("cacheable: tag catalogo, perfil catalogo y el flag como argumento", async () => {
    cat.getPaginaCatalogo.mockResolvedValue(pagina);
    cat.getFacetas.mockResolvedValue({ categorias: [], marcas: [], precio: null });
    const args = { filtros: { categorias: ["ILUMINACION"] }, orden: "nombre" as const, pagina: 2, soloVisibles: true };
    expect(await paginaCatalogoPublica(args)).toBe(pagina);
    await facetasPublicas(args.filtros, true);
    expect(cat.getPaginaCatalogo).toHaveBeenCalledWith(args);
    expect(cat.getFacetas).toHaveBeenCalledWith(args.filtros, true);
    expect(cacheTagMock).toHaveBeenCalledTimes(2);
    expect(cacheTagMock).toHaveBeenCalledWith("catalogo");
    expect(cacheLifeMock.mock.calls).toEqual([["catalogo"], ["catalogo"]]);
  });

  it("búsqueda por texto: va directo a la base, sin caché", async () => {
    cat.getPaginaCatalogo.mockResolvedValue(pagina);
    cat.getFacetas.mockResolvedValue({ categorias: [], marcas: [], precio: null });
    const filtros = { busqueda: "led" };
    await paginaCatalogoPublica({ filtros, orden: "nombre", pagina: 1, soloVisibles: false });
    await facetasPublicas(filtros, false);
    expect(cat.getPaginaCatalogo).toHaveBeenCalled();
    expect(cacheTagMock).not.toHaveBeenCalled();
    expect(cacheLifeMock).not.toHaveBeenCalled();
  });

  it("si la base falla, el error se propaga (no se cachea un catálogo vacío)", async () => {
    cat.getPaginaCatalogo.mockRejectedValue(new Error("db caída"));
    await expect(
      paginaCatalogoPublica({ filtros: {}, orden: "nombre", pagina: 1, soloVisibles: false }),
    ).rejects.toThrow("db caída");
  });
});

describe("productoPublico", () => {
  it("id de Alegra: lee con el flag y cachea con el tag del catálogo", async () => {
    cat.getProducto.mockResolvedValue(prod("42", "A"));
    expect((await productoPublico("42", true))?.id).toBe("42");
    expect(cat.getProducto).toHaveBeenCalledWith("42", { soloVisibles: true });
    expect(cacheTagMock).toHaveBeenCalledWith("catalogo");
    expect(cacheLifeMock).toHaveBeenCalledWith("catalogo");
  });

  it("id que no es de Alegra: null sin llegar a la caché ni a la base", async () => {
    expect(await productoPublico("../contacts/1", false)).toBeNull();
    expect(cat.getProducto).not.toHaveBeenCalled();
    expect(cacheTagMock).not.toHaveBeenCalled();
  });
});

describe("categoriasNav", () => {
  it("con la base: perfil catalogo", async () => {
    cat.getCategorias.mockResolvedValue(["ILUMINACION"]);
    expect(await categoriasNav(false)).toEqual(["ILUMINACION"]);
    expect(cat.getCategorias).toHaveBeenCalledWith(false);
    expect(cacheLifeMock).toHaveBeenCalledWith("catalogo");
  });

  it("base caída: vacío con el perfil degradado, nunca la vida del catálogo", async () => {
    cat.getCategorias.mockRejectedValue(new Error("db caída"));
    expect(await categoriasNav(true)).toEqual([]);
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("catalogo");
  });
});

describe("destacadosHome", () => {
  it("curados primero, completa con Iluminación; perfil catalogo", async () => {
    cat.getPaginaCatalogo.mockResolvedValue({ productos: [prod("1", "A"), prod("2", "B")] });
    cat.getCatalogo.mockResolvedValue([prod("9", "Z")]);
    const out = await destacadosHome({ skus: ["Z"], cantidad: 2, soloVisibles: true });
    expect(out.map((p) => p.id)).toEqual(["9", "1"]);
    expect(cat.getPaginaCatalogo).toHaveBeenCalledWith({
      filtros: { categorias: ["ILUMINACION"] },
      pagina: 1,
      soloVisibles: true,
    });
    expect(cat.getCatalogo).toHaveBeenCalledWith({ limit: 300, soloVisibles: true });
    expect(cacheTagMock).toHaveBeenCalledWith("catalogo");
    expect(cacheLifeMock.mock.calls).toEqual([["catalogo"]]);
  });

  it("sin SKUs curados no trae el respaldo", async () => {
    cat.getPaginaCatalogo.mockResolvedValue({ productos: [prod("1", "A")] });
    await destacadosHome({ skus: [], cantidad: 4, soloVisibles: false });
    expect(cat.getCatalogo).not.toHaveBeenCalled();
  });

  it("una lectura que falla: degrada a lo que hay y se guarda con el perfil degradado", async () => {
    cat.getPaginaCatalogo.mockRejectedValue(new Error("db caída"));
    cat.getCatalogo.mockResolvedValue([prod("9", "Z")]);
    const out = await destacadosHome({ skus: ["Z"], cantidad: 4, soloVisibles: false });
    expect(out.map((p) => p.id)).toEqual(["9"]);
    expect(cacheLifeMock.mock.calls).toEqual([["degradado"]]);
  });
});
