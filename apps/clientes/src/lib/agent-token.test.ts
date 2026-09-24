import { createHmac, timingSafeEqual } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_TOKEN_TTL_MS, SecretoAgenteFaltanteError, mintAgentToken } from "./agent-token";

const SECRETO = "secreto-de-prueba-de-al-menos-32-caracteres";
const AHORA = 1_790_000_000_000 - AGENT_TOKEN_TTL_MS;

/**
 * Vector generado corriendo `mintAgentToken("CLI-1", "central-led")` de
 * apps/admin/src/lib/agent-token.ts con este mismo SESSION_SECRET y
 * `Date.now()` fijo en 1790000000000 (⇒ vence 1790003600000). Si este test
 * falla, el Shop dejó de firmar como el CRM y las tools de cuenta del chat van
 * a responder 401.
 */
const VECTOR_CRM =
  "eyJjIjoiQ0xJLTEiLCJ0IjoiY2VudHJhbC1sZWQiLCJlIjoxNzkwMDAzNjAwMDAwfQ.7AJgovmqUkNIbqptZ95n_itB_ab88ig8bARQRcxhhsk";

/** Copia de `verifyAgentToken` del CRM (sin el chequeo de vencimiento). */
function verificarComoElCrm(token: string, secreto: string) {
  const [payload, firma] = token.split(".");
  if (!payload || !firma) return null;
  const esperada = createHmac("sha256", secreto).update(payload).digest("base64url");
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (typeof data.c !== "string" || typeof data.t !== "string" || typeof data.e !== "number") return null;
  return { codigocliente: data.c, tenantId: data.t, vence: data.e };
}

describe("mintAgentToken", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", SECRETO);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("firma exactamente igual que el CRM (vector fijo)", () => {
    expect(mintAgentToken("CLI-1", "central-led", 1_790_000_000_000)).toBe(VECTOR_CRM);
  });

  it("payload {c, t, e} con TTL de 1 h, verificable con la lógica del CRM", () => {
    const token = mintAgentToken("C-9", "tenant-a", AHORA);
    expect(verificarComoElCrm(token, SECRETO)).toEqual({
      codigocliente: "C-9",
      tenantId: "tenant-a",
      vence: AHORA + AGENT_TOKEN_TTL_MS,
    });
  });

  it("con otro secreto no valida", () => {
    const token = mintAgentToken("C-9", "tenant-a", AHORA);
    expect(verificarComoElCrm(token, "otro-secreto-de-al-menos-32-caracteres!!")).toBeNull();
  });

  it("sin SESSION_SECRET (o corto) no firma", () => {
    vi.stubEnv("SESSION_SECRET", "corto");
    expect(() => mintAgentToken("C-9", "tenant-a")).toThrow(SecretoAgenteFaltanteError);
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => mintAgentToken("C-9", "tenant-a")).toThrow(SecretoAgenteFaltanteError);
  });
});
