"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { hrefBusqueda } from "@/lib/busqueda-inteligente/descubrimiento";
import { destinoEscaneo } from "@/lib/escaneo";

/** Ícono del botón del buscador: un código de barras entre las esquinas del visor. */
export function EscanearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 8v8M10 8v8M13 8v8M17 8v8" />
    </svg>
  );
}

/** Hay cámara que pedir: navegador con getUserMedia y página segura (https o localhost). */
export function puedeEscanear(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

type Estado =
  | { fase: "abriendo" }
  | { fase: "leyendo"; aviso?: string }
  | { fase: "buscando" }
  | { fase: "error"; mensaje: string };

/** Lo que lee el detector nativo (Chrome en Android); en el resto, zxing. */
type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const FORMATOS = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e"];

/** Para la cámara y el lector, sea cual sea. */
type Parar = () => void;

async function arrancarLector(video: HTMLVideoElement, onLeido: (texto: string) => void): Promise<Parar> {
  const Nativo = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector & { constructor: unknown } })
    .BarcodeDetector;
  const soportados: string[] = Nativo
    ? await (Nativo as unknown as { getSupportedFormats: () => Promise<string[]> }).getSupportedFormats().catch(() => [])
    : [];

  if (Nativo && soportados.includes("code_128") && soportados.includes("qr_code")) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = stream;
    await video.play();
    const detector = new Nativo({ formats: FORMATOS.filter((f) => soportados.includes(f)) });
    let activo = true;
    const ciclo = async () => {
      if (!activo) return;
      try {
        const [primero] = await detector.detect(video);
        if (primero?.rawValue && activo) onLeido(primero.rawValue);
      } catch {
        // Cuadro todavía sin datos: se reintenta en el próximo.
      }
      if (activo) setTimeout(ciclo, 150);
    };
    void ciclo();
    return () => {
      activo = false;
      stream.getTracks().forEach((t) => t.stop());
    };
  }

  // iOS (Safari no trae BarcodeDetector) y escritorio: zxing, que se baja recién al abrir el escáner.
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map<unknown, unknown>([
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ],
    ],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  const lector = new BrowserMultiFormatReader(hints as Map<never, never>, { delayBetweenScanAttempts: 150 });
  const controles = await lector.decodeFromConstraints(
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    video,
    (resultado) => {
      if (resultado) onLeido(resultado.getText());
    },
  );
  return () => controles.stop();
}

function mensajeDeError(err: unknown): string {
  const nombre = err instanceof DOMException ? err.name : "";
  if (nombre === "NotAllowedError" || nombre === "SecurityError")
    return "No se pudo acceder a la cámara. Habilite el permiso de cámara para este sitio en su navegador.";
  if (nombre === "NotFoundError" || nombre === "OverconstrainedError") return "No se encontró una cámara en este dispositivo.";
  if (nombre === "NotReadableError") return "La cámara está en uso por otra aplicación. Ciérrela e inténtelo de nuevo.";
  return "No se pudo abrir la cámara. Inténtelo de nuevo.";
}

/**
 * Escáner del buscador: abre la cámara trasera a pantalla completa y lee el código de barras o el
 * QR del producto (las etiquetas del local). El QR de la etiqueta lleva a la ficha; un código se
 * busca como código del producto (`/api/shop/codigo`) y, si no hay uno exacto, cae a la búsqueda
 * normal con ese texto.
 */
export function EscanerCodigo({ busquedaIa, onCerrar }: { busquedaIa: boolean; onCerrar: () => void }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<Estado>({ fase: "abriendo" });
  // El lector sigue mirando mientras se resuelve el código: uno solo por vez.
  const ocupado = useRef(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let parar: Parar | null = null;
    let cancelado = false;
    ocupado.current = false;

    const ir = (href: string) => {
      parar?.();
      onCerrar();
      router.push(href);
    };

    const onLeido = async (texto: string) => {
      if (ocupado.current || cancelado) return;
      const destino = destinoEscaneo(texto);
      if (destino.tipo === "invalido") {
        setEstado({ fase: "leyendo", aviso: "El código leído no corresponde a un producto de la tienda." });
        return;
      }
      ocupado.current = true;
      navigator.vibrate?.(60);
      if (destino.tipo === "producto") return ir(`/producto/${encodeURIComponent(destino.id)}`);
      setEstado({ fase: "buscando" });
      try {
        const res = await fetch(`/api/shop/codigo?c=${encodeURIComponent(destino.codigo)}`);
        const data: { id?: string | null } = res.ok ? await res.json() : {};
        if (cancelado) return;
        ir(data.id ? `/producto/${encodeURIComponent(data.id)}` : hrefBusqueda(destino.codigo, busquedaIa));
      } catch {
        if (!cancelado) ir(hrefBusqueda(destino.codigo, busquedaIa));
      }
    };

    arrancarLector(video, (t) => void onLeido(t))
      .then((p) => {
        if (cancelado) return p();
        parar = p;
        setEstado({ fase: "leyendo" });
      })
      .catch((err: unknown) => {
        if (!cancelado) setEstado({ fase: "error", mensaje: mensajeDeError(err) });
      });

    return () => {
      cancelado = true;
      parar?.();
    };
  }, [busquedaIa, intento, onCerrar, router]);

  // Escape cierra; sin scroll de la página de fondo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const antes = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = antes;
    };
  }, [onCerrar]);

  const texto =
    estado.fase === "error"
      ? estado.mensaje
      : estado.fase === "buscando"
        ? "Buscando el producto…"
        : estado.fase === "abriendo"
          ? "Abriendo la cámara…"
          : (estado.aviso ?? "Apunte la cámara al código de barras o al QR de la etiqueta.");

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Escanear código"
      className="fixed inset-0 z-[80] flex flex-col bg-black text-white motion-safe:animate-aparecer"
    >
      <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      {/* Visor: ancho para el código de barras; el QR también entra. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[38vw] max-h-56 w-[78vw] max-w-md rounded-xl border-2 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
      </div>
      <div className="relative flex justify-end p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-full bg-black/50 px-4 py-2 text-sm font-medium backdrop-blur"
        >
          Cerrar
        </button>
      </div>
      <div className="relative mt-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-center">
        <p role="status" aria-live="polite" className="mx-auto max-w-sm rounded-lg bg-black/55 px-4 py-3 text-sm backdrop-blur">
          {texto}
        </p>
        {estado.fase === "error" ? (
          <button
            type="button"
            onClick={() => {
              setEstado({ fase: "abriendo" });
              setIntento((i) => i + 1);
            }}
            className="mt-3 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
          >
            Reintentar
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
