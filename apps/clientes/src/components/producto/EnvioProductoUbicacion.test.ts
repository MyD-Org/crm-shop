import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_ENVIO_DEFAULT, textoEnvioFicha } from "@/lib/envio";

type Eleccion = Record<string, unknown>;
let resuelta: { ubicacion: unknown; eleccion: Eleccion };

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/ubicacion-servidor", () => ({ ubicacionDelVisitante: async () => resuelta }));

import { EnvioProductoUbicacion } from "./EnvioProductoUbicacion";

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const render = async (props: { plazo?: { texto: string; tono: "ok" | "demora" | "no" } | null } = {}) =>
  renderToStaticMarkup(await EnvioProductoUbicacion({ configEnvio: CONFIG_ENVIO_DEFAULT, ...props }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("EnvioProductoUbicacion con retiro elegido", () => {
  it("la fila de envío sigue la regla general y no muestra plazo", async () => {
    resuelta = {
      ubicacion: { localidad: "Ciudad Ejemplo", provincia: "cordoba" },
      eleccion: { tipo: "retiro", sucursal: { slug: "sede-a", nombre: "Local A", ciudad: "Ciudad Ejemplo", provincia: "Córdoba" } },
    };
    const h = await render({ plazo: { texto: "Despacho en 24 hs", tono: "ok" } });
    expect(texto(h)).toBe(textoEnvioFicha(CONFIG_ENVIO_DEFAULT));
    expect(h).not.toContain("Despacho");
  });
});

describe("EnvioProductoUbicacion con envío por zona y condición de origen", () => {
  const configConMetodo = async () => {
    const { metodoDePrueba } = await import("@/test/envio-metodo");
    const m = metodoDePrueba({ provinciaClave: "buenosaires" });
    const loc = m.localidades![0];
    return { config: { ...CONFIG_ENVIO_DEFAULT, metodos: [{ ...m, nombre: "Envío rápido" }] }, m, loc };
  };

  it("producto disponible en el local que despacha: anticipa el método", async () => {
    const { config, m, loc } = await configConMetodo();
    resuelta = { ubicacion: { localidad: loc.etiqueta ?? "", provincia: "Buenos Aires", id: loc.georefId }, eleccion: { tipo: "envio" } };
    const h = await EnvioProductoUbicacion({
      configEnvio: config,
      plazo: { texto: "Disponible", tono: "ok" },
      origen: { sucursal: m.sucursalOrigen, conTraslado: false },
    });
    expect(texto(renderToStaticMarkup(h))).toContain("Envío rápido");
  });

  it("producto a traer de otra sucursal: no promete el método; costo a coordinar y el plazo real", async () => {
    const { config, m, loc } = await configConMetodo();
    resuelta = { ubicacion: { localidad: loc.etiqueta ?? "", provincia: "Buenos Aires", id: loc.georefId }, eleccion: { tipo: "envio" } };
    const h = await EnvioProductoUbicacion({
      configEnvio: config,
      plazo: { texto: "Disponible en 7 días", tono: "demora" },
      origen: { sucursal: m.sucursalOrigen, conTraslado: true },
    });
    const t = texto(renderToStaticMarkup(h));
    expect(t).not.toContain("Envío rápido");
    expect(t).not.toContain("Llega");
    expect(t).toContain("Disponible en 7 días");
  });

  it("sin origen conocido (flag de disponibilidad apagado): como siempre", async () => {
    const { config, loc } = await configConMetodo();
    resuelta = { ubicacion: { localidad: loc.etiqueta ?? "", provincia: "Buenos Aires", id: loc.georefId }, eleccion: { tipo: "envio" } };
    const h = await EnvioProductoUbicacion({ configEnvio: config });
    expect(texto(renderToStaticMarkup(h))).toContain("Envío rápido");
  });
});
