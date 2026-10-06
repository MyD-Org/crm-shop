/**
 * Banco de búsquedas OFFLINE (CI): corre *Entender* con las respuestas reales
 * de Jev grabadas (`jev-grabado.json`) y el árbol de categorías del tenant de
 * prueba (sólo nombres, `arbol-grabado.json`), sin base ni red. Verifica
 * intención, categorías duras/blandas, atributos explícitos y expansiones.
 * El conteo es falso: todas las categorías tienen productos salvo las que el
 * árbol grabado marca vacías.
 */
import { describe, expect, it } from "vitest";
import { entender } from "../entender/entender";
import type { PlanBusqueda } from "../plan";
import { pareceCodigo } from "../../busqueda-inteligente/gate";
import { normalizarConsulta, pareceDatoPersonal } from "../../busqueda-inteligente/normalizar";
import { BANCO, TIPOS_CONSULTA, tipoDe } from "./banco";
import arbolGrabado from "./arbol-grabado.json";
import grabado from "./jev-grabado.json";
import { jevGrabado, type JevGrabado } from "./jev-grabado";
import { cargarBancoDeArgs } from "./args";
import { hashBanco } from "./cargar-banco";
import { planDeMatriz } from "./matriz";

const { arbol, vacias } = arbolGrabado as {
  arbol: { id: string; parentId: string | null; nombre: string; orden: number }[];
  vacias: string[];
};
const contar = async ({ categorias }: { categorias: string[] }) => (categorias.some((c) => vacias.includes(c)) ? 0 : 50);
const jev = jevGrabado(grabado as JevGrabado);

async function planes(): Promise<Map<string, PlanBusqueda>> {
  const salida = new Map<string, PlanBusqueda>();
  for (const b of BANCO) {
    const r = await entender(b.q, { arbol, jev, contar });
    if (r) salida.set(b.q, r.plan);
  }
  return salida;
}

describe("banco offline (Entender con Jev grabado)", async () => {
  const porQ = await planes();
  const plan = (q: string) => porQ.get(q)!;

  it("todas las búsquedas producen un plan", () => {
    expect(porQ.size).toBe(BANCO.length);
  });

  it("intención: al menos 85 % de acierto", () => {
    const conIntencion = BANCO.filter((b) => b.intencion);
    const ok = conIntencion.filter((b) => plan(b.q).intencion === b.intencion);
    expect(ok.length / conIntencion.length).toBeGreaterThanOrEqual(0.85);
  });

  it("categoría (dura o la blanda principal): al menos 85 % de acierto", () => {
    const conCategoria = BANCO.filter((b) => b.categoria?.length);
    const ok = conCategoria.filter((b) => {
      const p = plan(b.q);
      return [...p.duros.categorias, ...p.blandos.categorias.slice(0, 1).map((c) => c.nombre)].some((c) => b.categoria!.includes(c));
    });
    expect(ok.length / conCategoria.length).toBeGreaterThanOrEqual(0.85);
  });

  it.each(BANCO.filter((b) => b.atributosDuros?.length))("atributos explícitos duros: $q", (b) => {
    expect(plan(b.q).duros.atributos).toEqual(expect.arrayContaining(b.atributosDuros!));
  });

  it.each(BANCO.filter((b) => b.expande?.length))("expansiones: $q", (b) => {
    const terminos = plan(b.q).blandos.terminos.map((t) => t.texto);
    for (const e of b.expande!) expect(terminos.some((t) => t.startsWith(e) || e.startsWith(t))).toBe(true);
  });

  it.each(BANCO.filter((b) => b.sinDuros))("sin categorías duras: $q", (b) => {
    expect(plan(b.q).duros.categorias).toEqual([]);
  });

  it("una categoría dura siempre tiene productos (nunca una vacía)", () => {
    for (const p of porQ.values()) for (const c of p.duros.categorias) expect(vacias).not.toContain(c);
  });
});

// ---------------------------------------------------------------------------------------------
// Casos sintéticos de la línea base (typos y medidas). Sólo lógica pura sobre el banco versionado.
// ---------------------------------------------------------------------------------------------

type Patron = "omision" | "duplicado" | "transposicion" | "tilde" | "sustitucion";

/** Cómo se erró `typo` respecto de `correcta` (o `null` si no es un error de un solo paso). */
function patronDeTypo(typo: string, correcta: string): Patron | null {
  const sinTildes = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "");
  if (typo === correcta) return null;
  if (sinTildes(typo) === sinTildes(correcta)) return "tilde";
  const sacar = (x: string, i: number) => x.slice(0, i) + x.slice(i + 1);
  if (typo.length === correcta.length - 1 && [...correcta].some((_, i) => sacar(correcta, i) === typo)) return "omision";
  if (typo.length === correcta.length + 1 && [...typo].some((c, i) => sacar(typo, i) === correcta && (typo[i - 1] === c || typo[i + 1] === c))) return "duplicado";
  if (typo.length === correcta.length) {
    const dif = [...typo].map((c, i) => (c === correcta[i] ? -1 : i)).filter((i) => i >= 0);
    if (dif.length === 2 && dif[1] === dif[0] + 1 && typo[dif[0]] === correcta[dif[1]] && typo[dif[1]] === correcta[dif[0]]) return "transposicion";
    if (dif.length === 1) return "sustitucion";
  }
  return null;
}

/** Cada typo del banco: la palabra mal escrita, la correcta y el patrón que ejemplifica. */
const TYPOS: Record<string, [typo: string, correcta: string, patron: Patron]> = {
  "lampra led e27": ["lampra", "lampara", "omision"],
  "termomagentico 2x20": ["termomagentico", "termomagnetico", "transposicion"],
  "extarctor de aire para cocina": ["extarctor", "extractor", "transposicion"],
  "reflecotr led exterior": ["reflecotr", "reflector", "transposicion"],
  "ventialdor de techo": ["ventialdor", "ventilador", "transposicion"],
  "contacor tripolar": ["contacor", "contactor", "omision"],
  "disyuntro diferencial": ["disyuntro", "disyuntor", "transposicion"],
  "panle led para embutir": ["panle", "panel", "transposicion"],
  "cable unipollar": ["unipollar", "unipolar", "duplicado"],
  "tira ledd para la cocina": ["ledd", "led", "duplicado"],
  "fotocelula para exterior": ["fotocelula", "fotocélula", "tilde"],
  "camara wifi interior": ["camara", "cámara", "tilde"],
  "zapatila con enchufes": ["zapatila", "zapatilla", "omision"],
  "luminaria de emerjencia": ["emerjencia", "emergencia", "sustitucion"],
  "calefactro para el baño": ["calefactro", "calefactor", "transposicion"],
};

const MEDIDAS: Record<string, RegExp> = {
  "NxM (2x20)": /\b\d+x\d+\b/,
  "amperes (20A)": /\b\d+\s?(a|amperes)\b/,
  "vatios (9W)": /\b\d+\s?w\b/,
  "kelvin (4000K)": /\b\d+\s?k\b/,
  "fracción (3/4)": /\b\d+\/\d+\b/,
  "largo en metros (5m)": /\b\d+(?:[.,]\d+)?\s?m\b/,
};

/** Fabricantes conocidos: el banco público es genérico (sin marcas ni nombres de productos reales). */
const MARCAS_PROHIBIDAS = /\b(philips|osram|schneider|siemens|legrand|bosch|makita|dewalt|stanley|samsung|xiaomi|tp-?link|hikvision|dahua)\b/i;

describe("banco versionado: casos de la línea base", () => {
  const porTipo = (t: string) => BANCO.filter((b) => tipoDe(b) === t);

  it("al menos 15 typos y 15 medidas", () => {
    expect(porTipo("typo").length).toBeGreaterThanOrEqual(15);
    expect(porTipo("medida").length).toBeGreaterThanOrEqual(15);
  });

  it("todo `tipo` explícito es válido y las consultas no se repiten", () => {
    for (const b of BANCO) if (b.tipo) expect(TIPOS_CONSULTA).toContain(b.tipo);
    const qs = BANCO.map((b) => normalizarConsulta(b.q) ?? b.q);
    expect(new Set(qs).size).toBe(qs.length);
  });

  describe("typos", () => {
    const typos = porTipo("typo");

    it.each(typos.map((b) => [b.q]))("«%s»: tiene su error de tipeo declarado y verificable", (q) => {
      const fila = TYPOS[q];
      expect(fila, `falta el caso en la tabla TYPOS del test`).toBeDefined();
      const [typo, correcta, patron] = fila;
      expect(q.toLowerCase()).toContain(typo);
      expect(q.toLowerCase()).not.toMatch(new RegExp(`(^|\\s)${correcta}(\\s|$)`));
      expect(patronDeTypo(typo, correcta)).toBe(patron);
    });

    it("cubre omisión, letra duplicada, transposición y tilde faltante", () => {
      const patrones = new Set(typos.map((b) => TYPOS[b.q]?.[2]));
      for (const p of ["omision", "duplicado", "transposicion", "tilde"]) expect(patrones).toContain(p);
    });

    it("todos esperan un resultado (nuncaSinResultados) y tienen expectativa de producto", () => {
      for (const b of typos) {
        expect(b.nuncaSinResultados).toBe(true);
        expect(b.debeIncluirEnTop24?.length || b.categoriaEnTop24?.length).toBeTruthy();
      }
    });
  });

  describe("medidas", () => {
    const medidas = porTipo("medida");

    it.each(Object.entries(MEDIDAS))("hay al menos un caso con %s", (_nombre, regex) => {
      expect(medidas.some((b) => regex.test(b.q.toLowerCase()))).toBe(true);
    });

    it("todas esperan un resultado", () => {
      for (const b of medidas) expect(b.nuncaSinResultados).toBe(true);
    });
  });

  it("higiene (repo público): ninguna consulta con @, 7+ dígitos seguidos ni marcas conocidas", () => {
    for (const b of BANCO) {
      expect(b.q, "arroba").not.toContain("@");
      expect(pareceDatoPersonal(b.q), "dato personal").toBe(false);
      expect(b.q).not.toMatch(MARCAS_PROHIBIDAS);
    }
  });

  it("los nombres de categoría esperados existen en el árbol grabado", () => {
    const nombres = new Set(arbol.map((n) => n.nombre));
    for (const b of BANCO) for (const c of [...(b.categoria ?? []), ...(b.categoriaEnTop24 ?? [])]) expect(nombres, c).toContain(c);
  });
});

describe("banco versionado: casos de medidas (busqueda-medidas, M1b)", () => {
  const conMedidas = BANCO.filter((b) => b.medidas !== undefined);
  const negativos = BANCO.filter((b) => b.medidas?.length === 0);

  it("carga al menos 120 casos", () => {
    expect(BANCO.length).toBeGreaterThanOrEqual(120);
  });

  it("al menos 25 casos con expectativa de medidas y 6 negativos (medidas: [])", () => {
    expect(conMedidas.length).toBeGreaterThanOrEqual(25);
    expect(negativos.length).toBeGreaterThanOrEqual(6);
  });

  it("cubre los ejemplos de la spec (R5.4), con su expectativa", () => {
    const de = (q: string) => BANCO.find((b) => normalizarConsulta(b.q) === normalizarConsulta(q));
    for (const q of [
      "termica 2x20", "bipolar 20a", "lampara 9w e27", "lampara 9,5w", "4000k", "dicroica 7w gu10", "tira led 12v 5m", "diferencial 40a 30ma",
      "panel 60x60", "cable 2,5mm", "ip65", "curva c", "6ka", "20a", "9w", "e27", "hasta 50w", "lampara de 10 a 20w",
    ]) {
      expect(de(q)?.medidas?.length, `falta el caso con medidas «${q}»`).toBeGreaterThan(0);
    }
    for (const q of ["DL-18W", "TM-2x16", "XQ-4471B", "2x20", "tira led 14w/m", "tubo led 120 cm"]) {
      expect(de(q)?.medidas, `falta el negativo «${q}»`).toEqual([]);
    }
    expect(de("cable unipolar 2.5 mm")?.sinMedidasDe).toEqual(["polos"]);
  });

  it("los casos duros (dura:true) son de claves discretas con valor, y nunca de un caso negativo", () => {
    for (const b of conMedidas) for (const m of b.medidas ?? []) if (m.dura) expect(m.valor, b.q).toBeDefined();
    for (const b of negativos) expect(b.medidas).toEqual([]);
  });

  it("entran a la matriz de la línea base: el banco sintético lo corren clasica, tolerante, fase1 y v2", () => {
    const { casos } = cargarBancoDeArgs({ etiquetas: "revisado" }).banco;
    expect(casos.filter((c) => c.medidas !== undefined)).toHaveLength(conMedidas.length);
    const tuberias = new Set(planDeMatriz({ bancoReal: false, jevVivo: false }).filter((e) => e.banco === "sintetico").map((e) => e.tuberia));
    expect([...tuberias].sort()).toEqual(["clasica", "fase1", "tolerante", "v2"]);
  });

  it("los 97 casos anteriores no cambian (mismo orden y mismas expectativas, salvo `medidas`/`sinMedidasDe`): sus métricas previas no se mueven", () => {
    const sinMedidas = BANCO.slice(0, 97).map((b) => {
      const c = { ...b };
      delete c.medidas;
      delete c.sinMedidasDe;
      return c;
    });
    // Hash del banco versionado ANTES de este cambio (97 casos). Si cambia, se tocó un caso que ya se medía.
    expect(hashBanco(sinMedidas)).toBe("e12dbb8461b0");
  });
});

/**
 * REQUIERE el paso manual U1: `npm run banco:grabar -- --solo-faltantes` (necesita JEV_API_KEY) y commitear
 * `jev-grabado.json`. Hasta entonces este bloque FALLA a propósito: los casos nuevos no tienen la respuesta de
 * Jev grabada y las mediciones offline de intención/categoría no los pueden evaluar.
 * Desde M1c (gate) los casos de un solo token-medida ("20a", "9w", "e27", "ip65", "6ka", "4000k")
 * dejan de ser códigos y también necesitan su respuesta grabada.
 */
describe("Jev grabado cubre todo el banco (U1: banco:grabar --solo-faltantes)", () => {
  it("toda consulta que no es un código tiene su respuesta grabada", () => {
    const sinGrabar = BANCO.filter((b) => {
      const norm = normalizarConsulta(b.q);
      return !!norm && !pareceCodigo(b.q) && !(norm in (grabado as JevGrabado).respuestas);
    });
    expect(sinGrabar.length, `${sinGrabar.length} consulta(s) sin grabar: corra «npm run banco:grabar -- --solo-faltantes»`).toBe(0);
  });
});
