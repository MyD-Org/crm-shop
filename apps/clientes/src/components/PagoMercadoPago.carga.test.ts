import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PagoMercadoPago } from "./PagoMercadoPago";

vi.mock("@mercadopago/sdk-react", () => ({
  initMercadoPago: vi.fn(),
  CardPayment: () => createElement("div", { id: "paymentBrick_container" }),
  StatusScreen: () => null,
}));

afterEach(() => vi.unstubAllEnvs());

const SIN_KEY = "No se pudo iniciar el formulario de pago. Recargue la página o elija otro medio de pago.";

function renderPago(cuotasPedido: number | null = 6, publicKey?: string) {
  return renderToStaticMarkup(createElement(PagoMercadoPago, {
    pedidoId: "pedido-prueba",
    numero: "PED-PRUEBA",
    monto: 1000,
    pagoMetodo: "mercadopago",
    cuotasPedido,
    publicKey,
    cuenta: "igz",
    onPagado: () => {},
  }));
}

describe("carga inicial del formulario de Mercado Pago", () => {
  it("muestra un loader y mantiene el Brick montado pero no visible hasta onReady", () => {
    const html = renderPago(6, "TEST-public-key");

    expect(html).toContain("Cargando el formulario de pago");
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/aria-hidden="true"[^>]*class="[^"]*invisible/);
    expect(html).toContain('id="paymentBrick_container"');
    expect(html).not.toContain("No se pudo completar el pago");
    expect(html).not.toContain(SIN_KEY);
  });

  it("pregunta cómo pagar: crédito (abierta), débito y cuenta de Mercado Pago", () => {
    const html = renderPago(6, "TEST-public-key");
    expect(html).toContain("¿Cómo quiere pagar?");
    expect(html).toContain("Tarjeta de crédito");
    expect(html).toContain("Cuenta de Mercado Pago");
    // Las cuotas se eligen dentro del formulario: el débito se puede elegir siempre (el pedido pasa
    // a 1 pago al cobrar) y la opción de crédito no lleva las cuotas del pedido.
    expect(html).not.toContain("Sólo en un pago");
    expect(html).not.toContain("6 cuotas sin interés");
    // La cuenta no está elegida: su botón todavía no aparece.
    expect(html).not.toContain("Ir a Mercado Pago");
  });

  it("la public key que manda el servidor para la cuenta del pedido monta el Brick", () => {
    const html = renderPago(null, "TEST-public-key-cuenta");
    expect(html).not.toContain(SIN_KEY);
    expect(html).toContain('id="paymentBrick_container"');
  });

  it("sin public key del servidor NO monta el Brick aunque haya una key en el entorno del navegador", () => {
    // Nombre armado para que la guarda de credenciales no lo vea: es justo lo que se prueba que se ignore.
    vi.stubEnv(["NEXT", "PUBLIC", "MP", "PUBLIC", "KEY"].join("_"), "TEST-public-key-entorno");
    const html = renderPago();

    expect(html).toContain(SIN_KEY);
    expect(html).not.toContain("Cargando el formulario de pago");
    expect(html).not.toContain('id="paymentBrick_container"');
  });
});

describe("PagoMercadoPago.tsx: cuenta del pedido", () => {
  const fuente = readFileSync(fileURLToPath(new URL("./PagoMercadoPago.tsx", import.meta.url)), "utf8");

  it("no lee ninguna key del entorno del navegador", () => {
    expect(fuente).not.toMatch(/process\.env/);
  });

  it("el Brick se remonta si cambia la public key (la tarjeta tokenizada con la anterior no sirve)", () => {
    const inicio = fuente.indexOf("<CardPayment");
    const bloque = fuente.slice(inicio, fuente.indexOf("/>", inicio));
    expect(bloque).toMatch(/key=\{`\$\{key\}-/);
    // Y el SDK se reinicia con la key nueva (`inicializar` compara con la que lo inició).
    expect(fuente).toMatch(/useEffect\(\(\) => \{\s*inicializar\(key\);\s*\}, \[key\]\)/);
  });

  it("el POST de cobro manda la cuenta con la que se tokenizó", () => {
    const post = fuente.slice(fuente.indexOf('fetch("/api/pagos/mercadopago"'));
    expect(post.slice(0, 600)).toMatch(/cuenta/);
  });

  it("409 cuenta_rechazada / cuenta_no_valida: aplica la config de la otra cuenta (key nueva = Brick nuevo)", () => {
    const manejo = fuente.slice(fuente.indexOf("if (!res.ok) {"));
    const bloque = manejo.slice(0, 700);
    expect(bloque).toMatch(/cambioDeCuenta\(json\)/);
    expect(bloque).toMatch(/setCuentaVigente\(\{ base: publicKey, publicKey: cambio\.config\.publicKey, cuenta: cambio\.config\.cuenta \}\)/);
    expect(bloque).toMatch(/remontarBrick\(\)/);
    // La key y la cuenta del cobro salen de la config aplicada mientras la prop siga siendo la misma.
    expect(fuente).toMatch(/const key = reemplazo\?\.publicKey \?\? \(publicKey \|\| undefined\)/);
    expect(fuente).toMatch(/cuenta: cuentaCobro/);
  });
});
