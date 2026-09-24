"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Field, Input } from "@myd-org/ui";

type Paso = "documento" | "codigo" | "listo";

/** Título y bajada de la card: todo el flujo vive en una sola card. */
const TITULO = "Vincule su cuenta de cliente";
const BAJADA = "Vea sus precios y su cuenta corriente. Si no es cliente, puede comprar a precio de lista.";

export function VincularClient({
  volver,
  documentoSugerido = "",
}: {
  /** Ruta interna a la que volver al terminar (ej. "/checkout"). */
  volver?: string;
  /** Documento de facturación que ya coincide con un cliente: se precarga. */
  documentoSugerido?: string;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("documento");
  const [documento, setDocumento] = useState(documentoSugerido);
  const [codigo, setCodigo] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function solicitar() {
    setCargando(true);
    setError(null);
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
        setError(json?.error ?? "No pudimos validar el código.");
        return;
      }
      setRazonSocial(json.razonSocial ?? "");
      setPaso("listo");
      // Refresca los Server Components: el header y los precios pasan a
      // resolverse con la lista del cliente recién vinculado.
      router.refresh();
    } catch {
      setError("No pudimos conectarnos. Revise su conexión.");
    } finally {
      setCargando(false);
    }
  }

  if (paso === "listo") {
    return (
      <Card title="¡Cuenta vinculada!">
        <p className="text-sm text-muted">
          {razonSocial ? (
            <>
              Su usuario quedó asociado a{" "}
              <span className="font-medium text-text">{razonSocial}</span>.{" "}
            </>
          ) : null}
          Desde ahora verá sus precios y su cuenta corriente.
        </p>
        <div className="mt-5 flex gap-3">
          {volver === "/checkout" ? (
            <Link href="/checkout">
              <Button>Volver a su pedido</Button>
            </Link>
          ) : (
            <Link href={volver ?? "/catalogo"}>
              <Button>{volver ? "Continuar" : "Ver catálogo"}</Button>
            </Link>
          )}
          <Link href="/mi-cuenta">
            <Button variant="secondary">Mi cuenta</Button>
          </Link>
        </div>
      </Card>
    );
  }

  const errorBox = error && (
    <p className="mt-4 rounded-lg bg-danger/5 p-3 text-sm text-danger">{error}</p>
  );

  return (
    <Card title={TITULO} description={BAJADA}>
      {paso === "documento" ? (
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
                  if (e.key === "Enter" && codigo.length === 6 && !cargando) confirmar();
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
            <Button onClick={confirmar} disabled={codigo.length !== 6 || cargando}>
              {cargando ? "Validando…" : "Vincular cuenta"}
            </Button>
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
          </div>
        </>
      )}
    </Card>
  );
}
