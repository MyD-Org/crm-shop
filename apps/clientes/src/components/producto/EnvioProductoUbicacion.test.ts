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
