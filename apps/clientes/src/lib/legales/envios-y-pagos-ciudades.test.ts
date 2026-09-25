import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/envio", async (original) => ({
  ...(await original<typeof import("@/lib/envio")>()),
  CIUDADES_ENVIO: ["Puerto Iguazú", "El Dorado", "Ciudad Ejemplo"],
}));

import { bloquesEnviosYPagos } from "./envios-y-pagos";

describe("envíos y pagos sale de lib/envio", () => {
  it("una ciudad nueva en CIUDADES_ENVIO aparece sin tocar la página", () => {
    const t = bloquesEnviosYPagos({ envio: true, pagos: false, cuotas: false })
      .flatMap((b) => b.parrafos)
      .join("\n");
    expect(t).toContain("Ciudad Ejemplo");
  });
});
