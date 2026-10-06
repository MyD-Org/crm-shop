import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `planParaPagina` (la página con `ia=1`) NUNCA llama a Jev ni escribe la
 * caché; `planParaBuscar` (`/buscar`) usa Jev si hay key y guarda el plan.
 */
const consultarJev = vi.fn();
const guardarPlan = vi.fn(async () => {});
const leerPlan = vi.fn(async () => null);

vi.mock("../catalog", () => ({
  getArbolCategorias: async () => [
    { id: "i", parentId: null, nombre: "ILUMINACION", orden: 1 },
    { id: "r", parentId: "i", nombre: "Reflectores", orden: 1 },
    { id: "t", parentId: "i", nombre: "Tubos", orden: 2 },
    { id: "e", parentId: null, nombre: "ELECTRICIDAD", orden: 2 },
  ],
  contarCatalogo: async () => 10,
}));
vi.mock("../catalogo-atributos-disponibles", () => ({ atributosEstructuradosDisponibles: async () => false }));
vi.mock("../busqueda-inteligente/jev", async (original) => ({
  ...(await original<typeof import("../busqueda-inteligente/jev")>()),
  consultarJev: (...args: unknown[]) => consultarJev(...args),
}));
vi.mock("./cache", async (original) => {
  const real = await original<typeof import("./cache")>();
  return { ...real, guardarPlan: (...a: unknown[]) => guardarPlan(...(a as [])), leerPlan: (...a: unknown[]) => leerPlan(...(a as [])), lru: new real.Lru(10, 60_000) };
});

import { createHash } from "node:crypto";
import { hashArbol } from "../busqueda-inteligente/cache";
import { JEV_POR_IP_POR_MINUTO } from "../busqueda-inteligente/limite";
import { clavePlan, planParaBuscar, planParaPagina } from "./servidor";

const opciones = { soloVisibles: false };

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  vi.stubEnv("JEV_API_KEY", "clave-de-prueba");
  consultarJev.mockReset();
  guardarPlan.mockClear();
  leerPlan.mockClear();
});

describe("planParaPagina", () => {
  it("sin caché recalcula SIN Jev y no guarda nada", async () => {
    const plan = await planParaPagina("reflector para el patio", opciones);
    expect(plan?.fuente).toBe("deterministico");
    expect(plan?.blandos.categorias).toEqual([{ nombre: "Reflectores", peso: 0.8 }]);
    expect(consultarJev).not.toHaveBeenCalled();
    expect(guardarPlan).not.toHaveBeenCalled();
    expect(leerPlan).toHaveBeenCalledWith("tenant-test", "reflector para el patio", expect.any(String), false);
  });
});

describe("planParaBuscar", () => {
  it("con key consulta a Jev, guarda el plan y la página siguiente lo lee de memoria", async () => {
    consultarJev.mockImplementation(async (_c: string, preguntas: Record<string, unknown>) =>
      "sub" in preguntas
        ? { sub: { choice: "reflectores", confidence: 0.97 } }
        : { intencion: { choice: "producto", confidence: 0.99 }, raiz: { choice: "iluminacion", confidence: 0.99 } },
    );
    const r = await planParaBuscar("Reflector LED", { ...opciones, ip: "1.2.3.4" });
    expect(r?.plan.duros.categorias).toEqual(["Reflectores"]);
    expect(r?.plan.consulta).toBe("Reflector LED");
    expect(consultarJev).toHaveBeenCalledTimes(2);
    expect(guardarPlan).toHaveBeenCalledTimes(1);
    expect(leerPlan).toHaveBeenCalledWith("tenant-test", "reflector led", expect.any(String), true);

    const enPagina = await planParaPagina("reflector led", opciones);
    expect(enPagina?.fuente).toBe("cache");
    expect(enPagina?.duros.categorias).toEqual(["Reflectores"]);
    expect(consultarJev).toHaveBeenCalledTimes(2);
  });

  it("Jev caído: no guarda (se reintenta la próxima)", async () => {
    consultarJev.mockResolvedValue(null);
    const r = await planParaBuscar("colgante para el comedor", { ...opciones, ip: "1.2.3.4" });
    expect(r?.plan.fuente).toBe("deterministico");
    expect(guardarPlan).not.toHaveBeenCalled();
  });
});

describe("clave y cupo de la caché", () => {
  it("la clave cambia con el flag catalogo-solo-visibles (lo único que cambia el conteo)", async () => {
    const arbol = [{ id: "i", parentId: null, nombre: "ILUMINACION", orden: 1 }];
    expect(clavePlan(arbol, true)).not.toBe(clavePlan(arbol, false));
    expect(clavePlan(arbol, false)).toHaveLength(32);
    // Los planes guardados con las reglas anteriores (sin versión en la clave) no se vuelven a leer.
    const antes = createHash("sha256").update(`${hashArbol(arbol)}:0`).digest("hex").slice(0, 32);
    expect(clavePlan(arbol, false)).not.toBe(antes);
    await planParaPagina("velador", { soloVisibles: true });
    await planParaPagina("velador", { soloVisibles: false });
    const hashes = leerPlan.mock.calls.map((c) => (c as unknown[])[2]);
    expect(new Set(hashes).size).toBe(2);
  });

  it("sin JEV_API_KEY las escrituras en la base tienen el mismo tope por IP que Jev", async () => {
    vi.stubEnv("JEV_API_KEY", "");
    const total = JEV_POR_IP_POR_MINUTO + 5;
    for (let i = 0; i < total; i++) {
      const r = await planParaBuscar(`colgante modelo ${"x".repeat(i + 1)}`, { ...opciones, ip: "198.51.100.9" });
      expect(r?.plan).toBeTruthy();
    }
    expect(consultarJev).not.toHaveBeenCalled();
    expect(guardarPlan).toHaveBeenCalledTimes(JEV_POR_IP_POR_MINUTO);
  });
});
