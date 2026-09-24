// Portado de apps/admin/src/lib/receipt-confirm.ts. Mensajes en usted.
//
// Confirm de un comprobante: verifica LEYENDO desde R2 (los bytes nunca pasan
// por la ruta: el navegador subió directo con la URL prefirmada) y publica con
// PUT desde el buffer verificado, nunca con CopyObject (cierra el TOCTOU entre
// el sniff y la publicación).
//
// Pasos: claim (lease 120 s) → HEAD tmp → GET range + sniff → GET completo
// (tope 20 MB) → re-sniff → procesarArchivo (HEIC → JPEG) → sha256 → PUT final
// → publicar → delete tmp (best-effort) → mail (el mail NUNCA cambia el
// resultado).
//
// Las dependencias se inyectan para testear con fakes; la ruta arma el wiring
// real con `repo.ts`, `getComprobantesR2()` y `enviarAvisoComprobante`.

import { createHash } from "node:crypto";
import { R2TooLargeError, type R2Client } from "../r2";
import { extFor, procesarArchivo, sniffMime } from "./archivo";
import { claves, esUuid } from "./claves";
import { ReceiptImageError } from "./imagen";
import type { CamposPublicacion, ComprobanteFila } from "./repo";
import { MAX_FILE_BYTES } from "./validacion";

/** Subconjunto del repo que usa el confirm: cualquier fake con estas firmas sirve. */
export interface RepoConfirmar {
  tomarParaConfirmar(tenantId: string, codigocliente: string, id: string, now: Date): Promise<ComprobanteFila | null>;
  buscarDelCliente(tenantId: string, codigocliente: string, id: string): Promise<ComprobanteFila | null>;
  liberar(tenantId: string, id: string, now: Date): Promise<boolean>;
  rechazar(tenantId: string, id: string, reason: string, now: Date): Promise<void>;
  publicar(tenantId: string, id: string, fields: CamposPublicacion, at: Date): Promise<ComprobanteFila | null>;
  buscarDuplicado(
    tenantId: string,
    codigocliente: string,
    sha256: string,
    excludeId: string,
  ): Promise<{ id: string; submittedAt: Date } | null>;
}

export interface EntradaConfirmar {
  tenantId: string;
  codigocliente: string;
  id: string;
}

export interface DepsConfirmar {
  repo: RepoConfirmar;
  r2: R2Client;
  /** Envío del mail. Recibe el buffer publicado (para adjuntarlo sin releer
   * de R2) y el duplicado detectado. Un error acá nunca cambia el resultado. */
  avisar: (id: string, buffer: Uint8Array, duplicadoDe: { id: string; submittedAt: Date } | null) => Promise<unknown>;
  now?: () => Date;
}

export type ResultadoConfirmar =
  | { ok: true; status: "pending" | "loaded"; duplicadoDe?: { id: string; submittedAt: Date } | null }
  | { ok: false; status: number; code: string; error: string };

export const ERRORES_CONFIRMAR = {
  not_found: { status: 404, error: "No encontramos el comprobante." },
  in_progress: { status: 202, error: "El comprobante se está procesando. Inténtelo de nuevo en unos segundos." },
  upload_missing: { status: 409, error: "Todavía no recibimos el archivo del comprobante." },
  file_too_large: { status: 413, error: "El archivo supera el máximo de 20 MB." },
  size_mismatch: { status: 413, error: "El archivo no coincide con el que indicó al informar el pago." },
  unsupported_type: { status: 415, error: "El archivo no es un comprobante válido. Suba un PDF o una imagen." },
  image_too_large: { status: 415, error: "La imagen es demasiado grande." },
  processing_failed: { status: 422, error: "No pudimos procesar la imagen. Suba un PDF u otra imagen." },
  storage_error: { status: 502, error: "No pudimos verificar el archivo. Inténtelo de nuevo en unos minutos." },
} as const;

export type CodigoErrorConfirmar = keyof typeof ERRORES_CONFIRMAR;

// El reintento de un `rejected` responde el MISMO código con el que se rechazó.
const ERROR_RECHAZO: Record<string, { status: number; error: string }> = {
  file_too_large: ERRORES_CONFIRMAR.file_too_large,
  size_mismatch: ERRORES_CONFIRMAR.size_mismatch,
  unsupported_type: ERRORES_CONFIRMAR.unsupported_type,
  image_too_large: ERRORES_CONFIRMAR.image_too_large,
  processing_failed: ERRORES_CONFIRMAR.processing_failed,
};

export async function confirmarComprobante(
  entrada: EntradaConfirmar,
  deps: DepsConfirmar,
): Promise<ResultadoConfirmar> {
  const { tenantId, codigocliente, id } = entrada;
  const { repo, r2, avisar } = deps;
  const now = deps.now ?? (() => new Date());

  const fail = (code: CodigoErrorConfirmar): ResultadoConfirmar => ({ ok: false, code, ...ERRORES_CONFIRMAR[code] });

  // 1. Un id que no es UUID es inexistente: nunca llega a la base (evita el
  //    22P02 que Postgres devolvería como 500).
  if (!esUuid(id)) return fail("not_found");

  // 2. Claim atómico del lease. 0 filas ⇒ mirar la fila para decidir.
  const claimed = await repo.tomarParaConfirmar(tenantId, codigocliente, id, now());
  if (!claimed) {
    const row = await repo.buscarDelCliente(tenantId, codigocliente, id);
    if (!row) return fail("not_found");
    if (row.status === "pending" || row.status === "loaded") return { ok: true, status: row.status };
    if (row.status === "processing" || row.status === "uploading") return fail("in_progress");
    const meta = ERROR_RECHAZO[row.rejectReason ?? ""];
    if (meta) return { ok: false, code: row.rejectReason as string, ...meta };
    return { ok: false, status: 422, code: "rejected", error: "El comprobante fue rechazado." };
  }

  const tmpKey = claves.tmp(tenantId, id);

  // "rechazar X" = processing→rejected + DELETE tmp best-effort + responder X.
  const rechazar = async (code: CodigoErrorConfirmar): Promise<ResultadoConfirmar> => {
    await repo.rechazar(tenantId, id, code, now());
    await r2.delete(tmpKey).catch((err) => console.warn(`[comprobantes] delete tmp tras ${code}:`, err));
    return fail(code);
  };

  // Error de storage = liberar el lease (processing→uploading, reintentable) + 502.
  const errorStorage = async (cause: unknown): Promise<ResultadoConfirmar> => {
    console.error(`[comprobantes] storage_error en ${id}:`, cause);
    await repo.liberar(tenantId, id, now()).catch((err) => console.error("[comprobantes] liberar falló:", err));
    return fail("storage_error");
  };

  try {
    // 3. HEAD: el tmp tiene que existir y coincidir con lo declarado en el init.
    const head = await r2.head(tmpKey);
    if (!head) {
      await repo.liberar(tenantId, id, now());
      return fail("upload_missing");
    }
    if (head.size > MAX_FILE_BYTES) return rechazar("file_too_large");
    if (head.size !== claimed.declaredSize) return rechazar("size_mismatch");

    // 4. Primeros 1024 bytes + sniff barato (no bajar 20 MB de basura).
    const headBytes = await r2.getRange(tmpKey, 0, 1023);
    if (headBytes === null) return errorStorage(new Error("el tmp desapareció entre el HEAD y el GET"));
    const rangeMime = sniffMime(headBytes);
    if (rangeMime === null) return rechazar("unsupported_type");

    // 5. GET completo con tope duro de 20 MB.
    let bytes: Uint8Array | null;
    try {
      bytes = await r2.getObject(tmpKey, { maxBytes: MAX_FILE_BYTES });
    } catch (err) {
      if (err instanceof R2TooLargeError) return rechazar("file_too_large");
      throw err;
    }
    if (bytes === null) return errorStorage(new Error("el tmp desapareció entre el HEAD y el GET"));
    if (bytes.length !== claimed.declaredSize) return rechazar("size_mismatch");

    // 6. Re-sniff sobre los bytes completos: el tmp pudo cambiar entre el range
    //    y el GET (la URL PUT sigue viva).
    const mime = sniffMime(bytes);
    if (mime === null || mime !== rangeMime) return rechazar("unsupported_type");

    // 7. PDF pasa igual; imágenes se normalizan (HEIC/HEIF ⇒ JPEG).
    let procesado: Awaited<ReturnType<typeof procesarArchivo>>;
    try {
      procesado = await procesarArchivo(bytes, mime);
    } catch (err) {
      if (err instanceof ReceiptImageError) return rechazar(err.code);
      throw err;
    }

    // 8-9. sha256 de los bytes a publicar + PUT final desde ESE buffer.
    const sha256 = createHash("sha256").update(procesado.bytes).digest("hex");
    const submittedAt = now();
    const ext = extFor(procesado.mime);
    const finalKey = claves.final(tenantId, id, ext, submittedAt);
    await r2.put(finalKey, procesado.bytes, {
      contentType: procesado.mime,
      contentDisposition: `inline; filename="comprobante-${claimed.paidOn}-${id.slice(0, 8)}.${ext}"`,
    });

    // 10. Publicar. 0 filas = otro confirm retomó el lease y publicó: en curso,
    //     sin mail y sin borrar el tmp.
    const publicado = await repo.publicar(
      tenantId,
      id,
      {
        fileKey: finalKey,
        fileMime: procesado.mime,
        fileSize: procesado.bytes.length,
        fileSha256: sha256,
        convertedFrom: procesado.convertedFrom,
      },
      submittedAt,
    );
    if (!publicado) return fail("in_progress");

    // Aviso de duplicado (no bloquea): el mismo cliente ya había publicado estos bytes.
    const duplicadoDe = await repo.buscarDuplicado(tenantId, codigocliente, sha256, id);

    // 11. DELETE tmp best-effort: la lifecycle rule (1 día) cubre lo que falle.
    await r2.delete(tmpKey).catch((err) => console.warn(`[comprobantes] delete tmp ${tmpKey}:`, err));

    // 12. El mail NUNCA cambia el resultado.
    try {
      await avisar(id, procesado.bytes, duplicadoDe);
    } catch (err) {
      console.error(`[comprobantes] aviso por mail falló para ${id}:`, err);
    }

    return { ok: true, status: "pending", ...(duplicadoDe ? { duplicadoDe } : {}) };
  } catch (err) {
    return errorStorage(err);
  }
}
