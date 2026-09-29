import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

const getCatalogo = vi.fn();
const permitir = vi.fn();
vi.mock("@/lib/catalog", () => ({ getCatalogo: (...a: unknown[]) => getCatalogo(...a) }));
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
