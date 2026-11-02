import { permitirAsync } from "@/lib/rate-limit";

/**
 * Destino de los reportes de violaciones de la CSP (`report-uri`). Sólo loguea una línea corta por
 * reporte; no guarda nada. Sin autenticación (lo llama el navegador del visitante), por eso el tope
 * de tamaño y el límite de uso por IP. Siempre responde 204.
 */
const MAX_BYTES = 8 * 1024;
const MAX_POR_IP = 30;
const VENTANA_MS = 60_000;

function recortar(v: unknown): string {
  return typeof v === "string" ? v.slice(0, 200) : "";
}

export async function POST(req: Request) {
  const vacio = new Response(null, { status: 204 });
  const largo = Number(req.headers.get("content-length") ?? 0);
  if (largo > MAX_BYTES) return vacio;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "desconocida";
  if (!(await permitirAsync(`csp-report:ip:${ip}`, MAX_POR_IP, VENTANA_MS))) return vacio;

  try {
    const texto = await req.text();
    if (texto.length > MAX_BYTES) return vacio;
    const json = JSON.parse(texto) as Record<string, unknown>;
    // report-uri: { "csp-report": {...} }. Reporting API: [{ type, body }].
    const r = (json["csp-report"] ?? (Array.isArray(json) ? (json[0] as { body?: unknown })?.body : null)) as
      | Record<string, unknown>
      | null;
    if (r && typeof r === "object") {
      console.warn(
        "[csp-report]",
        recortar(r["effective-directive"] ?? r["effectiveDirective"] ?? r["violated-directive"]),
        "bloqueado:",
        recortar(r["blocked-uri"] ?? r["blockedURL"]),
        "en:",
        recortar(r["document-uri"] ?? r["documentURL"]).split("?")[0],
        "disposición:",
        recortar(r["disposition"]),
      );
    }
  } catch {
    // Cuerpo ilegible: se ignora.
  }
  return vacio;
}
