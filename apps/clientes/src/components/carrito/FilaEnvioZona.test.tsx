import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilaEnvioZona } from "./FilaEnvioZona";
import { configEnvioPublica, CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import type { EstimadoFicha } from "@/lib/envio-zona-textos";

const estimado = (tipo: "exacto" | "desde"): EstimadoFicha => ({
  tipo,
  precio: 4500,
  texto: "x",
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
