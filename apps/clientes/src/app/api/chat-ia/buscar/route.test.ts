import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

/**
 * La ruta busca por el motor único (superficie `chat`): se mockea `motor-servidor` y se mira qué
 * pedido le hace. Las etapas (exacta, tolerante), su degradación y los argumentos de cada lectura
 * se prueban en lib/busqueda-v2/motor.test.ts.
 */
const buscarEnShop = vi.fn();
const getArbolCategorias = vi.fn();
const permitir = vi.fn();
vi.mock("@/lib/busqueda-v2/motor-servidor", () => ({ buscarEnShop: (...a: unknown[]) => buscarEnShop(...a) }));
vi.mock("@/lib/catalog", () => ({ getArbolCategorias: () => getArbolCategorias() }));
vi.mock("@/lib/rate-limit", () => ({ permitir: (...a: unknown[]) => permitir(...a) }));
const disponibles = vi.fn(async () => false);
vi.mock("@/lib/catalogo-atributos-disponibles", () => ({ atributosEstructuradosDisponibles: () => disponibles() }));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: true, cuotas: false }) }));

import { GET } from "./route";

const producto = { id: "1101", name: "Lámpara LED", brand: "Demo", price: 100, precioFinal: 121, stock: "in" };
const pedir = (qs: string) => GET(new Request(`http://localhost/api/chat-ia/buscar${qs}`));
const resultado = (productos: unknown[]) => ({ productos, total: productos.length, etapa: "exacta" });
const pedidoDe = (consulta: string, porPagina: number, filtros: object = {}) => ({
  consulta,
  filtros,
  orden: "relevancia",
  pagina: 1,
  porPagina,
});
const contexto = { superficie: "chat", soloVisibles: true, disp: undefined };

beforeEach(() => {
  // chatIaHabilitado exige el flag Y la config de ai-api.
  vi.stubEnv("AI_API_URL", "https://ai.plataforma.example");
  vi.stubEnv("AI_API_KEY", "clave");
  vi.stubEnv("AI_AGENT_ID", "agente-1");
  buscarEnShop.mockReset();
  getArbolCategorias.mockReset();
  getArbolCategorias.mockResolvedValue([]);
  permitir.mockReset();
  permitir.mockReturnValue(true);
  setFlag("chat-ia", true);
});

describe("GET /api/chat-ia/buscar", () => {
  it("flag apagado ⇒ 404 sin buscar", async () => {
    setFlag("chat-ia", false);
    expect((await pedir("?q=lampara")).status).toBe(404);
    expect(buscarEnShop).not.toHaveBeenCalled();
  });

  it("sin q ⇒ 400", async () => {
    expect((await pedir("")).status).toBe(400);
    expect((await pedir("?q=%20%20")).status).toBe(400);
    expect(buscarEnShop).not.toHaveBeenCalled();
  });

  it("usa la búsqueda del Shop (motor, superficie chat) y devuelve la forma compacta", async () => {
    buscarEnShop.mockResolvedValue(resultado([producto]));
    const res = await pedir("?q=lampara&limit=3");
    expect(res.status).toBe(200);
    expect(buscarEnShop).toHaveBeenCalledWith(pedidoDe("lampara", 3), contexto);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual([
      { id: "1101", nombre: "Lámpara LED", marca: "Demo", precioReferencia: 121, stock: "disponible" },
    ]);
  });

  it("la consulta se recorta a 120 caracteres y el límite se acota (por defecto 8, máximo 10)", async () => {
    buscarEnShop.mockResolvedValue(resultado([]));
    await pedir(`?q=${"a".repeat(200)}&limit=50`);
    await pedir("?q=led&limit=0");
    await pedir("?q=led");
    expect(buscarEnShop.mock.calls.map((c) => [c[0].consulta.length, c[0].porPagina])).toEqual([
      [120, 10],
      [3, 8],
      [3, 8],
    ]);
  });

  it("no expone la etapa ni nada del motor", async () => {
    buscarEnShop.mockResolvedValue({ ...resultado([producto]), etapa: "tolerante", intentos: ["exacta", "tolerante"], ms: 4 });
    const res = await pedir("?q=lampra");
    const cuerpo = JSON.stringify(await res.json());
    expect(cuerpo).not.toMatch(/etapa|intentos|tolerante|"ms"/);
  });

  it("tabla disponible pero flag busqueda-ia apagado ⇒ no pide atributos", async () => {
    disponibles.mockResolvedValue(true);
    setFlag("busqueda-ia", false);
    buscarEnShop.mockResolvedValue(resultado([producto]));
    await pedir("?q=lampara&limit=3");
    expect(buscarEnShop).toHaveBeenCalledWith(pedidoDe("lampara", 3), contexto);
    disponibles.mockResolvedValue(false);
  });

  it("con busqueda-ia y catalog_atributos disponible pide los atributos y los devuelve compactos", async () => {
    setFlag("busqueda-ia", true);
    disponibles.mockResolvedValueOnce(true);
    buscarEnShop.mockResolvedValue(
      resultado([{ ...producto, atributosEstructurados: { potencia_w: { n: 9, t: null }, zocalo: { n: null, t: "e27" } } }]),
    );
    const res = await pedir("?q=lampara&limit=3");
    expect(buscarEnShop).toHaveBeenCalledWith(pedidoDe("lampara", 3, { atributosEstructurados: true }), contexto);
    expect((await res.json())[0].atributos).toEqual({ potencia_w: 9, zocalo: "e27" });
  });

  it("si el motor falla ⇒ 502 con un mensaje en usted y sin detalles internos", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    buscarEnShop.mockRejectedValue(new Error("password authentication failed for user x"));
    const res = await pedir("?q=lampara");
    expect(res.status).toBe(502);
    const cuerpo = await res.json();
    expect(cuerpo).toEqual({ error: "No se pudo buscar en el catálogo." });
    expect(JSON.stringify(cuerpo)).not.toContain("password");
    log.mockRestore();
  });

  it("rate limit ⇒ 429", async () => {
    permitir.mockReturnValue(false);
    expect((await pedir("?q=lampara")).status).toBe(429);
    expect(buscarEnShop).not.toHaveBeenCalled();
  });
});

describe("GET /api/chat-ia/buscar?facetas=1", () => {
  const reflector = {
    id: "1102",
    name: "REFLECTOR LED 50W CALIDO IP65",
    brand: "GENROD",
    price: 100,
    precioFinal: 121,
    stock: "in",
    category: "ILUMINACION",
    categoriaPropiaId: "c1",
  };

  it("devuelve productos y facetas con los ids que filtra el catálogo", async () => {
    buscarEnShop.mockResolvedValue(resultado([reflector, producto]));
    getArbolCategorias.mockResolvedValue([{ id: "c1", parentId: null, nombre: "Reflectores", orden: 1 }]);
    const res = await pedir("?q=reflector&facetas=1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.productos).toHaveLength(2);
    expect(body.productos[0]).toMatchObject({ id: "1102", nombre: "REFLECTOR LED 50W CALIDO IP65" });
    expect(body.facetas).toEqual({
      categorias: [{ id: "Reflectores", nombre: "Reflectores" }],
      marcas: [
        { id: "GENROD", nombre: "Genrod" },
        { id: "Demo", nombre: "Demo" },
      ],
      atributos: [
        { id: "tono-calido", nombre: "Luz cálida" },
        { id: "apto-exterior", nombre: "Apto exterior" },
      ],
    });
  });

  it("sin el parámetro, el array de siempre (compatible)", async () => {
    buscarEnShop.mockResolvedValue(resultado([reflector]));
    expect(Array.isArray(await (await pedir("?q=reflector")).json())).toBe(true);
    expect(getArbolCategorias).not.toHaveBeenCalled();
  });

  it("si el árbol falla, las categorías salen de Alegra", async () => {
    buscarEnShop.mockResolvedValue(resultado([reflector]));
    getArbolCategorias.mockRejectedValue(new Error("db"));
    const body = await (await pedir("?q=reflector&facetas=1")).json();
    expect(body.facetas.categorias).toEqual([{ id: "ILUMINACION", nombre: "Iluminación" }]);
  });
});
