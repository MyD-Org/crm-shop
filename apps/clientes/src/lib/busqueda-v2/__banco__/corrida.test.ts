import { describe, expect, it, vi } from "vitest";
import type { BusquedaBanco, ResultadoBanco } from "./banco";
import { correr, sonComparables, type Cabecera, type DepsCorrida, type OpcionesCorrida } from "./corrida";
import { VISTA_ACTUAL, vistaProduccion } from "./vista";

const arbol = [{ id: "c1", parentId: null, nombre: "Lamparas", orden: 1 }];
const vacio = { categoriasDuras: [], categoriasBlandas: [], atributosDuros: [], expansiones: [] };
const prod = (name: string, categoriaPropiaId?: string) => ({ name, categoriaPropiaId });

const casos: BusquedaBanco[] = [
  { q: "lampara generica uno", perfil: "particular", intencion: "producto", categoria: ["Lamparas"], debeIncluirEnTop24: ["lampara"], nuncaSinResultados: true },
  { q: "lampra generica dos", perfil: "particular", tipo: "typo", debeIncluirEnTop24: ["lampara"], nuncaSinResultados: true },
  { q: "XQ-1", perfil: "codigo", intencion: "codigo", sinDuros: true },
];

const respuestas: Record<string, ResultadoBanco> = {
  "lampara generica uno": { ...vacio, intencion: "producto", categoriasDuras: ["Lamparas"], productos: [prod("lampara e27", "c1"), prod("otro")], total: 2, ms: 10 },
  "lampra generica dos": { ...vacio, intencion: "producto", productos: [], total: 0, ms: 20 },
  "XQ-1": { ...vacio, intencion: "codigo", productos: [prod("x")], total: 1, ms: 5 },
};

const snapshot = { universo: { activos: 10, publicados: 7, conStock: 5, publicadosConStock: 4, sinOverlay: 3, sinCategoria: 1 }, categorias: 1, arbolHash: "a".repeat(32), estructurados: true };

function deps(p: Partial<DepsCorrida> = {}): DepsCorrida {
  return {
    arbol,
    ejecutar: vi.fn(async (q: string) => respuestas[q] ?? { ...vacio, productos: [], total: 0 }),
    snapshot,
    git: () => ({ sha: "abc1234", sucio: false }),
    ahora: (() => { let t = 1000; return () => (t += 7); })(),
    fecha: () => new Date("2026-01-02T03:04:05.000Z"),
    ...p,
  };
}

function opciones(p: Partial<OpcionesCorrida> = {}): OpcionesCorrida {
  return {
    tuberia: "v2",
    jev: "grabado",
    jevMeta: { modelo: "jev-x", grabadoEl: "2026-01-01" },
    vista: VISTA_ACTUAL,
    produccion: false,
    banco: { origen: "versionado", local: false, privado: false, casos, hash: "0123456789ab" },
    repeticiones: 1,
    calentar: 0,
    flagsDeclarados: {},
    verConsultas: false,
    tenantAlias: "shop",
    ...p,
  };
}

describe("correr: armado del reporte", () => {
  it("cabecera completa: fecha ISO, sha, tubería, jev, banco, vista, flags, snapshot, repeticiones", async () => {
    const { json } = await correr(opciones({ flagsDeclarados: { "busqueda-ia": "on" }, umbral: 85 }), deps());
    expect(json.esquema).toBe(1);
    expect(json.cabecera).toMatchObject({
      fecha: "2026-01-02T03:04:05.000Z",
      gitSha: "abc1234",
      sucio: false,
      tuberia: "v2",
      jev: { modo: "grabado", modelo: "jev-x", grabadoEl: "2026-01-01" },
      banco: { origen: "versionado", n: 3, hash: "0123456789ab" },
      vista: { variante: "banco", soloVisibles: false, soloStock: false },
      flags: { "busqueda-ia": "on" },
      snapshot,
      repeticiones: 1,
      tenantAlias: "shop",
      umbral: 85,
    });
    expect(typeof json.cabecera.duracionMs).toBe("number");
  });

  it("la vista de producción se declara como tal", async () => {
    const { json } = await correr(opciones({ vista: vistaProduccion(true), produccion: true }), deps());
    expect(json.cabecera.vista).toEqual({ variante: "produccion", soloVisibles: true, soloStock: true });
  });

  it("tubería sin Jev: el modo queda 'no aplica'", async () => {
    const { json } = await correr(opciones({ tuberia: "clasica", jev: "no aplica", jevMeta: undefined }), deps());
    expect(json.cabecera.jev).toEqual({ modo: "no aplica", modelo: null, grabadoEl: null });
  });

  it("resumen, cortes y casos: métricas por total y por perfil/intención/tipo", async () => {
    const { json } = await correr(opciones(), deps());
    expect(json.resumen.n).toBe(3);
    expect(json.resumen.zeroTotal).toBe(1);
    expect(json.resumen.zeroIndebido).toBe(1);
    expect(json.resumen.hit24).toBeCloseTo(0.5, 5);
    expect(Object.keys(json.cortes.perfil).sort()).toEqual(["codigo", "particular"]);
    expect(Object.keys(json.cortes.tipo).sort()).toEqual(["codigo", "producto", "typo"]);
    expect(Object.keys(json.cortes.intencion).length).toBeGreaterThan(0);
    expect(json.casos).toHaveLength(3);
    expect(json.casos[0]).toMatchObject({ idx: 0, q: "lampara generica uno", posicion: 1, total: 2, tipo: "producto", perfil: "particular" });
    expect(json.latencia).toEqual(json.resumen.latencia);
  });

  it("el JSON es válido, estable (mismo orden de claves) y reproducible", async () => {
    const a = JSON.stringify((await correr(opciones(), deps())).json);
    const b = JSON.stringify((await correr(opciones(), deps())).json);
    expect(a).toBe(b);
    expect(() => JSON.parse(a)).not.toThrow();
    expect(Object.keys(JSON.parse(a))).toEqual(["esquema", "cabecera", "resumen", "cortes", "latencia", "excluidos", "casos"]);
    expect(Object.keys(JSON.parse(a).cabecera).slice(0, 4)).toEqual(["fecha", "gitSha", "sucio", "tuberia"]);
  });

  it("sin secretos: no aparecen variables de entorno ni cadenas de conexión", async () => {
    const previa = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://usuario:s3cr3t-placeholder@host.example/db";
    try {
      const { json, texto } = await correr(opciones(), deps());
      for (const s of [JSON.stringify(json), texto]) {
        expect(s).not.toContain("s3cr3t-placeholder");
        expect(s).not.toContain("postgres://");
        expect(s).not.toContain("DATABASE_URL");
      }
    } finally {
      if (previa === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previa;
    }
  });

  it("calentar no cuenta: se ejecutan pero no entran a las métricas", async () => {
    const d = deps();
    const { json } = await correr(opciones({ calentar: 2 }), d);
    expect(d.ejecutar).toHaveBeenCalledTimes(2 + 3);
    expect(json.resumen.n).toBe(3);
    expect(json.casos).toHaveLength(3);
    expect(json.cabecera.calentar).toBe(2);
  });

  it("repeticiones: la relevancia sale de la 1ra; p50/p95 de todas las muestras", async () => {
    let llamada = 0;
    const ejecutar = vi.fn(async (q: string) => {
      llamada++;
      const base = respuestas[q];
      // La 1ra repetición de cada caso es la que cuenta; las otras traen basura de relevancia y distinta latencia.
      return llamada % 3 === 1 ? base : { ...base, productos: [], total: 0, ms: 100 };
    });
    const { json } = await correr(opciones({ repeticiones: 3 }), deps({ ejecutar }));
    expect(ejecutar).toHaveBeenCalledTimes(9);
    expect(json.resumen.zeroTotal).toBe(1);
    expect(json.resumen.latencia.n).toBe(9);
    expect(json.resumen.latencia.p95).toBe(100);
    expect(json.cabecera.repeticiones).toBe(3);
  });
});

describe("correr: banco privado", () => {
  const privado = () => opciones({ banco: { origen: "banco-real.local.json", local: true, privado: true, casos, hash: "ffffffffffff" } });

  it("enmascara q como #idx en el JSON y en el texto", async () => {
    const { json, texto } = await correr(privado(), deps());
    for (const c of casos) {
      expect(JSON.stringify(json)).not.toContain(c.q);
      expect(texto).not.toContain(c.q);
    }
    expect(json.casos[0].q).toBeUndefined();
    expect(texto).toContain("#0");
    expect(texto).toContain("#2");
  });

  it("también se enmascara un banco local aunque no diga privado", async () => {
    const o = opciones({ banco: { origen: "x.local.json", local: true, privado: false, casos, hash: "ffffffffffff" } });
    const { json } = await correr(o, deps());
    expect(JSON.stringify(json)).not.toContain("lampara generica uno");
  });

  it("--ver-consultas levanta el enmascarado", async () => {
    const { json, texto } = await correr({ ...privado(), verConsultas: true }, deps());
    expect(json.casos[0].q).toBe("lampara generica uno");
    expect(texto).toContain("lampara generica uno");
  });

  it("el banco versionado (público) muestra las consultas", async () => {
    const { texto } = await correr(opciones(), deps());
    expect(texto).toContain("lampara generica uno");
  });

  it("la cabecera no incluye el contenido del banco, sólo n y hash", async () => {
    const { json } = await correr(privado(), deps());
    expect(json.cabecera.banco).toEqual({ origen: "banco-real.local.json", n: 3, hash: "ffffffffffff" });
  });
});

describe("correr: Jev grabado sin respuesta", () => {
  it("excluye el caso de las métricas, lo cuenta y lo marca", async () => {
    const d = deps({ sinGrabacion: (c) => c.q === "lampra generica dos" });
    const { json, texto } = await correr(opciones(), d);
    expect(json.resumen.n).toBe(2);
    expect(json.excluidos.sinGrabacion).toBe(1);
    expect(json.casos).toHaveLength(3);
    expect(json.casos[1].sinGrabacion).toBe(true);
    expect(json.resumen.zeroTotal).toBe(0);
    expect(texto).toMatch(/sin grabación/i);
  });

  it("no llama a Jev en vivo para completarlo (el ejecutor igual corre el caso)", async () => {
    const d = deps({ sinGrabacion: () => true });
    await correr(opciones(), d);
    expect(d.ejecutar).toHaveBeenCalledTimes(3);
  });
});

describe("correr: otros", () => {
  it("un caso que falla se evalúa como vacío y la corrida sigue", async () => {
    const log = vi.fn();
    const ejecutar = vi.fn(async (q: string) => {
      if (q === "XQ-1") throw new Error("boom: detalle interno");
      return respuestas[q];
    });
    const { json } = await correr(opciones(), deps({ ejecutar, log }));
    expect(json.resumen.n).toBe(3);
    expect(log).toHaveBeenCalled();
    expect(json.casos[2].total).toBe(0);
  });

  it("el error de un caso de banco privado no vuelca su consulta al log", async () => {
    const log = vi.fn();
    const ejecutar = vi.fn(async () => {
      throw new Error("fallo");
    });
    await correr(opciones({ banco: { origen: "x.local.json", local: true, privado: true, casos, hash: "f" } }), deps({ ejecutar, log }));
    for (const [m] of log.mock.calls) for (const c of casos) expect(String(m)).not.toContain(c.q);
  });

  it("cuenta los planes no cacheados (--jev=cache)", async () => {
    const ejecutar = vi.fn(async (q: string) => ({ ...respuestas[q], ...(q === "XQ-1" ? {} : { sinPlanCacheado: true }) }));
    const { json } = await correr(opciones({ jev: "cache" }), deps({ ejecutar }));
    expect(json.sinPlanCacheado).toBe(2);
  });

  it("corrida parcial: la cabecera lo declara", async () => {
    const { json } = await correr(opciones({ parcial: "diagnostico" }), deps());
    expect(json.cabecera.parcial).toBe("diagnostico");
  });

  it("el texto trae la tabla de siempre, las métricas ampliadas y la duración", async () => {
    const { texto } = await correr(opciones(), deps());
    expect(texto).toContain("Banco de búsquedas — tubería v2");
    expect(texto).toContain("conjunto     | n | intención");
    expect(texto).toContain("## Métricas ampliadas");
    expect(texto).toMatch(/duración total/i);
  });
});

describe("sonComparables", () => {
  const base = async (p: Partial<OpcionesCorrida> = {}, d: Partial<DepsCorrida> = {}): Promise<Cabecera> => (await correr(opciones(p), deps(d))).json.cabecera;

  it("mismo banco, snapshot, vista y Jev: comparables", async () => {
    const r = sonComparables(await base(), await base());
    expect(r).toEqual({ ok: true, motivos: [] });
  });

  it("distinto hash de banco: no comparables y lo dice", async () => {
    const otro = await base({ banco: { origen: "versionado", local: false, privado: false, casos, hash: "000000000000" } });
    const r = sonComparables(await base(), otro);
    expect(r.ok).toBe(false);
    expect(r.motivos.join(" ")).toMatch(/banco/i);
  });

  it("distinto snapshot del catálogo: no comparables", async () => {
    const otro = await base({}, { snapshot: { ...snapshot, arbolHash: "b".repeat(32) } });
    const r = sonComparables(await base(), otro);
    expect(r.ok).toBe(false);
    expect(r.motivos.join(" ")).toMatch(/cat[aá]logo|snapshot/i);
  });

  it("distinta vista o Jev: no comparables, salvo que se ignoren (matriz entre tuberías)", async () => {
    const prodv = await base({ vista: vistaProduccion(true), produccion: true });
    const sinJev = await base({ jev: "no" });
    expect(sonComparables(await base(), prodv).ok).toBe(false);
    expect(sonComparables(await base(), sinJev).ok).toBe(false);
    expect(sonComparables(await base(), sinJev, { ignorar: ["jev"] }).ok).toBe(true);
    expect(sonComparables(await base(), prodv, { ignorar: ["vista"] }).ok).toBe(true);
  });

  it("el sha y la fecha no cuentan: se compara contra corridas futuras", async () => {
    const otra = await base({}, { git: () => ({ sha: "fff0000", sucio: true }), fecha: () => new Date("2030-01-01T00:00:00Z") });
    expect(sonComparables(await base(), otra).ok).toBe(true);
  });
});

describe("correr: tubería motor (política, superficie, ids, etapa)", () => {
  const muchos = Array.from({ length: 30 }, (_, i) => ({ id: `id${i}`, name: i === 20 ? "lampara buscada" : `otro ${i}` }));
  const motor = (extra: Partial<ResultadoBanco> = {}): ResultadoBanco => ({
    ...vacio,
    intencion: "producto",
    productos: muchos,
    ids: muchos.map((p) => p.id!),
    total: 30,
    etapa: "exacta",
    ms: 4,
    ...extra,
  });
  const caso: BusquedaBanco[] = [{ q: "lampara buscada", perfil: "particular", debeIncluirEnTop24: ["lampara buscada"] }];
  const base = (p: Partial<OpcionesCorrida> = {}) =>
    opciones({ tuberia: "motor", politica: "legado", superficie: "chat", banco: { origen: "versionado", local: false, privado: false, casos: caso, hash: "abcdef012345" }, ...p });

  it("la superficie fija el K de la evaluación: el 21.º producto cuenta en el catálogo y no en el chat", async () => {
    const d = deps({ ejecutar: vi.fn(async () => motor()) });
    const catalogo = await correr(base({ superficie: "catalogo" }), d);
    const chat = await correr(base({ superficie: "chat" }), d);
    expect(catalogo.json.casos[0].top24Ok).toBe(true);
    expect(chat.json.casos[0].top24Ok).toBe(false);
    expect(chat.texto).toContain("top 10");
    expect(chat.texto).toContain("hit@10");
    expect(catalogo.texto).toContain("top 24");
  });

  it("la cabecera declara política y superficie (con su K y si cuenta)", async () => {
    const { json } = await correr(base({ superficie: "autocompletar" }), deps({ ejecutar: vi.fn(async () => motor()) }));
    expect(json.cabecera.politica).toBe("legado");
    expect(json.cabecera.superficie).toEqual({ nombre: "autocompletar", k: 8, conteo: false });
    expect(json.cabecera.tuberia).toBe("motor");
  });

  it("las tuberías viejas no suman política ni superficie a la cabecera", async () => {
    const { json } = await correr(opciones(), deps());
    expect("politica" in json.cabecera).toBe(false);
    expect("superficie" in json.cabecera).toBe(false);
  });

  it("etapa por caso y histograma de etapas (sólo agregados)", async () => {
    const { json, texto } = await correr(base(), deps({ ejecutar: vi.fn(async () => motor({ etapa: "tolerante" })) }));
    expect(json.casos[0].etapa).toBe("tolerante");
    expect(json.etapas).toEqual({ tolerante: 1 });
    expect(texto).toContain("etapas: tolerante 1");
  });

  it("los ids sólo van al JSON con --ids, recortados al K de la superficie", async () => {
    const d = deps({ ejecutar: vi.fn(async () => motor()) });
    const sin = await correr(base(), d);
    expect(sin.json.casos[0].ids).toBeUndefined();
    const con = await correr(base({ ids: true }), d);
    expect(con.json.casos[0].ids).toEqual(muchos.slice(0, 10).map((p) => p.id));
    expect(con.texto).not.toContain("id0");
  });

  it("sonComparables: otra superficie u otra política no se comparan salvo que se ignoren", async () => {
    const d = deps({ ejecutar: vi.fn(async () => motor()) });
    const chat = (await correr(base({ superficie: "chat" }), d)).json.cabecera;
    const catalogo = (await correr(base({ superficie: "catalogo" }), d)).json.cabecera;
    const cascada = (await correr(base({ politica: "cascada" }), d)).json.cabecera;
    expect(sonComparables(chat, catalogo).ok).toBe(false);
    expect(sonComparables(chat, catalogo).motivos.join(" ")).toMatch(/superficie/);
    expect(sonComparables(chat, cascada).motivos.join(" ")).toMatch(/pol[ií]tica/);
    expect(sonComparables(chat, cascada, { ignorar: ["politica"] }).ok).toBe(true);
    expect(sonComparables(chat, catalogo, { ignorar: ["superficie"] }).ok).toBe(true);
  });
});
