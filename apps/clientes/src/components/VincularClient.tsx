"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input } from "@myd-org/ui";
import { documentoEnLinea } from "@/lib/facturacion";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

type Paso = "documento" | "codigo" | "confirmar";

/** Título y bajada de la card: todo el flujo vive en una sola card. */
const TITULO = "Vincule su cuenta de cliente";
const BAJADA = "Vea sus facturas y sus compras en Central LED.";

export function VincularClient({
  volver,
  documentoSugerido = "",
  embebido = false,
  onVinculado,
}: {
  /** Ruta interna a la que volver al terminar (ej. "/checkout"). */
  volver?: string;
  /** Documento de facturación que ya coincide con un cliente: se precarga. */
  documentoSugerido?: string;
  /** Dentro de otra página (el checkout): sin card propia ni título. */
  embebido?: boolean;
  /** Vinculada: quien lo usa sigue en su página en vez de navegar a `volver`. */
  onVinculado?: () => void;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("documento");
  const [documento, setDocumento] = useState(documentoSugerido);
  const [codigo, setCodigo] = useState("");
  const [cuenta, setCuenta] = useState<{ razonSocial?: string; documento?: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function solicitar() {
    setCargando(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch("/api/vinculacion/solicitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "No pudimos enviarle el código.");
        return;
      }
      setPaso("codigo");
    } catch {
      setError("No pudimos conectarnos. Revise su conexión.");
    } finally {
      setCargando(false);
    }
  }

  /** Valida el código y muestra a qué cuenta se va a vincular, sin vincular todavía. */
  async function verificar() {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/vinculacion/verificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "No pudimos validar el código.");
        return;
      }
      setCuenta({ razonSocial: json.razonSocial, documento: json.documento });
      setPaso("confirmar");
    } catch {
      setError("No pudimos conectarnos. Revise su conexión.");
    } finally {
      setCargando(false);
    }
  }

  async function confirmar() {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/vinculacion/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "No pudimos vincular su cuenta.");
        setCargando(false);
        return;
      }
      if (onVinculado) {
        onVinculado();
        return;
      }
      // Directo a donde tiene sentido seguir (el checkout si venía de ahí; si
      // no, sus facturas) y refresco de los Server Components: el header y los
      // precios pasan a resolverse con la lista del cliente recién vinculado.
      router.replace(volver ?? RUTAS_MI_CUENTA.facturas);
      router.refresh();
    } catch {
      setError("No pudimos conectarnos. Revise su conexión.");
      setCargando(false);
    }
  }

  /** La cuenta no es la suya: se anula el código y no se vincula nada. */
  async function cancelar() {
    setCargando(true);
    setError(null);
    try {
      await fetch("/api/vinculacion/cancelar", { method: "POST" });
    } catch {
      // Aunque falle, el código vence solo en 10 minutos y no se vinculó nada.
    }
    setCodigo("");
    setCuenta(null);
    setPaso("documento");
    setAviso("No vinculamos ninguna cuenta. Si el documento es suyo pero los datos no coinciden, escríbanos.");
    setCargando(false);
  }

  const errorBox = error && (
    <p className="mt-4 rounded-lg bg-danger/5 p-3 text-sm text-danger">{error}</p>
  );

  /** Embebido, sin card: el título va como una línea en negrita. */
  const contenedor = (titulo: string, bajada: string | null, hijos: ReactNode) =>
    embebido ? (
      <div>
        {bajada && <p className="mb-4 text-sm text-muted">{bajada}</p>}
        {hijos}
      </div>
    ) : (
      <Card title={titulo} description={bajada ?? undefined}>
        {hijos}
      </Card>
    );

  if (paso === "confirmar") {
    return contenedor(
      "¿Es su cuenta?",
      "Confirme que es su cuenta de cliente antes de vincularla.",
      <>
        <p className="text-sm text-muted">
          Encontramos la cuenta de{" "}
          <span className="font-medium text-text">{cuenta?.razonSocial ?? "cliente"}</span>
          {cuenta?.documento ? ` (${documentoEnLinea(cuenta.documento)})` : ""}.
        </p>

        {errorBox}

        <div className="mt-5 flex items-center gap-4">
          <Button onClick={confirmar} disabled={cargando}>
            {cargando ? "Vinculando…" : "Sí, vincular"}
          </Button>
          <Button variant="secondary" onClick={cancelar} disabled={cargando}>
            No es mi cuenta
          </Button>
        </div>
      </>,
    );
  }

  // Embebido con el documento ya conocido: no se lo vuelve a pedir.
  const documentoFijo = embebido && Boolean(documentoSugerido);

  return contenedor(
    TITULO,
    embebido ? null : BAJADA,
    <>
      {aviso && <p className="mb-4 rounded-lg bg-elevated p-3 text-sm text-text">{aviso}</p>}
      {paso === "documento" && documentoFijo ? (
        <>
          <p className="text-sm text-muted">
            Le enviaremos un código al email registrado en su cuenta de cliente.
          </p>
          {errorBox}
          <Button className="mt-4" onClick={solicitar} disabled={cargando}>
            {cargando ? "Enviando…" : "Enviarme el código"}
          </Button>
        </>
      ) : paso === "documento" ? (
        <>
          {/*
            Quien llega hasta acá es porque el match automático por email no
            encontró su cuenta. Se acepta cualquier documento (CUIT, DNI, CPF,
            CNPJ, CI, RUC): el servidor lo busca en Alegra en todas sus formas.
          */}
          <div className="max-w-xs">
            <Field label="Documento" hint="Le enviaremos un código al email registrado en su cuenta.">
              <Input
                value={documento}
                onChange={(e) => setDocumento(e.target.value.slice(0, 20))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && documento.trim() && !cargando) solicitar();
                }}
                placeholder="CUIT, DNI, CPF, RUC…"
                autoComplete="off"
              />
            </Field>
          </div>

          {errorBox}

          <Button className="mt-5" onClick={solicitar} disabled={!documento.trim() || cargando}>
            {cargando ? "Buscando…" : "Enviarme el código"}
          </Button>
        </>
      ) : (
        <>
          {/*
            No se nombra la casilla a la que fue el código, ni siquiera
            enmascarada: decir "se lo mandamos a j***@empresa.com" confirma que
            ese documento es cliente nuestro, y un CUIT lo puede escribir
            cualquiera (es público). Ver el bloque de RESPUESTA UNIFORME en
            lib/vinculacion.ts.

            El costo es real: el cliente no sabe qué casilla abrir. Por eso la
            salida ("escríbanos") es parte del diseño, no un adorno — sin ella,
            quien tiene cargado un mail viejo queda sin camino.
          */}
          <p className="text-sm text-muted">
            Si el documento está registrado, le enviamos un código de 6 dígitos al email de su
            cuenta. Vence en 10 minutos. ¿No le llegó? Escríbanos.
          </p>

          <div className="mt-4 max-w-[12rem]">
            <Field label="Código">
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && codigo.length === 6 && !cargando) verificar();
                }}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="text-center text-lg font-bold tracking-[0.3em]"
              />
            </Field>
          </div>

          {errorBox}

          <div className="mt-5 flex items-center gap-4">
            <Button onClick={verificar} disabled={codigo.length !== 6 || cargando}>
              {cargando ? "Validando…" : "Continuar"}
            </Button>
            {!documentoFijo && (
            <Button
              variant="link"
              onClick={() => {
                setPaso("documento");
                setCodigo("");
                setError(null);
              }}
            >
              Usar otro documento
            </Button>
            )}
          </div>
        </>
      )}
    </>,
  );
}
