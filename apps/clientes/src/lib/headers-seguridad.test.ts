import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { headersDeSeguridad, hostFrontendClerk, politicaCsp } from "./headers-seguridad";

const clave = (host: string) => `pk_live_${Buffer.from(`${host}$`).toString("base64")}`;

describe("headers() de next.config", () => {
  it("aplica los headers de seguridad a todas las rutas", async () => {
    const reglas = await nextConfig.headers!();
    const todas = reglas.find((r) => r.source === "/:path*");
    expect(todas).toBeDefined();
    const h = Object.fromEntries(todas!.headers.map((x) => [x.key, x.value]));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(h["Strict-Transport-Security"]).toMatch(/^max-age=\d+/);
    expect(h["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
  });

  it("la CSP va en Report-Only: nunca enforcing todavía", () => {
    const keys = headersDeSeguridad({}).map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).not.toContain("Content-Security-Policy");
  });
});

describe("politicaCsp", () => {
  it("deriva el Frontend API de Clerk de la publishable key", () => {
    expect(hostFrontendClerk(clave("clerk.tienda.example"))).toBe("clerk.tienda.example");
    expect(hostFrontendClerk(undefined)).toBeNull();
    expect(hostFrontendClerk("cualquier cosa")).toBeNull();
    const csp = politicaCsp({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clave("clerk.tienda.example") });
    expect(csp).toMatch(/script-src [^;]*https:\/\/clerk\.tienda\.example/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/clerk\.tienda\.example/);
  });

  it("incluye Mercado Pago, los medios de SHOP_MEDIA_HOSTS y R2", () => {
    const csp = politicaCsp({
      SHOP_MEDIA_HOSTS: "media.plataforma.example, otro.example",
      R2_SHOP_MEDIA_PUBLIC_URL: "https://media.plataforma.example",
    });
    expect(csp).toMatch(/script-src [^;]*https:\/\/sdk\.mercadopago\.com/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/\*\.mercadopago\.com/);
    expect(csp).toMatch(/img-src [^;]*https:\/\/media\.plataforma\.example [^;]*https:\/\/otro\.example/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/\*\.r2\.cloudflarestorage\.com/);
    // Sin duplicar el host que aparece en las dos variables.
    expect(csp.match(/https:\/\/media\.plataforma\.example/g)).toHaveLength(1);
  });

  it("'unsafe-eval' sólo en desarrollo, y report-uri sólo si está la variable", () => {
    expect(politicaCsp({ NODE_ENV: "production" })).not.toContain("unsafe-eval");
    expect(politicaCsp({ NODE_ENV: "development" })).toContain("'unsafe-eval'");
    expect(politicaCsp({})).not.toContain("report-uri");
    expect(politicaCsp({ CSP_REPORT_URI: "https://reportes.example/csp" })).toContain(
      "report-uri https://reportes.example/csp",
    );
  });
});
