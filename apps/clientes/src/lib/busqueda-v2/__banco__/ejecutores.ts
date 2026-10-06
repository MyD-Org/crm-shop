/**
 * Arma el ejecutor de cada tubería del banco (`clasica`, `tolerante`, `fase1`,
 * `v2` y `motor` con Jev grabado / vivo / sin Jev / plan de la caché). Lo comparten
 * `banco:busqueda` y `banco:linea-base`. SOLO scripts; no abre conexiones por
 * su cuenta (el que lo usa envuelve cada llamada en `enLectura`).
 */
import { consultarJev, JEV_MODELO } from "@/lib/busqueda-inteligente/jev";
import { pareceCodigo } from "@/lib/busqueda-inteligente/gate";
import { normalizarConsulta } from "@/lib/busqueda-inteligente/normalizar";
import type { NodoArbol } from "@/lib/busqueda-inteligente/tipos";
import { shopTenantId } from "@/lib/tenant";
import { leerPlan } from "../cache";
import { clavePlan } from "../servidor";
import type { BusquedaBanco, ResultadoBanco } from "./banco";
import { ejecutarClasica } from "./clasica";
import type { ModoJev, SuperficieBanco, Tuberia } from "./corrida";
import { ejecutarFase1 } from "./fase1";
import grabado from "./jev-grabado.json";
import { jevGrabado, type JevGrabado } from "./jev-grabado";
import { ejecutarMotor } from "./motor";
import { ejecutarV2, type ContextoV2 } from "./v2";
import type { VistaBanco } from "./vista";

export interface ConfigEjecutor {
  tuberia: Tuberia;
  /** Modo efectivo (ya resuelto: nunca "segun-entorno"). */
  jev: ModoJev;
  vista: VistaBanco;
  arbol: NodoArbol[];
  estructurados: boolean;
  /**
   * Valor de `catalogo-solo-visibles` con el que se busca el plan en la caché (`--jev=cache`). Por defecto
   * el de la vista; en la línea base es el de producción, que es el que sirvió el plan al cliente.
   */
  soloVisiblesDelPlan?: boolean;
  /** Sólo tubería `motor`: superficie (por defecto `catalogo`). */
  superficie?: SuperficieBanco;
  /** `--medidas=si`: las tuberías con plan (`v2` y `motor`) aplican `aplicarMedidas` sobre el plan. */
  medidas?: boolean;
}

export interface Ejecutor {
  ejecutar: (q: string) => Promise<ResultadoBanco>;
  jevMeta?: { modelo: string | null; grabadoEl: string | null };
  /** Jev grabado sin respuesta para el caso (sólo v2 con `--jev=grabado`). */
  sinGrabacion?: (c: BusquedaBanco) => boolean;
}

const grabaciones = grabado as JevGrabado;
const jevVivo = (consulta: string, preguntas: Parameters<typeof consultarJev>[1], timeoutMs: number) => consultarJev(consulta, preguntas, { timeoutMs });

/** `segun-entorno` (fase1 sin --jev): Jev vivo sólo si hay JEV_API_KEY, como siempre. */
export function resolverJev(jev: ModoJev | "segun-entorno", conClave: boolean): ModoJev {
  return jev === "segun-entorno" ? (conClave ? "vivo" : "no") : jev;
}

/** Cómo se adquiere el plan según el modo de Jev (lo comparten `v2` y `motor`), más las medidas si se piden. */
function contextoDePlan(cfg: ConfigEjecutor): ReturnType<typeof contextoBase> {
  const r = contextoBase(cfg);
  return cfg.medidas ? { ...r, ctx: { ...r.ctx, medidas: true } } : r;
}

function contextoBase(cfg: ConfigEjecutor): { ctx: ContextoV2; jevMeta?: Ejecutor["jevMeta"]; sinGrabacion?: Ejecutor["sinGrabacion"] } {
  const { vista, arbol, estructurados } = cfg;
  if (cfg.jev === "cache") {
    const soloVisibles = cfg.soloVisiblesDelPlan ?? vista.soloVisibles;
    const hash = clavePlan(arbol, soloVisibles);
    // Lectura sin sumar uso (la tx es read only): el plan que vio el cliente, sin Jev ni costo.
    const planDe = async (q: string) => {
      const norm = normalizarConsulta(q);
      return norm ? leerPlan(shopTenantId(), norm, hash, false) : null;
    };
    return { ctx: { arbol, jev: null, estructurados, vista, planDe } };
  }
  if (cfg.jev === "vivo") {
    return { ctx: { arbol, jev: jevVivo, estructurados, vista }, jevMeta: { modelo: JEV_MODELO, grabadoEl: null } };
  }
  if (cfg.jev === "no") return { ctx: { arbol, jev: null, estructurados, vista } };
  return {
    ctx: { arbol, jev: jevGrabado(grabaciones), estructurados, vista },
    jevMeta: { modelo: grabaciones.modelo, grabadoEl: grabaciones.grabadoEl },
    sinGrabacion: (c) => {
      const norm = normalizarConsulta(c.q);
      return !!norm && !pareceCodigo(c.q) && !(norm in grabaciones.respuestas);
    },
  };
}

export function crearEjecutor(cfg: ConfigEjecutor): Ejecutor {
  const { vista, arbol, estructurados } = cfg;
  switch (cfg.tuberia) {
    case "clasica":
      return { ejecutar: (q) => ejecutarClasica(q, { vista }, { tolerante: false }) };
    case "tolerante":
      return { ejecutar: (q) => ejecutarClasica(q, { vista }, { tolerante: true }) };
    case "fase1": {
      const vivo = cfg.jev === "vivo";
      return {
        ejecutar: (q) => ejecutarFase1(q, { arbol, jev: vivo ? jevVivo : null, estructurados, vista }),
        ...(vivo ? { jevMeta: { modelo: JEV_MODELO, grabadoEl: null } } : {}),
      };
    }
    case "v2": {
      const { ctx, jevMeta, sinGrabacion } = contextoDePlan(cfg);
      return { ejecutar: (q) => ejecutarV2(q, ctx), ...(jevMeta ? { jevMeta } : {}), ...(sinGrabacion ? { sinGrabacion } : {}) };
    }
    case "motor": {
      const { ctx, jevMeta, sinGrabacion } = contextoDePlan(cfg);
      const motor = { ...ctx, superficie: cfg.superficie ?? "catalogo" } as const;
      return { ejecutar: (q) => ejecutarMotor(q, motor), ...(jevMeta ? { jevMeta } : {}), ...(sinGrabacion ? { sinGrabacion } : {}) };
    }
  }
}
