import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import type { Product } from "@/data/products";
import type { PaginaCatalogo } from "@/lib/catalog";
import { planVacio, type PlanBusqueda } from "@/lib/busqueda-v2/plan";

/**
 * CONTRATO del chat con ai-api (platform ADR 0014), con el motor REAL y las lecturas falsas: la
 * respuesta no cambia de forma, de límites ni de garantías con el motor de búsqueda prendido o apagado
 * (`busqueda-motor-unico`). Lo que se mockea es lo que está AFUERA del motor: la lectura de la página
 * del catálogo, el plan, los flags públicos y la disponibilidad por sucursal.
 *
 * Fixtures con nombres y marcas inventados (repo público).
 */
type Lectura = {
  soloVisibles: boolean;
  filtros: { texto?: { q: string; plan?: unknown; tolerante?: boolean; codigo?: boolean }; soloStock?: boolean; atributosEstructurados?: boolean; categorias?: string[]; atributos?: string[] };
  porPagina: number;
  pagina: number;
  sinConteo: boolean;
  disp?: unknown;
};

const lecturas: Lectura[] = [];
const producto = (id: string, name: string, extra: Partial<Product> & { oculto?: boolean } = {}) =>
  ({ id, name, brand: "Demo", price: 100, precioFinal: 121, stock: "in", category: "ILUMINACION", ...extra }) as unknown as Product & { oculto?: boolean };

const CATALOGO: (Product & { oculto?: boolean })[] = [
  producto("1", "Lámpara LED 9W", { description: "x".repeat(400) }),
  producto("2", "Lámpara LED 12W agotada", { stock: "out" }),
  producto("3", "Lámpara LED oculta", { oculto: true }),
  ...Array.from({ length: 14 }, (_, i) => producto(`m${i}`, `Lámpara de prueba ${i}`)),
  producto("9", "Reflector exterior 50W", { atributosEstructurados: { potencia_w: { n: 50, t: null } } as never }),
];

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const terminos = (q: string) => sinTildes(q).split(/\s+/).filter(Boolean);
/** Parecido por typo: mismas 3 primeras letras y misma última (alcanza para "lampra" ~ "lampara"). */
const parecido = (t: string, palabra: string) => t.length >= 4 && palabra.slice(0, 3) === t.slice(0, 3);

const getPaginaCatalogo = vi.fn(async (a: Lectura): Promise<PaginaCatalogo> => {
  lecturas.push(a);
  const texto = a.filtros.texto;
  let hallados = CATALOGO.filter((p) => !(a.soloVisibles && p.oculto));
  if (texto?.plan) {
    // Etapa plan: recupera por los términos del plan.
    const plan = texto.plan as { blandos: { terminos: { texto: string }[] } };
    const ts = plan.blandos.terminos.map((t) => sinTildes(t.texto));
    hallados = hallados.filter((p) => ts.some((t) => sinTildes(p.name).includes(t)));
    if (texto.tolerante) {
      // Tolerante con plan: suma el parecido por término.
      const extra = CATALOGO.filter((p) => !(a.soloVisibles && p.oculto)).filter((p) => terminos(texto.q).some((t) => sinTildes(p.name).split(/\s+/).some((w) => parecido(t, w))));
      hallados = [...new Set([...hallados, ...extra])];
    }
  } else if (texto?.tolerante) {
    hallados = hallados.filter((p) => terminos(texto.q).some((t) => sinTildes(p.name).split(/\s+/).some((w) => w.includes(t) || parecido(t, w))));
  } else if (texto) {
    hallados = hallados.filter((p) => terminos(texto.q).every((t) => sinTildes(p.name).includes(t)));
  }
  // Como la lectura de verdad: los atributos estructurados sólo viajan si se piden.
  const productos = hallados
    .slice(0, a.porPagina)
    .map((p) => (a.filtros.atributosEstructurados ? p : { ...p, atributosEstructurados: undefined })) as unknown as Product[];
  return { productos, total: productos.length, pagina: 1, paginas: 1, totalExacto: false };
});
const planParaPagina = vi.fn<(q: string, o: unknown) => Promise<PlanBusqueda | null>>(async () => null);
const getArbolCategorias = vi.fn(async () => [] as { id: string; parentId: string | null; nombre: string; orden: number }[]);
const dispCatalogo = vi.fn(async (): Promise<unknown> => undefined);
const atributosDisponibles = vi.fn(async () => false);
const soloVisibles = vi.fn(async () => true);

vi.mock("@/lib/catalog", () => ({
  getPaginaCatalogo: (a: Lectura) => getPaginaCatalogo(a),
  contarCatalogo: async () => 0,
  getArbolCategorias: () => getArbolCategorias(),
}));
vi.mock("@/lib/catalogo-publico", () => ({ paginaCatalogoPublica: async () => ({ productos: [], total: 0, pagina: 1, paginas: 1 }), facetasPublicas: async () => ({}) }));
vi.mock("@/lib/busqueda-v2/servidor", () => ({ planParaPagina: (q: string, o: unknown) => planParaPagina(q, o) }));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: await soloVisibles(), cuotas: false }) }));
vi.mock("@/lib/zona-servidor", () => ({ dispCatalogo: () => dispCatalogo() }));
vi.mock("@/lib/catalogo-atributos-disponibles", () => ({ atributosEstructuradosDisponibles: () => atributosDisponibles() }));
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));

import { GET } from "./route";

const pedir = (qs: string) => GET(new Request(`http://localhost/api/chat-ia/buscar${qs}`));
/** Un plan que aporta (categoría + los términos de la consulta): lo que el plan real arma para una consulta de producto. */
const planDe = (q: string): PlanBusqueda => ({
  ...planVacio(q),
  blandos: { categorias: [{ nombre: "ILUMINACION", peso: 0.9 }], atributos: [], terminos: terminos(q).map((texto) => ({ texto, peso: 1 })) },
});

const CLAVES_AGENTE = ["id", "nombre", "marca", "categoria", "precioReferencia", "stock", "descripcion", "atributos"];

beforeEach(() => {
  vi.stubEnv("AI_API_URL", "https://ai.plataforma.example");
  vi.stubEnv("AI_API_KEY", "clave");
  vi.stubEnv("AI_AGENT_ID", "agente-1");
  lecturas.length = 0;
  getPaginaCatalogo.mockClear();
  planParaPagina.mockReset();
  planParaPagina.mockImplementation(async (q) => planDe(q));
  getArbolCategorias.mockClear();
  dispCatalogo.mockReset();
  dispCatalogo.mockResolvedValue(undefined);
  atributosDisponibles.mockReset();
  atributosDisponibles.mockResolvedValue(false);
  soloVisibles.mockReset();
  soloVisibles.mockResolvedValue(true);
  setFlag("chat-ia", true);
  setFlag("busqueda-ia", true);
});

describe.each([
  { motor: false, politica: "legado" },
  { motor: true, politica: "cascada" },
])("contrato del chat con busqueda-motor-unico=$motor ($politica)", ({ motor }) => {
  beforeEach(() => setFlag("busqueda-motor-unico", motor));

  it("sin facetas: un array de ProductoAgente cuyas claves son un subconjunto de las permitidas, sin `etapa`", async () => {
    const res = await pedir("?q=lampara%20led&limit=5");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.has("x-busqueda-etapa")).toBe(false);
    const cuerpo = await res.json();
    expect(Array.isArray(cuerpo)).toBe(true);
    expect(cuerpo.length).toBeGreaterThan(0);
    for (const item of cuerpo) {
      expect(Object.keys(item).every((k) => CLAVES_AGENTE.includes(k))).toBe(true);
      expect(item).not.toHaveProperty("etapa");
      expect(["disponible", "pocas unidades", "sin stock"]).toContain(item.stock);
      expect(typeof item.precioReferencia).toBe("number");
      if (item.descripcion) expect(item.descripcion.length).toBeLessThanOrEqual(200);
    }
    expect(JSON.stringify(cuerpo)).not.toMatch(/etapa|intentos|truncado|"ms"|politica/);
  });

  it("con facetas=1: { productos, facetas: { categorias, marcas, atributos } } derivadas sólo de los productos devueltos", async () => {
    const res = await pedir("?q=reflector&facetas=1");
    const cuerpo = await res.json();
    expect(Object.keys(cuerpo).sort()).toEqual(["facetas", "productos"]);
    expect(Object.keys(cuerpo.facetas).sort()).toEqual(["atributos", "categorias", "marcas"]);
    expect(cuerpo.productos.map((p: { id: string }) => p.id)).toEqual(["9"]);
    expect(cuerpo.facetas.marcas).toEqual([{ id: "Demo", nombre: "Demo" }]);
    for (const lista of Object.values(cuerpo.facetas) as { id: string; nombre: string }[][]) {
      for (const item of lista) expect(Object.keys(item).sort()).toEqual(["id", "nombre"]);
    }
    expect(JSON.stringify(cuerpo)).not.toMatch(/etapa/);
  });

  it("el límite se acota (máximo 10, por defecto 8) y nunca se devuelven más de 10 productos", async () => {
    for (const [qs, esperado] of [
      ["?q=lampara&limit=50", 10],
      ["?q=lampara&limit=0", 8],
      ["?q=lampara", 8],
      ["?q=lampara&limit=3", 3],
    ] as const) {
      lecturas.length = 0;
      const cuerpo = await (await pedir(qs)).json();
      expect(cuerpo.length).toBeLessThanOrEqual(10);
      expect(cuerpo).toHaveLength(esperado);
      expect(lecturas.every((l) => l.porPagina === esperado)).toBe(true);
      // Sin paginar ni contar: el agente mira los primeros resultados.
      expect(lecturas.every((l) => l.pagina === 1 && l.sinConteo)).toBe(true);
    }
  });

  it("sin filtro de stock: un producto agotado puede aparecer, con stock \"sin stock\"", async () => {
    const cuerpo = await (await pedir("?q=agotada")).json();
    expect(cuerpo).toEqual([expect.objectContaining({ id: "2", stock: "sin stock" })]);
    expect(lecturas.every((l) => l.filtros.soloStock === undefined)).toBe(true);
  });

  it("un id oculto NUNCA aparece (soloVisibles en todas las etapas, incluida la tolerante)", async () => {
    // "lampra" (typo): exacta 0 => tolerante. El producto oculto coincide con el texto.
    const cuerpo = await (await pedir("?q=lampra%20oculta")).json();
    expect(lecturas.some((l) => l.filtros.texto?.tolerante)).toBe(true);
    expect(lecturas.every((l) => l.soloVisibles === true)).toBe(true);
    expect(cuerpo.map((p: { id: string }) => p.id)).not.toContain("3");
    const todos = await (await pedir("?q=lampara&limit=10")).json();
    expect(todos.map((p: { id: string }) => p.id)).not.toContain("3");
  });

  it("disp y atributosEstructurados se propagan a todas las lecturas, como hoy", async () => {
    const disp = { zona: "z", sucursales: [] };
    dispCatalogo.mockResolvedValue(disp);
    atributosDisponibles.mockResolvedValue(true);
    const cuerpo = await (await pedir("?q=reflector")).json();
    expect(lecturas.length).toBeGreaterThan(0);
    expect(lecturas.every((l) => l.disp === disp)).toBe(true);
    expect(lecturas.every((l) => l.filtros.atributosEstructurados === true)).toBe(true);
    expect(cuerpo[0].atributos).toEqual({ potencia_w: 50 });
  });

  it("sin atributos disponibles: no se pide atributosEstructurados ni hay clave `atributos`", async () => {
    const cuerpo = await (await pedir("?q=reflector")).json();
    expect(lecturas.every((l) => l.filtros.atributosEstructurados === undefined)).toBe(true);
    expect(cuerpo[0]).not.toHaveProperty("atributos");
  });

  it("un typo se resuelve en la tolerante y no pasa de 10 productos", async () => {
    const cuerpo = await (await pedir("?q=lampra&limit=50")).json();
    expect(lecturas.some((l) => l.filtros.texto?.tolerante)).toBe(true);
    expect(cuerpo.length).toBeGreaterThan(0);
    expect(cuerpo.length).toBeLessThanOrEqual(10);
  });
});

describe("el flag cambia la semántica de la búsqueda, no el contrato", () => {
  it("apagado: el chat busca exacta y tolerante y NO pide plan; prendido: pide el plan (cascada)", async () => {
    setFlag("busqueda-motor-unico", false);
    await pedir("?q=lampara");
    expect(planParaPagina).not.toHaveBeenCalled();
    expect(lecturas.map((l) => Object.keys(l.filtros.texto ?? {}).sort().join())).toEqual(["q"]);

    lecturas.length = 0;
    setFlag("busqueda-motor-unico", true);
    await pedir("?q=lampara");
    expect(planParaPagina).toHaveBeenCalledTimes(1);
    expect(planParaPagina.mock.calls[0][0]).toBe("lampara");
    expect(lecturas[0].filtros.texto?.plan).toBeDefined();
  });

  it("prendido pero busqueda-ia apagado: sin plan (la clásica), con la misma forma de respuesta", async () => {
    setFlag("busqueda-motor-unico", true);
    setFlag("busqueda-ia", false);
    const cuerpo = await (await pedir("?q=lampara&limit=3")).json();
    expect(planParaPagina).not.toHaveBeenCalled();
    expect(cuerpo).toHaveLength(3);
  });

  it("prendido: una frase que la AND de todas las palabras no encuentra se resuelve por el plan", async () => {
    // "algo de lampara para la cocina": la exacta pide TODAS las palabras y da 0; el plan recupera por "lampara".
    const q = "algo%20de%20lampara%20para%20la%20cocina";
    setFlag("busqueda-motor-unico", false);
    const antes = await (await pedir(`?q=${q}&limit=4`)).json();
    setFlag("busqueda-motor-unico", true);
    const despues = await (await pedir(`?q=${q}&limit=4`)).json();
    expect(despues.length).toBeGreaterThan(0);
    expect(despues.length).toBeGreaterThanOrEqual(antes.length);
    expect(despues.every((p: { id: string }) => p.id !== "3")).toBe(true);
  });

  it("si el plan falla, el chat sigue respondiendo (sin plan) y no devuelve 5xx", async () => {
    setFlag("busqueda-motor-unico", true);
    planParaPagina.mockRejectedValue(new Error("plan caído"));
    const res = await pedir("?q=lampara&limit=3");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(3);
  });

  it("si el flag no se puede evaluar, el chat responde con la búsqueda de siempre (sin 5xx)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/busqueda-motor-flag", () => ({ busquedaMotorUnico: async () => Promise.reject(new Error("flags caído")) }));
    const { GET: aislada } = await import("./route");
    const res = await aislada(new Request("http://localhost/api/chat-ia/buscar?q=lampara&limit=3"));
    expect(res.status).toBe(200);
    expect(planParaPagina).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/busqueda-motor-flag");
  });
});
