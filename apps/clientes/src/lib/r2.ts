import { AwsV4Signer } from "aws4fetch";

// Portado de apps/admin/src/lib/r2.ts (solo firma PUT, head y delete);
// candidato a packages/ cuando exista el primer paquete compartido.
//
// Cliente de R2 (Cloudflare) sobre el protocolo S3. La región va siempre en
// "auto": R2 no tiene regiones en el sentido de S3, pero la firma SigV4
// exige el campo igual.
//
// El archivo nunca pasa por acá: el navegador sube directo a R2 con una URL
// PUT prefirmada (presignPut). Acá solo se firma, se verifica (head) y se
// borra (delete) si hiciera falta.

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
    readonly op: "head" | "put" | "delete" | "presign",
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "R2Error";
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

    async delete(key) {
      const res = await signedRequest("DELETE", key, {});
      if (res.status === 404 || res.ok) return;
      throw new R2Error("delete", res.status, `DELETE ${key} respondió ${res.status}`);
    },
  };
}
