import { AwsV4Signer } from "aws4fetch";

// Portado de apps/admin/src/lib/r2.ts (firma PUT, head, lectura con tope,
// put y delete); candidato a packages/ cuando exista el primer paquete
// compartido.
//
// Cliente de R2 (Cloudflare) sobre el protocolo S3. La región va siempre en
// "auto": R2 no tiene regiones en el sentido de S3, pero la firma SigV4
// exige el campo igual.
//
// El archivo del navegador nunca pasa por acá: sube directo a R2 con una URL
// PUT prefirmada (presignPut). Acá se firma, se verifica (head, getRange,
// getObject), se publica (put) y se borra (delete). Lo usan las imágenes de
// la home (shop-media.ts) y los comprobantes de pago (comprobantesR2).

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** R2_REGION, default "auto". */
  region: string;
}

export class R2Error extends Error {
  constructor(
    readonly op: "head" | "get" | "put" | "delete" | "presign",
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "R2Error";
  }
}

export class R2TooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`el objeto supera el límite de ${limit} bytes`);
    this.name = "R2TooLargeError";
  }
}

export interface R2Deps {
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface R2Client {
  /** URL PUT firmada por query con content-type y content-length DENTRO de
   * la firma (allHeaders:true): R2 rechaza con 403 un PUT cuyo tipo o
   * tamaño no matcheen. */
  presignPut(
    key: string,
    o: { contentType: string; contentLength: number; ttlSeconds: number },
  ): Promise<{ url: string; headers: { "content-type": string }; expiresAt: Date }>;
  /** null = 404. */
  head(key: string): Promise<{ size: number; contentType: string | null; etag: string | null } | null>;
  /** 206/200; null = 404. */
  getRange(key: string, start: number, endInclusive: number): Promise<Uint8Array | null>;
  /** Lee el objeto completo abortando la lectura y lanzando R2TooLargeError al pasar maxBytes. */
  getObject(key: string, o: { maxBytes: number }): Promise<Uint8Array | null>;
  put(key: string, body: Uint8Array, o: { contentType: string; contentDisposition?: string }): Promise<void>;
  /** 204/404 ⇒ ok. */
  delete(key: string): Promise<void>;
}

function endpointFor(cfg: R2Config, key: string): string {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key}`;
}

const amzDatetime = (d: Date): string => d.toISOString().replace(/[:-]|\.\d{3}/g, "");

export function createR2(cfg: R2Config, deps: R2Deps = {}): R2Client {
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  // Cache de credenciales derivadas por fecha: sin esto cada firma re-haría las 4 HMACs.
  const cache = new Map<string, ArrayBuffer>();

  async function signedRequest(method: string, key: string, init: { headers?: HeadersInit; body?: BodyInit }): Promise<Response> {
    const signer = new AwsV4Signer({
      method,
      url: endpointFor(cfg, key),
      headers: init.headers,
      body: init.body,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: "s3",
      region: cfg.region,
      cache,
      datetime: amzDatetime(now()),
    });
    const signed = await signer.sign();
    return fetchFn(new Request(signed.url.toString(), { method: signed.method, headers: signed.headers, body: signed.body }));
  }

  async function presign(method: "GET" | "PUT", key: string, init: { headers?: HeadersInit; query?: [string, string][] }): Promise<string> {
    const url = new URL(endpointFor(cfg, key));
    for (const [k, v] of init.query ?? []) url.searchParams.set(k, v);
    const signer = new AwsV4Signer({
      method,
      url: url.toString(),
      headers: init.headers,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: "s3",
      region: cfg.region,
      cache,
      datetime: amzDatetime(now()),
      signQuery: true,
      allHeaders: true,
    });
    const signed = await signer.sign();
    return signed.url.toString();
  }

  return {
    async presignPut(key, o) {
      const url = await presign("PUT", key, {
        headers: { "content-type": o.contentType, "content-length": String(o.contentLength) },
        query: [["X-Amz-Expires", String(o.ttlSeconds)]],
      });
      return { url, headers: { "content-type": o.contentType }, expiresAt: new Date(now().getTime() + o.ttlSeconds * 1000) };
    },

    async head(key) {
      const res = await signedRequest("HEAD", key, {});
      if (res.status === 404) return null;
      if (!res.ok) throw new R2Error("head", res.status, `HEAD ${key} respondió ${res.status}`);
      const size = Number(res.headers.get("content-length") ?? "0");
      return { size, contentType: res.headers.get("content-type"), etag: res.headers.get("etag") };
    },

    async getRange(key, start, endInclusive) {
      const res = await signedRequest("GET", key, { headers: { range: `bytes=${start}-${endInclusive}` } });
      if (res.status === 404) return null;
      if (!res.ok) throw new R2Error("get", res.status, `GET range ${key} respondió ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async getObject(key, o) {
      const res = await signedRequest("GET", key, {});
      if (res.status === 404) return null;
      if (!res.ok) throw new R2Error("get", res.status, `GET ${key} respondió ${res.status}`);
      if (res.body === null) {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length > o.maxBytes) throw new R2TooLargeError(o.maxBytes);
        return buf;
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > o.maxBytes) {
            // Se aborta apenas se pasa el tope: un objeto grande no sigue
            // bajando ni queda entero en memoria.
            await reader.cancel().catch(() => {});
            throw new R2TooLargeError(o.maxBytes);
          }
          chunks.push(value);
        }
      } catch (err) {
        if (err instanceof R2TooLargeError) throw err;
        await reader.cancel().catch(() => {});
        throw err;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    },

    async put(key, body, o) {
      const headers: Record<string, string> = {
        "content-type": o.contentType,
        // R2 rechaza con 411 un PUT chunked: el largo es exacto y hay que
        // declararlo (en Vercel llegó chunked y el confirm del CRM explotó).
        "content-length": String(body.byteLength),
      };
      if (o.contentDisposition) headers["content-disposition"] = o.contentDisposition;
      // Uint8Array genérico no calza con BodyInit en TS 5.7+; el runtime lo acepta.
      const res = await signedRequest("PUT", key, { headers, body: body as unknown as BodyInit });
      if (!res.ok) throw new R2Error("put", res.status, `PUT ${key} respondió ${res.status}`);
    },

    async delete(key) {
      const res = await signedRequest("DELETE", key, {});
      if (res.status === 404 || res.ok) return;
      throw new R2Error("delete", res.status, `DELETE ${key} respondió ${res.status}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Bucket de comprobantes de pago (el MISMO que usa el backoffice del CRM).
// ---------------------------------------------------------------------------

const COMPROBANTES_ENV = ["R2_RECEIPTS_ACCESS_KEY_ID", "R2_RECEIPTS_SECRET_ACCESS_KEY", "R2_RECEIPTS_BUCKET"] as const;

let comprobantesWarned = false;

/**
 * Credenciales del bucket de comprobantes, o null si falta alguna (null ⇒
 * "Informar pago" no se muestra y la API responde 503). `accountId` y
 * `region` son de la cuenta de Cloudflare: `R2_RECEIPTS_ACCOUNT_ID` si
 * difiere, si no `R2_ACCOUNT_ID`. Conviene un token acotado a este bucket.
 */
export function comprobantesR2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = env.R2_RECEIPTS_ACCOUNT_ID || env.R2_ACCOUNT_ID;
  const values = COMPROBANTES_ENV.map((name) => env[name]);
  if (accountId && values.every((v) => typeof v === "string" && v.length > 0)) {
    const [accessKeyId, secretAccessKey, bucket] = values as [string, string, string];
    return { accountId, accessKeyId, secretAccessKey, bucket, region: env.R2_REGION ?? "auto" };
  }
  if (!comprobantesWarned) {
    comprobantesWarned = true;
    const missing = [
      ...(accountId ? [] : ["R2_RECEIPTS_ACCOUNT_ID o R2_ACCOUNT_ID"]),
      ...COMPROBANTES_ENV.filter((name) => !env[name]),
    ];
    console.error(`[r2] config de comprobantes incompleta (faltan ${missing.join(", ")}): informar pago deshabilitado`);
  }
  return null;
}

let comprobantesCached: R2Client | null | undefined;

/** Cliente del bucket de comprobantes, memoizado por proceso; null sin config. */
export function getComprobantesR2(): R2Client | null {
  if (comprobantesCached !== undefined) return comprobantesCached;
  const cfg = comprobantesR2Config();
  comprobantesCached = cfg ? createR2(cfg) : null;
  return comprobantesCached;
}

/** Sólo para tests: descarta el cliente memoizado. */
export function resetComprobantesR2(): void {
  comprobantesCached = undefined;
  comprobantesWarned = false;
}
