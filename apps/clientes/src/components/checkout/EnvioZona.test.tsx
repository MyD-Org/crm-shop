import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { AvisoEnvioZona, FilaEnvioResumen } from "./EnvioZona";
import type { EnvioEvaluado } from "@/lib/envio";
import type { ResultadoMetodoTienda as ResultadoMetodo } from "@/lib/envio-zona-tienda";

const metodo = (extra: Partial<ResultadoMetodo> = {}): ResultadoMetodo => ({
  metodoId: "m1",
  slug: "envio-en-el-dia",
  nombre: "Envío en el día",
  zonaId: "z1",
  zona: "Centro",
  precio: 4500,
  costo: 4500,
  gratis: false,
  regla: "poligono",
  precision: "altura",
  promesa: "",
  avisoFeriados: "Los feriados no hay entregas.",
  alegra: { itemId: "9", ivaPct: 21 },
  horario: { dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 0 },
  ...extra,
});
const envio = (extra: Partial<EnvioEvaluado> = {}): EnvioEvaluado => ({
  disponible: true,
  gratis: false,
  aCoordinar: false,
  motivo: null,
  faltante: 0,
  costo: 4500,
  metodo: metodo(),
  ...extra,
});
const sinUbicar = (): EnvioEvaluado => ({ disponible: true, gratis: false, aCoordinar: true, motivo: "gratis_apagado", faltante: 0, sinUbicar: true });
const noop = vi.fn();

describe("FilaEnvioResumen", () => {
  it("muestra la zona, el importe, cuándo llega y el aviso de feriados", () => {
    const html = renderToStaticMarkup(<FilaEnvioResumen envio={envio()} pagaEnLinea />);
    expect(html).toContain("Envío · Centro");
    expect(html).toContain("Llega");
    expect(html).toContain("Los feriados no hay entregas.");
  });
  it("gratis: «Sin cargo»", () => {
    expect(renderToStaticMarkup(<FilaEnvioResumen envio={envio({ gratis: true, costo: 0 })} pagaEnLinea />)).toContain("Sin cargo");
  });
  it("sin pago en línea aclara que cuenta desde la confirmación del pago", () => {
    expect(renderToStaticMarkup(<FilaEnvioResumen envio={envio()} pagaEnLinea={false} />)).toContain("a partir de la confirmación de su pago");
  });
});

describe("AvisoEnvioZona: envío rápido", () => {
  it("cartel verde con el nombre del método y línea «Llega … horario por $»", () => {
    const html = renderToStaticMarkup(
      <AvisoEnvioZona
        envio={envio({ metodo: metodo({ nombre: "Envío rápido", horarioEntrega: "antes de las 21 hs", horario: { dias: [1, 2, 3, 4, 5, 6, 7], horaCorte: "23:59", margenMin: 0 } }) })}
        pagaEnLinea
        envioACoordinar={false}
        onCoordinar={noop}
        onUbicar={noop}
      />,
    );
    expect(html).toContain("bg-success-soft");
    expect(html).toContain("Envío rápido");
    expect(html).toContain("antes de las 21 hs por");
    expect(html).toContain("Comprando dentro de");
    expect(html).toContain("text-success");
    expect(html).not.toContain("Envío en el día");
  });
  it("sin horario no inventa ninguno", () => {
    const html = renderToStaticMarkup(<AvisoEnvioZona envio={envio()} pagaEnLinea envioACoordinar={false} onCoordinar={noop} onUbicar={noop} />);
    expect(html).not.toContain("antes de las");
    expect(html).toContain("Los feriados no hay entregas.");
  });
});

describe("AvisoEnvioZona", () => {
  it("sin ubicar: pide elegir una dirección y ofrece continuar a coordinar", () => {
    const html = renderToStaticMarkup(<AvisoEnvioZona envio={sinUbicar()} pagaEnLinea envioACoordinar={false} onCoordinar={noop} onUbicar={noop} />);
    expect(html).toContain("Seleccione su dirección de la lista para calcular el envío en el día.");
    expect(html).toContain("Continuar con envío a coordinar");
  });
  it("eligió coordinar: lo informa y permite volver", () => {
    const html = renderToStaticMarkup(<AvisoEnvioZona envio={sinUbicar()} pagaEnLinea envioACoordinar onCoordinar={noop} onUbicar={noop} />);
    expect(html).toContain("Elegió continuar con el envío a coordinar");
    expect(html).toContain("Elegir una dirección de la lista");
    expect(html).not.toContain("Continuar con envío a coordinar");
  });
  it("ubicación aproximada (sólo calle): avisa", () => {
    const html = renderToStaticMarkup(
      <AvisoEnvioZona envio={envio({ metodo: metodo({ precision: "calle" }) })} pagaEnLinea envioACoordinar={false} onCoordinar={noop} onUbicar={noop} />,
    );
    expect(html).toContain("de forma aproximada");
  });
  it("sin método ni sinUbicar no dibuja nada", () => {
    const e: EnvioEvaluado = { disponible: true, gratis: false, aCoordinar: true, motivo: "gratis_apagado", faltante: 0 };
    expect(renderToStaticMarkup(<AvisoEnvioZona envio={e} pagaEnLinea envioACoordinar={false} onCoordinar={noop} onUbicar={noop} />)).toBe("");
  });
});

describe("CheckoutClient con el flag apagado", () => {
  const fuente = readFileSync(new URL("../CheckoutClient.tsx", import.meta.url), "utf8");
  it("todo lo nuevo cuelga de envioPorZona (default false): ni destino, ni campos del pedido, ni avisos", () => {
    expect(fuente).toContain("envioPorZona = false");
    expect(fuente).toContain("const destinoZona = envioPorZona && aDomicilio");
    expect(fuente).toContain("...(envioPorZona && aDomicilio");
    expect(fuente).toContain("{envioPorZona && cotizacion && (");
    expect(fuente).toContain("const sinUbicarPendiente = envioPorZona &&");
    expect(fuente).toContain("entrega === \"envio\" && envioPorZona && cotizacion?.envio.costo !== undefined");
  });
});
