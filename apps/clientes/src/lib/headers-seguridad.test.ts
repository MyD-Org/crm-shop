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
    expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=(self)");
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
    expect(csp).toMatch(/frame-src [^;]*https:\/\/\*\.mercadopago\.com\.ar/);
    expect(csp).toMatch(/form-action [^;]*https:\/\/\*\.mercadopago\.com\.ar/);
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

  it("tracking: Meta y GA4 sólo con su ID cargado", () => {
    const sin = politicaCsp({ NODE_ENV: "production" });
    expect(sin).not.toContain("facebook");
    expect(sin).not.toContain("googletagmanager");
    expect(sin).not.toContain("va.vercel-scripts.com");

    const con = politicaCsp({ NODE_ENV: "production", META_PIXEL_ID: "1234567890", GA4_MEASUREMENT_ID: "G-ABC123" });
    expect(con).toMatch(/script-src [^;]*https:\/\/connect\.facebook\.net/);
    expect(con).toMatch(/img-src [^;]*https:\/\/www\.facebook\.com/);
    expect(con).toMatch(/connect-src [^;]*https:\/\/www\.facebook\.com/);
    expect(con).toMatch(/script-src [^;]*https:\/\/www\.googletagmanager\.com/);
    expect(con).toMatch(/connect-src [^;]*https:\/\/\*\.google-analytics\.com [^;]*https:\/\/\*\.analytics\.google\.com/);
    expect(con).toMatch(/img-src [^;]*https:\/\/\*\.google-analytics\.com/);
  });

  it("el script de Vercel Analytics de desarrollo sólo en desarrollo", () => {
    expect(politicaCsp({ NODE_ENV: "development" })).toMatch(/script-src [^;]*https:\/\/va\.vercel-scripts\.com/);
  });
});

describe("Payway: connect-src sólo en las páginas de checkout", () => {
  const env = { PAYWAY_API_PUBLIC_KEY: "clave-publica-de-prueba", PAYWAY_BASE_URL: "https://payway.example/api/v2" };

  it("con key pública y base https, el checkout puede conectar con el host de Payway", () => {
    const csp = politicaCsp(env, { checkout: true });
    expect(csp).toMatch(/connect-src [^;]*https:\/\/payway\.example(?:[ ;]|$)/);
    // El SDK oficial (decidir.js) se sirve desde el host de Payway; sin frame-src: no hay iframe.
    expect(csp).toMatch(/script-src [^;]*https:\/\/ventasonline\.payway\.com\.ar/);
    expect(csp).not.toMatch(/frame-src [^;]*payway/);
    // Huella de dispositivo de Cybersource (el SDK la carga: ver CYBERSOURCE_FINGERPRINT).
    for (const d of ["script-src", "frame-src", "img-src", "connect-src"]) {
      expect(csp).toMatch(new RegExp(`${d} [^;]*https://h\\.online-metrix\\.net`));
    }
    // Sólo el origen: ni ruta ni la key.
    expect(csp).not.toContain("/api/v2");
    expect(csp).not.toContain("clave-publica-de-prueba");
  });

  it("el resto del sitio no lo incluye", () => {
    expect(politicaCsp(env)).not.toContain("payway");
    expect(politicaCsp(env)).not.toContain("online-metrix");
    expect(politicaCsp(env, { checkout: false })).not.toContain("payway");
  });

  it("sin key pública, o sin base https válida, tampoco en el checkout", () => {
    expect(politicaCsp({ PAYWAY_BASE_URL: env.PAYWAY_BASE_URL }, { checkout: true })).not.toContain("payway");
    expect(politicaCsp({ PAYWAY_API_PUBLIC_KEY: "k", PAYWAY_BASE_URL: "http://payway.example" }, { checkout: true })).not.toContain(
      "payway",
    );
    expect(politicaCsp({ PAYWAY_API_PUBLIC_KEY: "k" }, { checkout: true })).not.toContain("payway");
  });

  it("next.config: una regla propia para /checkout, posterior a la general (la última gana)", async () => {
    const prev = { ...process.env };
    process.env.PAYWAY_API_PUBLIC_KEY = env.PAYWAY_API_PUBLIC_KEY;
    process.env.PAYWAY_BASE_URL = env.PAYWAY_BASE_URL;
    try {
      const reglas = await nextConfig.headers!();
      const iGeneral = reglas.findIndex((r) => r.source === "/:path*");
      const iCheckout = reglas.findIndex((r) => r.source === "/checkout");
      expect(iGeneral).toBeGreaterThanOrEqual(0);
      expect(iCheckout).toBeGreaterThan(iGeneral);
      const csp = (i: number) =>
        reglas[i].headers.find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
      expect(csp(iCheckout)).toContain("https://payway.example");
      expect(csp(iGeneral)).not.toContain("payway");
    } finally {
      process.env = prev;
    }
  });
});
