"use client";

import { useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Field,
  FileDropZone,
  Input,
  Progress,
  Select,
  Textarea,
  useToast,
} from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import {
  MAX_FILE_BYTES,
  MAX_METHOD_OTHER_CHARS,
  MAX_NOTES_CHARS,
  MENSAJES_CAMPO,
  DECLARED_CONTENT_TYPES,
  arYmd,
  isValidPaidOn,
  normalizarMonto,
  parseAmount,
  tipoDeclarado,
} from "@/lib/comprobantes/validacion";
import {
  ACCEPT_COMPROBANTE,
  LABEL_ESTADO_COMPROBANTE,
  OPCIONES_MEDIO,
  TONO_ESTADO_COMPROBANTE,
  fechaCorta,
  montoDe,
} from "@/lib/comprobantes/vista-comprobantes";
import type { ComprobanteCliente } from "@/lib/comprobantes/repo";
import { IconoSubir } from "../iconos";
import { useAlOcultar } from "@/lib/use-al-ocultar";

/**
 * "Informar pago" (CMP-1): formulario en un `Dialog`. El archivo NO pasa por
 * el Shop: primero se pide una URL PUT prefirmada (init), se sube directo a
 * R2 con XHR (con progreso) y recién después se confirma, que verifica el
 * archivo y avisa a la empresa. Un error recuperable de la subida no llama al
 * confirm: se puede reintentar a la misma URL (vive 10 minutos) sin crear
 * otro comprobante.
 *
 * Portado de apps/admin/src/components/portal/InformarPagoModal.tsx, con los
 * mismos pasos, reintentos y aviso de duplicado; al terminar cierra y avisa
 * con un toast.
 */

type Etapa = "form" | "creating" | "uploading" | "confirming";

interface InitResponse {
  id: string;
  upload: { url: string; method: "PUT"; headers: { "content-type": string }; expiresAt: string };
}

interface Fallo {
  mensaje: string;
  /** Dónde falló: la subida (re-PUT a la misma URL) o el confirm (re-llamada). */
  etapa: "put" | "confirm";
  reintentable: boolean;
}

const ERROR_SUBIDA = "No pudimos subir el archivo. Inténtelo de nuevo.";
const ERROR_CONFIRM = "No pudimos procesar el comprobante. Inténtelo de nuevo.";
const ERROR_RED = "No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.";

/** Últimos comprobantes que se muestran en el formulario (aviso anti-duplicados, como el portal). */
const ULTIMOS_INFORMADOS = 5;

export function InformarPago({
  ultimos,
  onInformado,
}: {
  /** Los últimos comprobantes enviados, para no duplicar. */
  ultimos: ComprobanteCliente[];
  /** Se llama tras un comprobante recibido (para refrescar la lista). */
  onInformado: () => void;
}) {
  const { toast } = useToast();
  const [abierto, setAbierto] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [monto, setMonto] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [method, setMethod] = useState("");
  const [methodOther, setMethodOther] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState("");
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [etapa, setEtapa] = useState<Etapa>("form");
  const [progreso, setProgreso] = useState(0);
  // El XHR y la respuesta del init viven en refs: se usan dentro de handlers y
  // el cierre del diálogo aborta la subida en curso.
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const initRef = useRef<InitResponse | null>(null);
  // Al salir de la página el diálogo se cierra sin abortar: una subida en
  // curso sigue y, al terminar, limpia el formulario como siempre (`cerrar`).
  // Un borrador sin enviar se conserva para cuando vuelva a abrirlo.
  useAlOcultar(() => setAbierto(false));

  const ocupado = etapa !== "form";

  function limpiarCampo(campo: string) {
    setFieldErrors((prev) => ({ ...prev, [campo]: "" }));
  }

  function reiniciar() {
    setFile(null);
    setMonto("");
    setPaidOn("");
    setMethod("");
    setMethodOther("");
    setNotes("");
    setFieldErrors({});
    setErrorGeneral("");
    setFallo(null);
    setEtapa("form");
    setProgreso(0);
    initRef.current = null;
  }

  function cerrar() {
    // Aborta la subida en curso. Si el confirm ya arrancó, sigue en el
    // servidor: el comprobante queda igual.
    xhrRef.current?.abort();
    setAbierto(false);
    reiniciar();
  }

  function validar(): boolean {
    const errores: Record<string, string> = {};
    if (!file) {
      errores.file = MENSAJES_CAMPO.file;
    } else {
      const tipo = tipoDeclarado(file);
      if (!(DECLARED_CONTENT_TYPES as readonly string[]).includes(tipo)) errores.file = MENSAJES_CAMPO.fileTipo;
      else if (file.size <= 0) errores.file = MENSAJES_CAMPO.fileVacio;
      else if (file.size > MAX_FILE_BYTES) errores.file = MENSAJES_CAMPO.fileGrande;
    }
    const normalizado = normalizarMonto(monto);
    if (!normalizado || !parseAmount(normalizado)) errores.amount = MENSAJES_CAMPO.amount;
    if (!isValidPaidOn(paidOn, new Date())) errores.paidOn = MENSAJES_CAMPO.paidOn;
    if (!method) errores.method = MENSAJES_CAMPO.method;
    if (method === "otro" && methodOther.trim().length === 0) errores.methodOther = MENSAJES_CAMPO.methodOther;
    else if (methodOther.trim().length > MAX_METHOD_OTHER_CHARS) errores.methodOther = MENSAJES_CAMPO.methodOtherLargo;
    if (notes.length > MAX_NOTES_CHARS) errores.notes = MENSAJES_CAMPO.notes;
    setFieldErrors(errores);
    return Object.keys(errores).length === 0;
  }

  async function iniciar() {
    if (!file) return;
    setEtapa("creating");
    setErrorGeneral("");
    setFallo(null);
    try {
      const res = await fetch("/api/mi-cuenta/comprobantes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: normalizarMonto(monto),
          paidOn,
          method,
          methodOther: method === "otro" ? methodOther.trim() : undefined,
          notes: notes.trim() || undefined,
          file: { name: file.name, size: file.size, contentType: tipoDeclarado(file) },
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | (Partial<InitResponse> & { error?: string; fields?: Record<string, string> })
        | null;
      if (!res.ok || !body?.id || !body.upload) {
        // 400 trae errores por campo; el resto (413/415/429/503/500) un mensaje general.
        if (body?.fields) setFieldErrors(body.fields);
        setErrorGeneral(body?.error ?? ERROR_SUBIDA);
        setEtapa("form");
        return;
      }
      const init = body as InitResponse;
      initRef.current = init;
      subir(init);
    } catch {
      setErrorGeneral(ERROR_RED);
      setEtapa("form");
    }
  }

  function subir(init: InitResponse) {
    const archivo = file;
    if (!archivo) return;
    setEtapa("uploading");
    setProgreso(0);
    setFallo(null);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", init.upload.url);
    // El content-type tiene que ser EXACTAMENTE el firmado: si difiere, R2 rechaza con 403.
    xhr.setRequestHeader("content-type", init.upload.headers["content-type"]);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgreso(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    const falloSubida = () => {
      xhrRef.current = null;
      // Recuperable: la fila sigue `uploading` y la URL sigue viva.
      setFallo({ mensaje: ERROR_SUBIDA, etapa: "put", reintentable: true });
      setEtapa("form");
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        xhrRef.current = null;
        void confirmar(init.id);
        return;
      }
      falloSubida();
    };
    xhr.onerror = falloSubida;
    xhr.onabort = () => {
      xhrRef.current = null;
    };
    xhr.send(archivo);
  }

  async function confirmar(id: string) {
    setEtapa("confirming");
    setFallo(null);
    try {
      const res = await fetch(`/api/mi-cuenta/comprobantes/${id}/confirm`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
        duplicadoDe?: { submittedAt: string };
      } | null;
      if (res.status === 202) {
        cerrar();
        toast({
          tone: "neutral",
          title: "Comprobante en proceso",
          description: "Recibimos el archivo y lo estamos procesando. Si no aparece en unos minutos, vuelva a informarlo.",
        });
        onInformado();
        return;
      }
      if (res.ok) {
        cerrar();
        const dup = body?.duplicadoDe?.submittedAt;
        toast({
          tone: dup ? "warning" : "success",
          title: "Comprobante recibido",
          description: dup
            ? `Este archivo ya se había enviado el ${fechaCorta(dup)}. Lo registramos igual; puede tratarse de un envío duplicado.`
            : "Lo revisaremos y lo registraremos a la brevedad.",
        });
        onInformado();
        return;
      }
      const mensaje = body?.error ?? ERROR_CONFIRM;
      // 409 upload_missing: la subida no llegó, se reintenta el PUT. 502/503:
      // reintentar el confirm. 404/413/415/422: rechazado, no tiene sentido reintentar.
      if (res.status === 409 && body?.code === "upload_missing") {
        setFallo({ mensaje, etapa: "put", reintentable: true });
      } else if (res.status === 502 || res.status === 503) {
        setFallo({ mensaje, etapa: "confirm", reintentable: true });
      } else {
        setFallo({ mensaje, etapa: "confirm", reintentable: false });
        initRef.current = null;
      }
      setEtapa("form");
    } catch {
      setFallo({ mensaje: ERROR_CONFIRM, etapa: "confirm", reintentable: true });
      setEtapa("form");
    }
  }

  function reintentar() {
    if (!fallo?.reintentable) return;
    setErrorGeneral("");
    const init = initRef.current;
    if (fallo.etapa === "confirm" && init) {
      void confirmar(init.id);
      return;
    }
    // Subida: con la URL viva se reintenta a la misma key; si venció, init nuevo.
    if (init && new Date(init.upload.expiresAt).getTime() > Date.now()) {
      subir(init);
    } else {
      initRef.current = null;
      void iniciar();
    }
  }

  function enviar() {
    setErrorGeneral("");
    if (!validar()) return;
    initRef.current = null;
    void iniciar();
  }

  const mensajeError = fallo?.mensaje ?? errorGeneral;
  const recientes = ultimos.slice(0, ULTIMOS_INFORMADOS);

  return (
    <>
      <Button onClick={() => setAbierto(true)}>
        <IconoSubir /> Informar pago
      </Button>

      <Dialog
        open={abierto}
        onOpenChange={(o) => {
          if (!o) cerrar();
        }}
        title="Informar pago"
        description="Adjunte el comprobante de su pago. Lo revisaremos y lo registraremos en su cuenta."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={cerrar} disabled={ocupado}>
              Cancelar
            </Button>
            {fallo?.reintentable && etapa === "form" ? (
              <Button onClick={reintentar}>{fallo.etapa === "put" ? "Reintentar la subida" : "Reintentar"}</Button>
            ) : (
              <Button onClick={enviar} loading={ocupado} disabled={ocupado}>
                {etapa === "uploading" ? "Subiendo…" : etapa === "confirming" ? "Procesando…" : "Enviar comprobante"}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Archivo del comprobante" error={fieldErrors.file || undefined}>
            <FileDropZone
              file={file}
              onChange={(f) => {
                setFile(f);
                limpiarCampo("file");
              }}
              accept={ACCEPT_COMPROBANTE}
              hint="PDF o imagen (JPG, PNG, WebP o HEIC) · hasta 20 MB"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Monto (ARS)" error={fieldErrors.amount || undefined}>
              <Input
                inputMode="decimal"
                placeholder="Ej.: 150000,50"
                value={monto}
                disabled={ocupado}
                aria-invalid={Boolean(fieldErrors.amount)}
                onChange={(e) => {
                  setMonto(e.target.value);
                  limpiarCampo("amount");
                }}
              />
            </Field>
            <Field label="Fecha del pago" error={fieldErrors.paidOn || undefined}>
              <Input
                type="date"
                value={paidOn}
                max={arYmd(new Date())}
                disabled={ocupado}
                aria-invalid={Boolean(fieldErrors.paidOn)}
                onChange={(e) => {
                  setPaidOn(e.target.value);
                  limpiarCampo("paidOn");
                }}
              />
            </Field>
          </div>

          <Field label="Medio de pago" error={fieldErrors.method || undefined}>
            <Select
              options={[...OPCIONES_MEDIO]}
              value={method}
              placeholder="Seleccione el medio"
              disabled={ocupado}
              aria-invalid={Boolean(fieldErrors.method)}
              onValueChange={(v) => {
                setMethod(v);
                limpiarCampo("method");
              }}
            />
          </Field>

          {method === "otro" && (
            <Field label="Especifique el medio" error={fieldErrors.methodOther || undefined}>
              <Input
                placeholder="Ej.: Mercado Pago, link de pago"
                value={methodOther}
                maxLength={MAX_METHOD_OTHER_CHARS}
                disabled={ocupado}
                aria-invalid={Boolean(fieldErrors.methodOther)}
                onChange={(e) => {
                  setMethodOther(e.target.value);
                  limpiarCampo("methodOther");
                }}
              />
            </Field>
          )}

          <Field
            label="Notas (opcional)"
            error={fieldErrors.notes || undefined}
            hint={`Máximo ${MAX_NOTES_CHARS} caracteres. Por ejemplo, el número de operación.`}
          >
            <Textarea
              value={notes}
              maxLength={MAX_NOTES_CHARS}
              disabled={ocupado}
              aria-invalid={Boolean(fieldErrors.notes)}
              onChange={(e) => {
                setNotes(e.target.value);
                limpiarCampo("notes");
              }}
            />
          </Field>

          {etapa === "form" && recientes.length > 0 && (
            <section aria-labelledby="ultimos-comprobantes" className="flex flex-col gap-2">
              <p id="ultimos-comprobantes" className="text-xs font-medium text-muted">
                Últimos comprobantes enviados
              </p>
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {recientes.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-muted">
                      {fechaCorta(c.paidOn)} · <span className="tabular-nums">{fmtPrecio(montoDe(c))}</span>
                    </span>
                    <Badge tone={TONO_ESTADO_COMPROBANTE[c.status]}>{LABEL_ESTADO_COMPROBANTE[c.status]}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(etapa === "uploading" || etapa === "confirming") && (
            <div className="flex flex-col gap-2">
              <Progress value={etapa === "confirming" ? 100 : progreso} aria-label="Subida del comprobante" />
              <p className="text-xs text-muted" aria-live="polite">
                {etapa === "confirming" ? "Procesando el comprobante…" : `Subiendo… ${progreso}%`}
              </p>
            </div>
          )}

          {etapa === "form" && mensajeError && <Alert tone="danger">{mensajeError}</Alert>}
        </div>
      </Dialog>
    </>
  );
}
