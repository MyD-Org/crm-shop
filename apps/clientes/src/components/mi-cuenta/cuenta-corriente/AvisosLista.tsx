"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, EmptyState, useToast } from "@myd-org/ui";
import { describirAviso, textoNoLeidos, type Aviso } from "@/lib/cuenta-corriente/vista-avisos";
import { IconoCampana, IconoFlecha } from "../iconos";

/**
 * Avisos de vencimiento (ex campana del portal, AVI-1..3): del más reciente al
 * más viejo, con los no leídos marcados. Abrir un aviso lo marca como leído y
 * navega a su destino (la factura o Condiciones); "Marcar todos como leídos"
 * marca el resto. Después de marcar se refresca la ruta para que el contador
 * del menú (lo pinta el layout) quede al día.
 */
export function AvisosLista({ avisos: iniciales, esCuentaCorriente }: { avisos: Aviso[]; esCuentaCorriente: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [avisos, setAvisos] = useState(iniciales);
  const [marcando, setMarcando] = useState(false);
  const noLeidos = avisos.filter((a) => !a.leido).length;

  /** Optimista: la lista cambia al instante; si falla, vuelve atrás y avisa. */
  async function marcar(ids?: string[]): Promise<boolean> {
    const antes = avisos;
    setAvisos((prev) => prev.map((a) => (!ids || a.ids.some((id) => ids.includes(id)) ? { ...a, leido: true } : a)));
    try {
      const res = await fetch("/api/mi-cuenta/avisos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
      return true;
    } catch {
      setAvisos(antes);
      toast({
        tone: "danger",
        title: "No pudimos marcar sus avisos como leídos",
        description: "Inténtelo de nuevo en unos minutos.",
      });
      return false;
    }
  }

  async function marcarTodos() {
    setMarcando(true);
    await marcar();
    setMarcando(false);
  }

  async function abrir(aviso: Aviso, href: string) {
    // Si no se pudo marcar, igual se navega: el aviso queda sin leer.
    if (!aviso.leido) await marcar(aviso.ids);
    router.push(href);
  }

  if (avisos.length === 0) {
    return (
      <EmptyState
        icon={<IconoCampana size={28} />}
        title="No tiene avisos."
        description="Cuando una factura esté por vencer o venza, se lo avisaremos acá."
      />
    );
  }

  return (
    <section aria-label="Avisos" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{noLeidos > 0 ? textoNoLeidos(noLeidos) : "Leyó todos sus avisos."}</p>
        {noLeidos > 0 && (
          <Button variant="outline" size="sm" loading={marcando} onClick={() => void marcarTodos()}>
            Marcar todos como leídos
          </Button>
        )}
      </div>

      <Card className="p-0">
        <ul className="flex flex-col divide-y divide-border">
          {avisos.map((aviso) => {
            const d = describirAviso(aviso, esCuentaCorriente);
            return (
              <li key={aviso.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={d.tono}>{d.etiqueta}</Badge>
                    {!aviso.leido && <Badge tone="info">Nuevo</Badge>}
                  </div>
                  <p className={aviso.leido ? "text-sm text-text" : "text-sm font-medium text-text"}>{d.titulo}</p>
                  <p className="text-sm text-muted">{d.detalle}</p>
                  <p className="text-xs text-muted">{aviso.fecha}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {d.destino ? (
                    <Button variant="outline" size="sm" onClick={() => void abrir(aviso, d.destino!.href)}>
                      {d.destino.label} <IconoFlecha />
                    </Button>
                  ) : (
                    !aviso.leido && (
                      <Button variant="ghost" size="sm" onClick={() => void marcar(aviso.ids)}>
                        Marcar como leído
                      </Button>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
