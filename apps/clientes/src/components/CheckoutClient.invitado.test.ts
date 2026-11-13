import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas de fuente (sin jsdom) de la compra como invitado en el checkout (change
 * `compra-como-invitado`, S2b): el token vive en memoria y viaja por header, no hay llamadas que el
 * servidor le niega, y con el flag apagado (`invitado = null`) el checkout es el de siempre.
 */
const SRC = join(__dirname, "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const checkout = leer("components/CheckoutClient.tsx");

/** Cuerpo de una función/bloque entre dos anclas del archivo. */
function entre(texto: string, desde: string, hasta: string): string {
  const i = texto.indexOf(desde);
  expect(i, `ancla «${desde}»`).toBeGreaterThan(-1);
  const j = texto.indexOf(hasta, i);
  expect(j, `ancla «${hasta}»`).toBeGreaterThan(i);
  return texto.slice(i, j);
}

describe("flag apagado: el checkout es el de siempre", () => {
  it("`invitado` por defecto es null y todo el modo cuelga de `invitadoActivo`", () => {
    expect(checkout).toContain("invitado = null,");
    expect(checkout).toContain("const invitadoActivo = invitado?.activo === true;");
  });

  it("la sección de facturación con cuenta no cambia (sólo se excluye al invitado)", () => {
    expect(checkout).toContain("const seccionFacturacion = !facturacion.vinculado && !invitadoActivo;");
  });

  it("el formulario del invitado y los campos extra del pedido sólo con invitadoActivo", () => {
    expect(checkout).toMatch(/\{invitadoActivo && pasoActual === "datos" && \(/);
    expect(checkout).toContain("...(invitadoActivo\n            ? camposDeInvitadoParaPedido(");
  });

  it("la página sólo evalúa el flag sin sesión y con flag apagado redirige a /ingresar", () => {
    const pagina = leer("app/checkout/page.tsx");
    // Con un token de compra válido (lo acuña /pagar) se retoma el pago aunque el flag esté apagado (S3, Q6).
    expect(pagina).toContain("if (!retornoInvitado.tokenRetorno && !(await compraInvitadoHabilitada())) redirect(rutaIngreso(\"/checkout\"));");
    expect(pagina).toMatch(/if \(!clerkUserId && !cliente\) \{\n(?:.*\n)*?\s+if \(!retornoInvitado\.tokenRetorno && !\(await compraInvitadoHabilitada\(\)\)\)/);
  });
});

describe("token del invitado", () => {
  it("todos los fetch del pedido pasan por fetchConToken (header X-Pedido-Token)", () => {
    for (const rel of [
      "components/CheckoutClient.tsx",
      "components/PagoPayway.tsx",
      "components/PagoCuentaMercadoPago.tsx",
      "components/PagoMercadoPago.tsx",
    ]) {
      const t = leer(rel);
      // Ningún fetch crudo a las rutas del pedido o del cobro (salvo /cancelar, que el invitado no usa).
      const crudos = [...t.matchAll(/[^\w.]fetch\(\s*[`"'](\/api\/(?:pedidos|pagos)[^`"']*)/g)].map((m) => m[1]);
      expect(crudos.filter((u) => !u.includes("/cancelar")), rel).toEqual([]);
    }
    expect(leer("lib/checkout-cuotas-cliente.ts")).toContain("fetcher: Fetcher = fetchConToken");
    expect(leer("lib/pagos/payway-cobro-cliente.ts")).toContain("doFetch: typeof fetch = fetchConToken");
    expect(leer("lib/pagos/sondeo-pago.ts")).toContain("doFetch: typeof fetch = fetchConToken");
  });

  it("al crear el pedido guarda el token en memoria y sin token no avanza", () => {
    expect(checkout).toContain("fijarTokenInvitado(json.invitadoToken);");
    expect(checkout).toContain('if (typeof json?.invitadoToken !== "string") {');
  });

  it("en el retorno lo toma del servidor, lo guarda en memoria y saca t de la URL", () => {
    const efecto = entre(checkout, "if (invitadoActivo) {\n      // El invitado no tiene", "const url = pedidoReintento");
    expect(efecto).toContain("fijarTokenInvitado(invitado.tokenRetorno);");
    expect(efecto).toContain("quitarTokenDeLaUrl();");
    // Sin pedido o sin token no consulta nada.
    expect(efecto).toContain("if (!pedidoReintento || !invitado?.tokenRetorno) return;");
  });

  it("los avisos al salir usan fetch con keepalive y header (sendBeacon no lleva headers)", () => {
    const hook = leer("components/checkout/useAvisarAlSalir.ts");
    expect(hook).toContain("!tokenInvitado() && typeof navigator.sendBeacon");
    expect(hook).toContain("fetchConToken(url, { method: \"POST\", keepalive: true })");
  });

  it("el retorno sin token válido no muestra nada del pedido", () => {
    const pantalla = entre(checkout, "if (invitado?.sinToken && pedidoReintento) {", "// ------------------------------------------ buscando");
    expect(pantalla).toContain("TEXTOS_INVITADO.sinToken");
    expect(pantalla).not.toContain("confirmado");
    expect(pantalla).not.toContain("items.");
    expect(pantalla).not.toContain("pedidoReintento}");
  });
});

describe("lo que el servidor le niega al invitado", () => {
  it("no cancela: no rescata-para-cancelar y el botón «Volver al carrito» (cancela) no se ofrece", () => {
    expect(checkout).toContain("!invitadoActivo &&\n    rescate !== null &&");
    expect(checkout).toContain("pagoEnConfirmacion || cobroEnCurso || invitadoActivo ? (");
  });

  it("no consulta /api/pedidos/pendiente sin ?pedido (sale antes del fetch)", () => {
    const efecto = entre(checkout, "if (invitadoActivo) {\n      // El invitado no tiene", "fetchConToken(url)");
    expect(efecto).toContain("return;");
    expect(checkout).toContain("const buscaPendienteAlMontar = !invitadoActivo || Boolean(invitado?.tokenRetorno);");
  });

  it("no usa las sugerencias de direcciones (/api/geocode) ni escribe la ubicación (cookie)", () => {
    expect(checkout).toContain("suspendido={invitadoActivo}");
    expect(checkout).toContain("const claveSync = cuerpoSync && !invitadoActivo ? JSON.stringify(cuerpoSync) : null;");
  });

  it("transferencia: datos bancarios + comprobante por WhatsApp o correo, sin subir el comprobante ni «Ver mis pedidos»", () => {
    expect(checkout).toContain("{invitadoActivo ? (\n                  <p className=\"text-sm text-muted\">{TEXTOS_INVITADO.transferenciaComprobante}</p>");
    expect(checkout.match(/\{!invitadoActivo && \(\n\s+<(?:Button variant="outline" href="\/mi-cuenta"|Link href="\/mi-cuenta")/g)).toHaveLength(2);
  });
});

describe("medición y verificación", () => {
  it("pedido_confirmado del cliente no se emite para el invitado (se mide en el servidor al cobrar)", () => {
    expect(checkout).toMatch(/if \(!invitadoActivo\) \{\n\s+track\(\{\n\s+tipo: "pedido_confirmado"/);
  });

  it("iniciar_checkout no depende de la sesión: el anónimo con flag lo emite igual que el logueado", () => {
    const efecto = entre(checkout, "const checkoutMedido = useRef(false);", "// Card del paso Pago");
    expect(efecto).toContain('track({ tipo: "iniciar_checkout"');
    expect(efecto).not.toContain("invitado");
  });

  it("sin Turnstile no se confirma (falla cerrada) y el desafío se reinicia tras cada intento", () => {
    expect(checkout).toContain("invitadoActivo && pedidoACambiar === null && (!invitadoListo || turnstileToken === null)");
    expect(checkout).toContain("if (invitadoActivo) setReinicioTurnstile((n) => n + 1);");
  });

  it("el señuelo (honeypot) y el instante de inicio viajan en el pedido", () => {
    expect(checkout).toContain("iniciado: iniciadoEn.current,");
    expect(checkout).toContain("trampa,");
    expect(leer("components/FormularioInvitado.tsx")).toContain("name={CAMPO_TRAMPA}");
  });
});

describe("carrito", () => {
  const boton = leer("components/carrito/BotonIniciarCompra.tsx");
  const carrito = leer("components/CarritoClient.tsx");

  it("con el flag, deja de emitir checkout_requiere_ingreso", () => {
    expect(boton).toContain("if (anonimo && !compraInvitado) track(eventoMuroIngreso(items, total));");
  });

  it("flag apagado: el cartel de siempre; encendido: compra sin cuenta + «Ya tengo cuenta, ingresar»", () => {
    expect(carrito).toContain("Inicie sesión para completar su compra.");
    expect(carrito).toContain("{TEXTOS_INVITADO.avisoCarrito}");
    expect(carrito).toContain("{TEXTOS_INVITADO.ingresar}");
    expect(carrito).toContain("compraInvitado = false,");
    const pagina = leer("app/carrito/page.tsx");
    expect(pagina).toContain("!(clerkUserId || cliente) && (await compraInvitadoHabilitada())");
  });
});
