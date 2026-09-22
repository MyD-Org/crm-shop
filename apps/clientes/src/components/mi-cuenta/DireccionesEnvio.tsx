"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, Dialog, EmptyState } from "@myd-org/ui";
import type { DireccionPrellenada } from "@/lib/direccion-envio";
import {
  MAX_DIRECCIONES,
  avisoFueraDeZona,
  etiquetaDireccion,
  fueraDeZona,
  lineasDireccion,
  type CampoDireccion,
  type DireccionEnvio,
} from "@/lib/direcciones-envio";
import {
  FORMULARIO_VACIO,
  formularioDesde,
  interpretarRespuesta,
  ofrecerFacturacion,
  type FormularioDireccion,
  type RespuestaDirecciones,
} from "@/lib/direcciones-envio-cliente";
import { DireccionForm } from "./DireccionForm";

const API = "/api/mi-cuenta/direcciones";
const NUEVA = "nueva";

async function llamar(url: string, method: string, cuerpo?: unknown): Promise<RespuestaDirecciones> {
  try {
    const res = await fetch(url, {
      method,
      headers: cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // Sin cuerpo JSON: interpretarRespuesta usa el mensaje genérico.
    }
    return interpretarRespuesta(res.status, json);
  } catch {
    return { ok: false, error: "No pudimos conectarnos. Inténtelo de nuevo.", errores: {} };
  }
}

/**
 * Direcciones de envío guardadas (sólo con Clerk): lista, alta y edición en la
 * misma sección, predeterminada y borrado con confirmación. Cada respuesta de
 * la API trae la lista completa en el orden de la vista, y esa lista
 * reemplaza al estado local (no hay reconciliación a mano).
 */
export function DireccionesEnvio({
  iniciales,
  facturacion,
}: {
  iniciales: DireccionEnvio[];
  facturacion: DireccionPrellenada | null;
}) {
  const [direcciones, setDirecciones] = useState(iniciales);
  /** null = sin formulario abierto; NUEVA = alta; un id = edición de ésa. */
  const [editando, setEditando] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errores, setErrores] = useState<Partial<Record<CampoDireccion, string>>>({});
  /** Error de una acción sobre la lista (predeterminada o borrado). */
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<DireccionEnvio | null>(null);

  const lleno = direcciones.length >= MAX_DIRECCIONES;

  function abrir(id: string) {
    setEditando(id);
    setError(null);
    setErrores({});
    setErrorLista(null);
  }

  async function guardar(form: FormularioDireccion) {
    setGuardando(true);
    setError(null);
    setErrores({});
    const r =
      editando === NUEVA
        ? await llamar(API, "POST", form)
        : await llamar(`${API}/${editando}`, "PUT", form);
    setGuardando(false);
    if (r.ok) {
      setDirecciones(r.direcciones);
      setEditando(null);
    } else {
      setError(r.error);
      setErrores(r.errores);
    }
  }

  async function accion(id: string, url: string, method: string) {
    setOcupada(id);
    setErrorLista(null);
    const r = await llamar(url, method);
    setOcupada(null);
    if (r.ok) setDirecciones(r.direcciones);
    else setErrorLista(r.error);
    return r.ok;
  }

  async function confirmarBorrado() {
    if (!aBorrar) return;
    const ok = await accion(aBorrar.id, `${API}/${aBorrar.id}`, "DELETE");
    if (ok) {
      if (editando === aBorrar.id) setEditando(null);
      setABorrar(null);
    }
  }

  const formulario = (d: DireccionEnvio | null) => (
    <DireccionForm
      key={d?.id ?? NUEVA}
      titulo={d ? `Editar ${etiquetaDireccion(d)}` : "Nueva dirección"}
      inicial={d ? formularioDesde(d) : FORMULARIO_VACIO}
      facturacion={facturacion}
      ofrecerFacturacion={ofrecerFacturacion(facturacion, direcciones, d?.id ?? null)}
      esPredeterminada={Boolean(d?.predeterminada)}
      guardando={guardando}
      error={error}
      errores={errores}
      onGuardar={guardar}
      onCancelar={() => setEditando(null)}
    />
  );

  if (direcciones.length === 0 && editando === null) {
    return (
      <EmptyState
        title="Todavía no guardó direcciones de envío."
        description="Guárdelas aquí y elíjalas al finalizar cada compra."
        action={<Button onClick={() => abrir(NUEVA)}>Agregar dirección</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {errorLista && <Alert tone="danger">{errorLista}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        {direcciones.map((d) =>
          editando === d.id ? (
            formulario(d)
          ) : (
            <Card
              key={d.id}
              title={etiquetaDireccion(d)}
              action={d.predeterminada ? <Badge tone="info">Predeterminada</Badge> : undefined}
            >
              <div className="flex flex-col gap-3">
                <address className="text-sm not-italic text-text">
                  {lineasDireccion(d).map((l) => (
                    <span key={l} className="block">
                      {l}
                    </span>
                  ))}
                </address>
                {fueraDeZona(d) && <Alert tone="warning">{avisoFueraDeZona(d.ciudad)}</Alert>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => abrir(d.id)}>
                    Editar
                  </Button>
                  {!d.predeterminada && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={ocupada === d.id && aBorrar === null}
                      onClick={() => accion(d.id, `${API}/${d.id}/predeterminada`, "POST")}
                    >
                      Usar como predeterminada
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setABorrar(d)}>
                    Eliminar
                  </Button>
                </div>
              </div>
            </Card>
          ),
        )}
        {editando === NUEVA && formulario(null)}
      </div>

      {editando === null && (
        <div className="flex flex-col items-start gap-2">
          <Button variant="outline" onClick={() => abrir(NUEVA)} disabled={lleno}>
            Agregar dirección
          </Button>
          {lleno && (
            <p className="text-sm text-muted">
              Alcanzó el máximo de {MAX_DIRECCIONES} direcciones. Elimine una para agregar otra.
            </p>
          )}
        </div>
      )}

      <Dialog
        open={aBorrar !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setABorrar(null);
        }}
        title="¿Eliminar esta dirección?"
        description={
          aBorrar?.predeterminada && direcciones.length > 1
            ? "Es su dirección predeterminada: pasará a serlo la más reciente de las que quedan."
            : "Podrá volver a cargarla cuando quiera."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setABorrar(null)} disabled={ocupada !== null}>
              Cancelar
            </Button>
            <Button variant="danger" loading={ocupada !== null} onClick={confirmarBorrado}>
              Eliminar
            </Button>
          </>
        }
      >
        {aBorrar && (
          <address className="text-sm not-italic text-text">
            {lineasDireccion(aBorrar).map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </address>
        )}
      </Dialog>
    </div>
  );
}
