/**
 * Matriz de aislamiento del invitado, por endpoint (change `compra-como-invitado`, S2a).
 *
 * Cada endpoint que acepta al invitado (token de compra en `X-Pedido-Token`) corre ESTOS mismos
 * casos contra la ruta real, con el verificador de tokens real (`principalDelPedido`) y un
 * "repositorio" falso que implementa la misma regla de pertenencia que `esDeSuDueno` (la regla en la
 * base se prueba aparte, contra Postgres real: `pedidos.invitado-aislamiento.integration.test.ts`).
 * Lo que se prueba acá es que la ruta (1) no consulta nada sin una credencial válida de ESE pedido,
 * (2) le pasa al repositorio el dueño correcto (la sesión gana al token) y (3) no distingue un pedido
 * ajeno de uno inexistente.
 *
 * El archivo de cada endpoint declara los `vi.mock` de sus dependencias (son por archivo) y llama a
 * `describirMatrizAislamiento`. No es un test por sí mismo.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { setFlag } from "@/test/flags";
import { firmarToken, type PropositoToken } from "@/lib/pedido-token";
import type { DuenoPedidos } from "@/lib/pedidos";

export const PA = "11111111-1111-4111-8111-111111111111"; // invitado
export const PB = "22222222-2222-4222-8222-222222222222"; // otro invitado
export const PC = "33333333-3333-4333-8333-333333333333"; // de la cuenta user_ana
export const PX = "99999999-9999-4999-8999-999999999999"; // no existe
export const SECRETO_PRUEBA = "secreto-de-prueba-pedido-link-0123456789";

export const ANONIMO = { clerkUserId: null, cliente: null, esAdmin: false, nombrePila: null };
export const SESION_ANA = {
  clerkUserId: "user_ana",
  cliente: null,
  email: "ana@cliente.example",
  esAdmin: false,
  nombrePila: null,
};

/** El mundo de la matriz: dos invitados, un pedido con cuenta. Mismo criterio que `esDeSuDueno`. */
const MUNDO: Record<string, { invitado: boolean; clerk?: string; cliente?: string }> = {
  [PA]: { invitado: true },
  [PB]: { invitado: true },
  [PC]: { invitado: false, clerk: "user_ana" },
};

export function abre(id: string, dueno: DuenoPedidos): boolean {
  const p = MUNDO[id];
  if (!p) return false;
  if (dueno.clerkUserId && p.clerk === dueno.clerkUserId) return true;
  if (dueno.clienteCodigo && p.cliente === dueno.clienteCodigo) return true;
  return Boolean(dueno.invitadoOrderId === id && p.invitado && !p.clerk && !p.cliente);
}

export function tokenDe(
  orderId: string,
  o: { proposito?: PropositoToken; venceEn?: number; tenant?: string } = {},
): string {
  return firmarToken({
    proposito: o.proposito ?? "compra",
    orderId,
    venceEn: o.venceEn ?? Date.now() + 60 * 60_000,
    ...(o.tenant ? { tenant: o.tenant } : {}),
  });
}

export interface LlamadaMatriz {
  token: string | null;
  /** El pedido que la ruta recibe en el path / query / cuerpo. */
  pedidoId: string;
  /** El token va en el cuerpo en lugar del header (nunca debe valer). */
  tokenEnCuerpo?: boolean;
}

export interface ConfigMatriz {
  /** Qué endpoint es (para el nombre del bloque). */
  nombre: string;
  identidad: Mock;
  permitir: Mock;
  /** Los dueños con los que la ruta consultó al repositorio falso (el test del endpoint los registra). */
  repoLlamadas: DuenoPedidos[];
  llamar: (a: LlamadaMatriz) => Promise<Response>;
  /** La respuesta del camino feliz del propio pedido (la ruta llegó al repositorio y encontró el pedido). */
  esFeliz: (r: Response) => Promise<void> | void;
  /** Ruta con cuerpo: se prueba además que un token en el cuerpo no vale. */
  conCuerpo?: boolean;
}

const cuerpoDe = async (r: Response) => {
  const t = await r.text();
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return t;
  }
};

export function describirMatrizAislamiento(cfg: ConfigMatriz) {
  describe(`aislamiento del invitado: ${cfg.nombre}`, () => {
    beforeEach(() => {
      vi.stubEnv("PEDIDO_LINK_SECRET", SECRETO_PRUEBA);
      vi.stubEnv("SHOP_TENANT_ID", "tenant-a.example");
      cfg.repoLlamadas.length = 0;
      cfg.identidad.mockReset();
      cfg.identidad.mockResolvedValue(ANONIMO);
      cfg.permitir.mockReset();
      cfg.permitir.mockResolvedValue(true);
      setFlag("compra-invitado", true);
    });
    afterEach(() => vi.unstubAllEnvs());

    it("sin token => 401 como hoy, sin consultar nada", async () => {
      const r = await cfg.llamar({ token: null, pedidoId: PA });
      expect(r.status).toBe(401);
      expect(await cuerpoDe(r)).toEqual({ error: "No autorizado" });
      expect(cfg.repoLlamadas).toEqual([]);
    });

    it("token de PA sobre PB (PB en el path/cuerpo/query) => 401 idéntico, PB no se toca", async () => {
      const r = await cfg.llamar({ token: tokenDe(PA), pedidoId: PB });
      expect(r.status).toBe(401);
      expect(await cuerpoDe(r)).toEqual({ error: "No autorizado" });
      expect(cfg.repoLlamadas).toEqual([]);
    });

    it("token válido del propio pedido (PA) => camino feliz con la tercera llave de PA y ninguna más", async () => {
      const r = await cfg.llamar({ token: tokenDe(PA), pedidoId: PA });
      await cfg.esFeliz(r);
      expect(cfg.repoLlamadas.length).toBeGreaterThan(0);
      for (const d of cfg.repoLlamadas) expect(d).toEqual({ clerkUserId: null, invitadoOrderId: PA });
    });

    it("token de un pedido de usuario con cuenta (PC) => 404 genérico, igual al de un pedido que no existe", async () => {
      const deCuenta = await cfg.llamar({ token: tokenDe(PC), pedidoId: PC });
      const inexistente = await cfg.llamar({ token: tokenDe(PX), pedidoId: PX });
      expect(deCuenta.status).toBe(404);
      expect(inexistente.status).toBe(404);
      // Mismo cuerpo: no hay señal para enumerar pedidos.
      expect(await cuerpoDe(deCuenta)).toEqual(await cuerpoDe(inexistente));
    });

    it("token de PA con el pedido de otro invitado inexistente en el path => igual que sin token (no hay oráculo)", async () => {
      const ajeno = await cfg.llamar({ token: tokenDe(PA), pedidoId: PX });
      const sin = await cfg.llamar({ token: null, pedidoId: PX });
      expect(ajeno.status).toBe(sin.status);
      expect(await cuerpoDe(ajeno)).toEqual(await cuerpoDe(sin));
    });

    it("token vencido => 401 con motivo y texto en usted que apunta al enlace del mail", async () => {
      const r = await cfg.llamar({ token: tokenDe(PA, { venceEn: Date.now() - 1_000 }), pedidoId: PA });
      expect(r.status).toBe(401);
      const cuerpo = (await cuerpoDe(r)) as { error: string; motivo: string };
      expect(cuerpo.motivo).toBe("token_vencido");
      expect(cuerpo.error).toContain("«Pagar su pedido»");
      expect(cuerpo.error).not.toMatch(/\b(tu|tus|vos|probá|ojo)\b/i);
      expect(cfg.repoLlamadas).toEqual([]);
    });

    it("firma alterada (orderId o exp) => 401 igual que sin token", async () => {
      const [v, , exp, firma] = tokenDe(PA).split(".");
      const otroExp = (parseInt(exp, 36) + 3_600_000).toString(36);
      for (const alterado of [`${v}.${PB}.${exp}.${firma}`, `${v}.${PA}.${otroExp}.${firma}`, tokenDe(PA).slice(0, -3), "basura"]) {
        const r = await cfg.llamar({ token: alterado, pedidoId: PA });
        expect(r.status).toBe(401);
        expect(await cuerpoDe(r)).toEqual({ error: "No autorizado" });
      }
      expect(cfg.repoLlamadas).toEqual([]);
    });

    it("el link `pago` del mail NO sirve como token de la API (propósito cruzado)", async () => {
      const r = await cfg.llamar({ token: tokenDe(PA, { proposito: "pago" }), pedidoId: PA });
      expect(r.status).toBe(401);
      expect(await cuerpoDe(r)).toEqual({ error: "No autorizado" });
      expect(cfg.repoLlamadas).toEqual([]);
    });

    it("token de otro tenant => 401", async () => {
      const r = await cfg.llamar({ token: tokenDe(PA, { tenant: "tenant-b.example" }), pedidoId: PA });
      expect(r.status).toBe(401);
      expect(cfg.repoLlamadas).toEqual([]);
    });

    it("flag apagado => el token válido de un pedido existente sigue sirviendo (el flag gobierna crear, no pagar); sin token, 401", async () => {
      setFlag("compra-invitado", false);
      const r = await cfg.llamar({ token: tokenDe(PA), pedidoId: PA });
      expect(r.status).not.toBe(401);
      const sin = await cfg.llamar({ token: null, pedidoId: PA });
      expect(sin.status).toBe(401);
    });

    it("límite excedido (por IP o por pedido) => 429 en usted, sin consultar", async () => {
      cfg.permitir.mockResolvedValue(false);
      const r = await cfg.llamar({ token: tokenDe(PA), pedidoId: PA });
      expect(r.status).toBe(429);
      expect(cfg.repoLlamadas).toEqual([]);
    });

    it("sesión Clerk prevalece: el token del invitado se ignora y se consulta con la cuenta", async () => {
      cfg.identidad.mockResolvedValue(SESION_ANA);
      const r = await cfg.llamar({ token: tokenDe(PA), pedidoId: PC });
      await cfg.esFeliz(r);
      for (const d of cfg.repoLlamadas) {
        expect(d.clerkUserId).toBe("user_ana");
        expect(d.invitadoOrderId).toBeUndefined();
      }
    });

    it("con sesión y SIN token todo sigue como hoy", async () => {
      cfg.identidad.mockResolvedValue(SESION_ANA);
      const r = await cfg.llamar({ token: null, pedidoId: PC });
      await cfg.esFeliz(r);
    });

    it("con sesión, un pedido ajeno es el mismo 404 de siempre (el token de invitado no abre nada)", async () => {
      cfg.identidad.mockResolvedValue(SESION_ANA);
      const r = await cfg.llamar({ token: tokenDe(PA), pedidoId: PA });
      expect(r.status).toBe(404);
    });

    if (cfg.conCuerpo) {
      it("un token en el cuerpo NO vale (sólo el header)", async () => {
        const r = await cfg.llamar({ token: tokenDe(PA), pedidoId: PA, tokenEnCuerpo: true });
        expect(r.status).toBe(401);
        expect(cfg.repoLlamadas).toEqual([]);
      });
    }
  });
}

/** Request con IP, origen y (si hay) el token en el header. */
export function pedido(
  url: string,
  { metodo = "POST", token, cuerpo, tokenEnCuerpo = false }: { metodo?: string; token: string | null; cuerpo?: Record<string, unknown>; tokenEnCuerpo?: boolean },
): Request {
  const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.7", "content-type": "application/json" };
  if (token && !tokenEnCuerpo) headers["x-pedido-token"] = token;
  const conToken = token && tokenEnCuerpo ? { ...cuerpo, token } : cuerpo;
  return new Request(`https://shop.example${url}`, {
    method: metodo,
    headers,
    ...(metodo === "GET" || metodo === "HEAD" ? {} : { body: JSON.stringify(conToken ?? {}) }),
  });
}
