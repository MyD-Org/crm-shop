import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones, limpiar } from "@/test/registro-usted";
import { MENSAJES_INVITADO } from "./invitado-mensajes";

/**
 * Higiene de la compra del invitado (change `compra-como-invitado`, S2a):
 *  - S2a.23 los textos de error que ve el comprador van en usted (nada de tú / vos / «ojo» / «probá»);
 *  - S2a.24 los logs de los archivos nuevos no llevan datos personales ni tokens (X2): sólo ids de
 *    pedido y motivos;
 *  - S1-4 / D13 el servidor del invitado no escribe nada en el navegador (ni cookie ni storage).
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const leer = (ruta: string) => readFileSync(join(SRC, ruta), "utf8");

/** Archivos NUEVOS de esta rebanada: su texto y sus logs se revisan enteros. */
const ARCHIVOS_NUEVOS = [
  "lib/turnstile.ts",
  "lib/invitado-guarda.ts",
  "lib/invitado-mensajes.ts",
  "lib/invitado-respuesta.ts",
  "lib/facturacion-invitado.ts",
  "lib/email-normalizado.ts",
  "lib/tracking/servidor.ts",
];

/** Archivos existentes que esta rebanada toca: sus textos también van en usted. */
const ARCHIVOS_TOCADOS = [
  "app/api/pedidos/route.ts",
  "app/api/pedidos/[id]/pago/route.ts",
  "app/api/pedidos/[id]/medio/route.ts",
  "app/api/pedidos/[id]/cuotas/route.ts",
  "app/api/pedidos/[id]/avisos/route.ts",
  "app/api/pedidos/[id]/cancelar/route.ts",
  "app/api/pedidos/pendiente/route.ts",
  "app/api/pagos/mercadopago/preferencia/route.ts",
  "app/api/pagos/payway-config/route.ts",
  "app/api/pagos/cuenta-rechazada/route.ts",
  "lib/pagos/cobrar.ts",
];

describe("textos de error del invitado, en usted", () => {
  it.each(Object.entries(MENSAJES_INVITADO))("%s", (_clave, mensaje) => {
    expect(mensaje).not.toMatch(REGISTRO);
    expect(mensaje).not.toMatch(/\b(?:tuyo|tuya|ti)\b/i);
  });

  it.each([...ARCHIVOS_NUEVOS, ...ARCHIVOS_TOCADOS])("%s: sin tuteo ni voseo fuera de los comentarios", (ruta) => {
    // Una línea anterior a este cambio (GET /api/pedidos) sigue con "tus": el copy existente de la app no
    // se reescribe por esta regla (CLAUDE.md raíz); todo lo nuevo o modificado va en usted.
    const nuevas = infracciones(leer(ruta), REGISTRO).filter((l) => !l.includes("No se pudieron cargar tus pedidos"));
    expect(nuevas).toEqual([]);
  });
});

/** Identificadores que NO pueden aparecer en el argumento de un log. */
const PROHIBIDO_EN_LOGS = /\b(?:email|emailInvitado|correo|telefono|contactoTelefono|nroDoc|documento|dni|cuit|token|tokenRetorno|ip|ipInvitado|body|cuerpo|datos)\b/i;

/** Los argumentos de cada `console.*(...)` (hasta el `);` de cierre), sin comentarios. */
function logsDe(texto: string): string[] {
  const limpio = limpiar(texto);
  const salida: string[] = [];
  for (const m of limpio.matchAll(/console\.(?:error|warn|log|info)\(([\s\S]*?)\);/g)) salida.push(m[1]);
  return salida;
}

describe("logs sin datos personales ni tokens", () => {
  it.each(ARCHIVOS_NUEVOS)("%s", (ruta) => {
    for (const argumentos of logsDe(leer(ruta))) {
      // Se permiten los TEXTOS que nombran una variable de entorno (p. ej. TURNSTILE_SECRET_KEY): no es un valor.
      const sinTexto = argumentos.replace(/"[^"]*"|'[^']*'/g, (s) => (/\$\{/.test(s) ? s : '""'));
      expect(sinTexto, argumentos).not.toMatch(PROHIBIDO_EN_LOGS);
    }
  });

  it("la rama de invitado de POST /api/pedidos y los endpoints con token no agregan logs con datos del comprador", () => {
    const route = limpiar(leer("app/api/pedidos/route.ts"));
    for (const argumentos of logsDe(route)) {
      expect(argumentos, argumentos).not.toMatch(/emailInvitado|facturaInvitado|invitadoToken|ipInvitado/);
    }
  });
});

describe("el servidor del invitado no guarda nada en el navegador", () => {
  it.each([...ARCHIVOS_NUEVOS, "lib/pedido-token.ts", "lib/invitado-acceso.ts", "app/api/pedidos/route.ts"])(
    "%s: sin cookies ni storage",
    (ruta) => {
      const texto = limpiar(leer(ruta));
      expect(texto).not.toMatch(/\bcookies\(\)|document\.cookie|Set-Cookie|\.cookies\.set|localStorage|sessionStorage|indexedDB/i);
    },
  );
});
