import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La ficha recibe el id del segmento de ruta: `/producto/mdp%3A12` tiene que
 * llegar a la consulta como `mdp:12` (y un id malformado, no llegar como tal).
 */

const productoPublico = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => null);

vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  cache: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/pagos/tarjetas-aceptadas-mp", () => ({ getTarjetasMercadoPago: async () => [] }));
vi.mock("@/lib/pagos/tarjetas-aceptadas", () => ({ logosTarjetas: () => [] }));
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFound = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFound(), redirect: (u: string) => redirect(u) }));
const alternativaDeVariantePublica = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => null);
const flags = { soloVisibles: true, variantes: false, mediosPrecio: null as null };
vi.mock("@/lib/catalogo-publico", () => ({
  productoPublico: (...a: unknown[]) => productoPublico(...a),
  alternativaDeVariantePublica: (...a: unknown[]) => alternativaDeVariantePublica(...a),
  rutaCategoriaPublica: async () => [],
}));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => flags }));
vi.mock("@/lib/producto-metadata", () => ({ metadataProducto: () => ({}) }));
vi.mock("@/lib/producto-jsonld", () => ({ jsonLdProductoHtml: () => "" }));
vi.mock("@/components/ProductoClient", () => ({ ProductoClient: () => null }));
vi.mock("@/lib/envio", () => ({ CONFIG_ENVIO_DEFAULT: {}, textoEnvioFicha: () => "" }));
vi.mock("@/lib/sucursales-datos", () => ({ reglasVentaCacheadas: async () => ({}) }));
vi.mock("@/components/producto/RelacionadosProducto", () => ({ RelacionadosProducto: () => null }));
vi.mock("@/lib/zona-servidor", () => ({ dispCatalogo: async () => undefined, dispDelVisitante: async () => undefined }));
vi.mock("@/lib/ubicacion-servidor", () => ({ ubicacionDelVisitante: async () => null }));
vi.mock("@/lib/disponibilidad-vista", () => ({ disponibilidadParaMostrar: async () => undefined }));
const getContenidoHome = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/home-datos", () => ({ getContenidoHome: () => getContenidoHome() }));
const quedanEstrella = vi.fn<(...a: unknown[]) => Promise<number | null>>(async () => 3);
vi.mock("@/lib/promociones/stock", () => ({ quedanEstrella: (...a: unknown[]) => quedanEstrella(...a) }));
vi.mock("@/lib/catalogo-atributos-uso", () => ({ usarAtributosEstructurados: async () => false }));
vi.mock("@/lib/disponibilidad-textos", () => ({ estadoEnvio: () => "" }));
vi.mock("@/components/producto/EnvioProductoUbicacion", () => ({ EnvioProductoUbicacion: () => null }));

import ProductoPage, { generateMetadata } from "./page";

beforeEach(() => {
  productoPublico.mockClear();
  redirect.mockClear();
  notFound.mockClear();
  alternativaDeVariantePublica.mockReset().mockResolvedValue(null);
  flags.variantes = false;
  getContenidoHome.mockReset().mockResolvedValue({ promociones: promo("2099-01-01T00:00:00-03:00") });
  quedanEstrella.mockClear();
});

const promo = (fin: string) => ({
  fin,
  estrella: { sku: "NK-1", unidadesPromo: 5, stockBase: 10 },
  items: [],
  etiquetaBadge: "Precio de apertura",
  etiquetaReferencia: "En otras tiendas desde",
});
const estrella = { id: "22596", sku: "NK-1", name: "Ventilador", price: 1, stock: "in" };

describe("/producto/[id]", () => {
  it("decodifica el id de una cuenta secundaria (mdp%3A12 -> mdp:12)", async () => {
    await generateMetadata({ params: Promise.resolve({ id: "mdp%3A12" }) });
    expect(productoPublico).toHaveBeenCalledTimes(1);
    expect(productoPublico.mock.calls[0][0]).toBe("mdp:12");
  });

  it("un id ya decodificado llega igual", async () => {
    await generateMetadata({ params: Promise.resolve({ id: "mdp:12" }) });
    expect(productoPublico.mock.calls[0][0]).toBe("mdp:12");
  });

  it("un id numérico no cambia", async () => {
    await generateMetadata({ params: Promise.resolve({ id: "4521" }) });
    expect(productoPublico.mock.calls[0][0]).toBe("4521");
  });
});

describe("/producto/[id] con una variante que no se puede mostrar (oculta u inactiva)", () => {
  const ir = (id: string) => ProductoPage({ params: Promise.resolve({ id }) });

  it("con otra opción disponible en el modelo, redirige a su ficha", async () => {
    flags.variantes = true;
    alternativaDeVariantePublica.mockResolvedValue("mdp:13");
    await expect(ir("11")).rejects.toThrow("REDIRECT:/producto/mdp%3A13");
    expect(alternativaDeVariantePublica).toHaveBeenCalledWith("11", true, undefined);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("sin ninguna opción disponible, 404", async () => {
    flags.variantes = true;
    await expect(ir("11")).rejects.toThrow("NOT_FOUND");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("con el flag apagado (Central Led hoy) no se busca alternativa: 404 como siempre", async () => {
    await expect(ir("11")).rejects.toThrow("NOT_FOUND");
    expect(alternativaDeVariantePublica).not.toHaveBeenCalled();
  });
});

describe("/producto/[id] con la promo de la home", () => {
  const ir = (id: string) => ProductoPage({ params: Promise.resolve({ id }) });

  it("lee el contenido de la home junto con el producto, no después", async () => {
    let resolver!: (p: unknown) => void;
    productoPublico.mockImplementationOnce(() => new Promise((r) => (resolver = r)));
    const pagina = ir("22596");
    await new Promise((r) => setTimeout(r, 0));
    expect(getContenidoHome).toHaveBeenCalledTimes(1);
    resolver(estrella);
    await pagina;
  });

  it("promo vigente y estrella: cuenta las unidades que quedan", async () => {
    productoPublico.mockResolvedValueOnce(estrella);
    await ir("22596");
    expect(quedanEstrella).toHaveBeenCalledWith(expect.objectContaining({ sku: "NK-1" }), "22596");
  });

  it("promo terminada: no lee el stock de la estrella", async () => {
    getContenidoHome.mockResolvedValue({ promociones: promo("2020-01-01T00:00:00-03:00") });
    productoPublico.mockResolvedValueOnce(estrella);
    await ir("22596");
    expect(quedanEstrella).not.toHaveBeenCalled();
  });
});
