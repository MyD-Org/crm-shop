import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

const getCatalogo = vi.fn();
const getArbolCategorias = vi.fn();
const permitir = vi.fn();
vi.mock("@/lib/catalog", () => ({
  getCatalogo: (...a: unknown[]) => getCatalogo(...a),
  getArbolCategorias: () => getArbolCategorias(),
}));
vi.mock("@/lib/rate-limit", () => ({ permitir: (...a: unknown[]) => permitir(...a) }));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: true, cuotas: false }) }));

import { GET } from "./route";

const producto = { id: "1101", name: "Lámpara LED", brand: "Demo", price: 100, precioFinal: 121, stock: "in" };
const pedir = (qs: string) => GET(new Request(`http://localhost/api/chat-ia/buscar${qs}`));

beforeEach(() => {
  // chatIaHabilitado exige el flag Y la config de ai-api.
  vi.stubEnv("AI_API_URL", "https://ai.plataforma.example");
  vi.stubEnv("AI_API_KEY", "clave");
  vi.stubEnv("AI_AGENT_ID", "agente-1");
  getCatalogo.mockReset();
  getArbolCategorias.mockReset();
  getArbolCategorias.mockResolvedValue([]);
  permitir.mockReset();
  permitir.mockReturnValue(true);
  setFlag("chat-ia", true);
});

describe("GET /api/chat-ia/buscar", () => {
  it("flag apagado ⇒ 404 sin tocar el catálogo", async () => {
    setFlag("chat-ia", false);
    expect((await pedir("?q=lampara")).status).toBe(404);
    expect(getCatalogo).not.toHaveBeenCalled();
  });

  it("sin q ⇒ 400", async () => {
    expect((await pedir("")).status).toBe(400);
  });

  it("usa la búsqueda del Shop y devuelve la forma compacta", async () => {
    getCatalogo.mockResolvedValue([producto]);
    const res = await pedir("?q=lampara&limit=3");
    expect(res.status).toBe(200);
    expect(getCatalogo).toHaveBeenCalledWith({ busqueda: "lampara", limit: 3, soloVisibles: true });
    expect(await res.json()).toEqual([
      { id: "1101", nombre: "Lámpara LED", marca: "Demo", precioReferencia: 121, stock: "disponible" },
    ]);
  });

  it("sin resultados exactos ⇒ segundo intento tolerante", async () => {
    getCatalogo.mockResolvedValueOnce([]).mockResolvedValueOnce([producto]);
    const res = await pedir("?q=lampra");
    expect(getCatalogo).toHaveBeenLastCalledWith({ busqueda: "lampra", limit: 8, soloVisibles: true, tolerante: true });
    expect(await res.json()).toHaveLength(1);
  });

  it("falla el tolerante ⇒ lista vacía, no error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    getCatalogo.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("trgm"));
    const res = await pedir("?q=lampra");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    log.mockRestore();
  });

  it("rate limit ⇒ 429", async () => {
    permitir.mockReturnValue(false);
    expect((await pedir("?q=lampara")).status).toBe(429);
    expect(getCatalogo).not.toHaveBeenCalled();
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
    getCatalogo.mockResolvedValue([reflector, producto]);
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
    getCatalogo.mockResolvedValue([reflector]);
    expect(Array.isArray(await (await pedir("?q=reflector")).json())).toBe(true);
    expect(getArbolCategorias).not.toHaveBeenCalled();
  });

  it("si el árbol falla, las categorías salen de Alegra", async () => {
    getCatalogo.mockResolvedValue([reflector]);
    getArbolCategorias.mockRejectedValue(new Error("db"));
    const body = await (await pedir("?q=reflector&facetas=1")).json();
    expect(body.facetas.categorias).toEqual([{ id: "ILUMINACION", nombre: "Iluminación" }]);
  });
});
