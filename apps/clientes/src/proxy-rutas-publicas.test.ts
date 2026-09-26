import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// El handler de Clerk no participa en estos casos (las rutas públicas salen
// antes); se reemplaza para no depender de claves de Clerk en el test.
const clerk = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: () => clerk }));

/**
 * Guarda estática: todo `/api/internal/<x>/revalidar` lo llama el CRM con
 * Bearer y sin cookie de gate. Si no está en RUTAS_PUBLICAS, la cortina de
 * "Próximamente" responde 200 con HTML y el CRM lo da por propagado.
 *
 * Lo mismo para todo `/api/webhooks/<x>`: lo llama un servidor externo (Clerk
 * vía Svix) sin cookie.
 */

const PROXY = fileURLToPath(new URL("./proxy.ts", import.meta.url));
const INTERNAL = fileURLToPath(new URL("./app/api/internal", import.meta.url));
const WEBHOOKS = fileURLToPath(new URL("./app/api/webhooks", import.meta.url));

function rutasWebhooks(): string[] {
  return readdirSync(WEBHOOKS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      try {
        readFileSync(join(WEBHOOKS, d.name, "route.ts"));
        return [`/api/webhooks/${d.name}`];
      } catch {
        return [];
      }
    });
}

function rutasRevalidar(): string[] {
  return readdirSync(INTERNAL, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      try {
        readFileSync(join(INTERNAL, d.name, "revalidar", "route.ts"));
        return [`/api/internal/${d.name}/revalidar`];
      } catch {
        return [];
      }
    });
}

describe("proxy: RUTAS_PUBLICAS", () => {
  it("incluye cada endpoint interno de revalidación", () => {
    const texto = readFileSync(PROXY, "utf8");
    const rutas = rutasRevalidar();
    expect(rutas).toContain("/api/internal/cuotas/revalidar");
    for (const ruta of rutas) expect(texto).toContain(`"${ruta}"`);
  });

  it("incluye cada webhook de /api/webhooks", () => {
    const texto = readFileSync(PROXY, "utf8");
    const rutas = rutasWebhooks();
    expect(rutas).toContain("/api/webhooks/clerk");
    for (const ruta of rutas) expect(texto).toContain(`"${ruta}"`);
  });

  describe("con el gate de Próximamente activo", () => {
    afterEach(() => {
      delete process.env.SITE_AUTH_USER;
      delete process.env.SITE_AUTH_PASSWORD;
      clerk.mockReset();
    });

    const post = (ruta: string) =>
      new NextRequest(`https://tienda.example${ruta}`, { method: "POST", body: "{}" });

    it("el webhook de Clerk llega al handler (no recibe el HTML del gate)", async () => {
      process.env.SITE_AUTH_USER = "equipo";
      process.env.SITE_AUTH_PASSWORD = "clave-de-prueba";
      const { proxy } = await import("./proxy");
      const r = await proxy(post("/api/webhooks/clerk"), {} as never);
      expect(r.headers.get("x-middleware-next")).toBe("1");
      expect(r.headers.get("content-type") ?? "").not.toContain("text/html");
      expect(clerk).not.toHaveBeenCalled();
    });

    it("control: otra API sin cookie sí recibe la cortina", async () => {
      process.env.SITE_AUTH_USER = "equipo";
      process.env.SITE_AUTH_PASSWORD = "clave-de-prueba";
      const { proxy } = await import("./proxy");
      const r = await proxy(post("/api/carrito"), {} as never);
      expect(r.headers.get("content-type")).toContain("text/html");
    });
  });
});
