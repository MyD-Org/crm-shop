import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilaEnvioZona } from "./FilaEnvioZona";
import { configEnvioPublica, CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import type { EstimadoFicha } from "@/lib/envio-zona-textos";

const estimado = (tipo: "exacto" | "desde"): EstimadoFicha => ({
  tipo,
  precio: 4500,
  texto: "Llega mañana",
  llegada: { texto: "Llega mañana", mismoDia: false, condicion: null },
  avisoFeriados: "Los feriados no hay entregas.",
  metodo: "Envío en el día",
});

describe("FilaEnvioZona", () => {
  it("sin costo ni estimado no dibuja nada (carrito como siempre)", () => {
    expect(renderToStaticMarkup(<FilaEnvioZona costo={undefined} gratis={false} estimado={undefined} />)).toBe("");
  });

  it("con costo resuelto muestra el importe; gratis, «Sin cargo»", () => {
    expect(renderToStaticMarkup(<FilaEnvioZona costo={3000} gratis={false} estimado={undefined} />)).toContain("Envío");
    expect(renderToStaticMarkup(<FilaEnvioZona costo={0} gratis estimado={undefined} />)).toContain("Sin cargo");
  });

  it("«desde» aclara que no está en el total y suma llegada y aviso de feriados", () => {
    const html = renderToStaticMarkup(<FilaEnvioZona costo={undefined} gratis={false} estimado={estimado("desde")} />);
    expect(html).toContain("desde ");
    expect(html).toContain("No está incluido en el total");
    expect(html).toContain("Llega mañana");
    expect(html).toContain("Los feriados no hay entregas.");
  });
});

describe("FilaEnvioZona: cartel del método", () => {
  it("el estimado lleva el cartel verde con el NOMBRE del método (no un texto fijo)", () => {
    const html = renderToStaticMarkup(<FilaEnvioZona costo={undefined} gratis={false} estimado={{ ...estimado("exacto"), metodo: "Envío rápido" }} />);
    expect(html).toContain("Envío rápido");
    expect(html).toContain("bg-success-soft");
    expect(html).not.toContain("Envío en el día");
  });

  it("con costo resuelto: cartel, «Llega … por $» y la condición en verde", () => {
    const html = renderToStaticMarkup(
      <FilaEnvioZona
        costo={4490}
        gratis={false}
        estimado={undefined}
        metodo={{ nombre: "Envío rápido", zona: "Centro", horario: { dias: [1, 2, 3, 4, 5, 6, 7], horaCorte: "23:59", margenMin: 0 }, horarioEntrega: "antes de las 21 hs" }}
      />,
    );
    expect(html).toContain("Envío rápido");
    expect(html).toContain("antes de las 21 hs por");
  });
});

describe("configEnvioPublica", () => {
  it("saca los métodos (con los polígonos) y deja el resto", () => {
    const cfg = { ...CONFIG_ENVIO_DEFAULT, metodos: [{ id: "m" } as never] };
    const pub = configEnvioPublica(cfg);
    expect(pub).not.toHaveProperty("metodos");
    expect(pub.domicilioActivo).toBe(true);
  });
  it("sin métodos devuelve la misma config", () => {
    expect(configEnvioPublica(CONFIG_ENVIO_DEFAULT)).toBe(CONFIG_ENVIO_DEFAULT);
  });
});
