"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Field, Input } from "@myd-org/ui";

type Paso = "cuit" | "codigo" | "listo";

export function VincularClient() {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("cuit");
  const [cuit, setCuit] = useState("");
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
        body: JSON.stringify({ cuit }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "No pudimos enviarte el código.");
        return;
      }
      setPaso("codigo");
    } catch {
      setError("No pudimos conectarnos. Revisá tu conexión.");
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
      setError("No pudimos conectarnos. Revisá tu conexión.");
    } finally {
      setCargando(false);
    }
  }

  if (paso === "listo") {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <h2 className="text-xl font-extrabold text-text">¡Cuenta vinculada!</h2>
        <p className="mt-2 text-sm text-muted">
          {razonSocial ? (
            <>
              Tu usuario quedó asociado a{" "}
              <span className="font-semibold text-text">{razonSocial}</span>.{" "}
            </>
          ) : null}
          Desde ahora vas a ver tus precios y tu cuenta corriente.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/catalogo">
            <Button>Ver catálogo</Button>
          </Link>
          <Link href="/mi-cuenta">
            <Button variant="secondary">Mi cuenta</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      {paso === "cuit" ? (
        <>
          <h2 className="text-base font-bold text-text">Paso 1 · Identificate</h2>
          {/*
            Quien llega hasta acá es porque el match automático por email no
            encontró su cuenta: entró con un mail distinto al que tenemos
            cargado. Conviene decírselo, si no parece un trámite arbitrario.
          */}
          <p className="mt-1 text-sm text-muted">
            No encontramos tu cuenta con el email con el que entraste, así que
            vamos por el camino largo: ingresá tu CUIT y te mandamos un código
            al email que tenemos registrado.
          </p>

          <div className="mt-5 max-w-xs">
            <Field label="CUIT">
              <Input
                value={cuit}
                onChange={(e) => setCuit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && cuit.trim() && !cargando) solicitar();
                }}
                placeholder="30-71234567-8"
                inputMode="numeric"
                autoComplete="off"
              />
            </Field>
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-danger/5 p-3 text-sm text-danger">{error}</p>
          )}

          <Button
            className="mt-5"
            onClick={solicitar}
            disabled={!cuit.trim() || cargando}
          >
            {cargando ? "Buscando…" : "Enviarme el código"}
          </Button>
        </>
      ) : (
        <>
          <h2 className="text-base font-bold text-text">Paso 2 · Ingresá el código</h2>
          {/*
            No se nombra la casilla a la que fue el código, ni siquiera
            enmascarada: decir "te lo mandamos a j***@empresa.com" confirma que
            ese CUIT es cliente nuestro, y el CUIT lo puede escribir cualquiera
            (es público). Ver el bloque de RESPUESTA UNIFORME en
            lib/vinculacion.ts.

            El costo es real: el cliente no sabe qué casilla abrir. Por eso la
            salida de abajo es parte del diseño, no un adorno — sin ella, quien
            tiene cargado un mail viejo queda sin camino.
          */}
          <p className="mt-1 text-sm text-muted">
            Si ese CUIT está registrado, te mandamos un código de 6 dígitos al
            email que tenemos cargado en tu cuenta. Vence en 10 minutos.
          </p>
          <p className="mt-2 text-sm text-muted">
            ¿No te llegó? Puede que tengamos otro email cargado, o que la cuenta
            todavía no esté registrada. Escribinos y lo resolvemos.
          </p>

          <div className="mt-5 max-w-[12rem]">
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

          {error && (
            <p className="mt-4 rounded-lg bg-danger/5 p-3 text-sm text-danger">{error}</p>
          )}

          <div className="mt-5 flex items-center gap-4">
            <Button onClick={confirmar} disabled={codigo.length !== 6 || cargando}>
              {cargando ? "Validando…" : "Vincular cuenta"}
            </Button>
            <button
              onClick={() => {
                setPaso("cuit");
                setCodigo("");
                setError(null);
              }}
              className="text-sm text-primary hover:underline"
            >
              Usar otro CUIT
            </button>
          </div>
        </>
      )}
    </div>
  );
}
