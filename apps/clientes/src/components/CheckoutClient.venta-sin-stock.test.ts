import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas de texto (sin montar React: acá no hay jsdom) del checkout de un pedido a confirmar por
 * modalidad (venta sin stock). Los pasos y el medio salen de `lib/checkout-flujo.ts` (con tests);
 * acá se fija cómo los usa el checkout.
 */
const fuente = readFileSync(join(__dirname, "CheckoutClient.tsx"), "utf8");
const hook = readFileSync(join(__dirname, "..", "hooks", "useCotizacion.ts"), "utf8");

/** El cuerpo del `if` que empieza en `inicio` (hasta su primer `return;`). */
function rama(inicio: string): string {
  const i = fuente.indexOf(inicio);
  expect(i).toBeGreaterThan(0);
  return fuente.slice(i, fuente.indexOf("return;", i));
}

describe("CheckoutClient: pedido a confirmar por modalidad", () => {
  it("el flujo sale de la cotización del servidor y decide pasos y medio", () => {
    expect(fuente).toContain("const flujoCotizado = cotizacion?.flujo;");
    expect(fuente).toContain("const pasos = pasosCheckout({ flujo: flujoCheckout, esCuentaCorriente });");
    expect(fuente).toContain("steps={pasos.map(");
    expect(fuente).not.toContain("PASOS_CHECKOUT");
    // Confirmar vale en el último paso (Entrega si no hay Pago).
    expect(fuente).toContain("pasoActual === pasoFinal &&");
  });

  it("al cambiarle el medio a un pedido existente el flujo no aplica (su propia reserva no lo pasa a confirmar)", () => {
    expect(fuente).toContain('const flujoCheckout: FlujoPedido = pedidoACambiar ? "normal" : flujoVisto;');
  });

  it("Entrega termina en Confirmar pedido con el aviso de que no se cobra encima del botón", () => {
    const bloque = fuente.slice(fuente.indexOf("const bloqueConfirmarSinPago"));
    expect(bloque.indexOf("{TEXTO_CARRITO_A_CONFIRMAR}")).toBeGreaterThan(0);
    expect(bloque.indexOf("{TEXTO_CARRITO_A_CONFIRMAR}")).toBeLessThan(bloque.indexOf("{textoBotonConfirmar}"));
    expect(fuente).toContain("{sinPasoPago ? (\n              bloqueConfirmarSinPago\n");
  });

  describe("con el formulario de facturación (comprador sin vincular), no hay forma de confirmar sin guardarlo", () => {
    const seccion = fuente.slice(
      fuente.indexOf("{seccionFacturacion && (pasoActual === \"datos\" || pasoActual === \"entrega\") && ("),
      fuente.indexOf("{/* Con la sección de facturación, nombre y teléfono se piden ahí. */}"),
    );

    it("la sección no tiene otro botón que confirme: sólo el del formulario", () => {
      expect(seccion.length).toBeGreaterThan(0);
      expect(seccion).not.toContain("bloqueConfirmarSinPago");
      expect(seccion).not.toMatch(/onClick=\{confirmar|confirmarSinPago/);
      // El único bloque con botón de confirmar va en la sección SIN facturación.
      expect(fuente.split("bloqueConfirmarSinPago").length).toBe(3); // definición + un uso
      expect(fuente).toContain('{!seccionFacturacion && pasoActual === "entrega" && (');
      // El botón del resumen lateral no aparece en el último paso.
      expect(fuente).toContain("{pasoActual !== pasoFinal && (");
    });

    it('el botón del formulario es "Guardar y confirmar pedido", con el aviso sin cobro encima', () => {
      expect(seccion).toContain('{...(sinPasoPago ? { textoGuardar: "Guardar y confirmar pedido", ocupado: enviando } : {})}');
      expect(seccion).toContain("{sinPasoPago && avisoConfirmarSinPago}");
    });

    it("el pedido sale sólo desde onGuardado (después del guardado) y con el contacto recién guardado", () => {
      const guardado = seccion.slice(seccion.indexOf("onGuardado={(d) => {"));
      expect(guardado).toContain("trasGuardarFacturacion({ sinPasoPago, listoParaConfirmar: listoParaConfirmarTrasGuardar })");
      expect(guardado).toContain("contactoRecienGuardado.current = contactoGuardado;\n                    void confirmar();");
      expect(fuente).toContain("const contacto = contactoRecienGuardado.current ?? { nombre, telefono };");
      expect(fuente).toContain("contactoNombre: contacto.nombre,\n          contactoTelefono: contacto.telefono,");
      // Con paso Pago, como siempre: a Pago.
      expect(guardado).toContain('if (siguiente === "pago") irAPaso("pago");');
    });
  });

  it("409 pedido_a_confirmar: cambia el flujo, vuelve a Entrega y RECOTIZA; nunca usa el total del 409", () => {
    const r = rama('if (res.status === 409 && json?.motivo === "pedido_a_confirmar") {');
    expect(r).toContain('setFlujoVisto("a_confirmar");');
    expect(r).toContain("recotizar();");
    expect(r).toContain('irAPaso("entrega");');
    // La cotización del 409 está a la lista del medio rechazado: ni su total ni sus líneas.
    expect(r).not.toMatch(/json\.cotizacion|totalNuevo|setConfirmado/);
    // Va antes del 409 genérico.
    expect(fuente.indexOf('json?.motivo === "pedido_a_confirmar"')).toBeLessThan(fuente.indexOf("if (res.status === 409) {\n"));
    // El reintento manda el total de la cotización vigente del hook (/api/carrito/cotizar, lista a
    // confirmar), y sólo se puede confirmar con esa cotización ya cargada.
    const post = fuente.slice(fuente.indexOf('fetch("/api/pedidos", {'));
    expect(post.slice(0, 400)).toContain("totalVisto: cotizacion?.total,");
    expect(fuente).toContain('estado === "ok" &&\n    !!cotizacion &&');
  });

  it("409 pedido_ya_no_a_confirmar: vuelve el flujo normal, RECOTIZA y va a Pago; nunca usa la cotización del 409", () => {
    const r = rama('if (res.status === 409 && json?.motivo === "pedido_ya_no_a_confirmar") {');
    expect(r).toContain('setFlujoVisto("normal");');
    expect(r).toContain("setErrorEnvio(json.error");
    expect(r).toContain("recotizar();");
    expect(r).toContain('irAPaso("pago");');
    expect(r).not.toMatch(/json\.cotizacion|totalNuevo|setConfirmado/);
    // Va antes del 409 genérico (que sólo recotiza y se queda en el paso).
    expect(fuente.indexOf('json?.motivo === "pedido_ya_no_a_confirmar"')).toBeLessThan(fuente.indexOf("if (res.status === 409) {\n"));
    // El POST avisa que se armó a confirmar: sin eso el servidor responde el 400 de siempre.
    const post = fuente.slice(fuente.indexOf('fetch("/api/pedidos", {'));
    expect(post.slice(0, 2500)).toContain('...(flujoCheckout === "a_confirmar" ? { flujoVisto: "a_confirmar" } : {}),');
  });

  it("a confirmar el pedido sale con a_coordinar y sin pie de medio", () => {
    expect(fuente).toContain("pagoMetodo: pagoParaEnviar,");
    expect(fuente).toContain("const pieConfirmar = sinPasoPago ? TEXTO_CARRITO_A_CONFIRMAR :");
  });

  it('éxito: "Pedido recibido" con el texto sin cobro y el bloque de contacto', () => {
    // La misma regla que el mail y Mi cuenta (`pedidoAConfirmarPorModalidad`), sobre el medio enviado
    // y las líneas de la cotización del pedido.
    expect(fuente).toContain("aConfirmar: pedidoAConfirmarPorModalidad(pagoParaEnviar, json.cotizacion?.lineas ?? []),");
    expect(fuente).toContain(") : confirmado.aConfirmar ? (\n              <>{TEXTO_PEDIDO_A_CONFIRMAR}</>");
    // Antes que la rama de "sin medio" (a confirmar puede tener un medio elegido de antes).
    expect(fuente.indexOf("confirmado.aConfirmar ? (")).toBeLessThan(fuente.indexOf(") : !medioSel ? ("));
    expect(fuente).toContain("{!pagado && confirmado.contacto && (\n            <PedidoContacto");
  });

  it("la cotización manda el local de retiro elegido siempre (el mismo que el pedido), no sólo con transferencia", () => {
    expect(hook).toContain('const sucursalRetiro = opts.entregaTipo === "retiro" ? (opts.sucursalRetiro ?? "") : "";');
    expect(fuente).toContain("sucursalRetiro: localParaCuenta,");
    expect(fuente).toContain('const localParaCuenta = sucursales && entrega === "retiro" && localRetiro ? localRetiro : undefined;');
    expect(fuente).toContain('sucursalRetiro: sucursales && entrega === "retiro" && localRetiro ? localRetiro : undefined,');
  });
});
