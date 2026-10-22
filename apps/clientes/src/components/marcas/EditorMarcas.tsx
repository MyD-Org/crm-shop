"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Field, Input, SegmentedControl, useToast } from "@myd-org/ui";
import {
  borrarPaginaMarca,
  crearPaginaMarca,
  guardarDatosMarca,
  moverPaginaMarca,
  type ResultadoMarca,
} from "@/lib/marcas/marcas-acciones";
import { hrefMarca, slugDeNombre, type NivelMarca, type PaginaMarca } from "@/lib/marcas/pagina-marca";
import { SelectorValoresMarca } from "./SelectorValoresMarca";

const NIVELES = [
  { value: "oficial", label: "Tienda oficial" },
  { value: "marca", label: "Página de marca" },
];

/**
 * Lista de páginas de marca (crear, ordenar, publicar, borrar). Tras cada
 * acción se refresca la ruta: las acciones ya invalidan el tag `home`.
 */
export function EditorMarcas({ paginas }: { paginas: PaginaMarca[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [errores, setErrores] = useState<string[]>([]);
  const [borrando, setBorrando] = useState<string | null>(null);

  function correr(accion: () => Promise<ResultadoMarca>, ok: string) {
    startTransition(async () => {
      const r = await accion();
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      setErrores([]);
      toast({ title: ok, tone: "success" });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {errores.length > 0 ? (
        <Alert tone="danger" title="No se pudo completar la acción">
          <ul className="list-disc pl-5">
            {errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {paginas.length === 0 ? (
        <p className="text-base text-muted">Todavía no hay páginas de marca.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {paginas.map((p, i) => (
            <li
              key={p.slug}
              className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <span className="text-base font-medium text-text">{p.nombre}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={p.nivel === "oficial" ? "info" : "neutral"}>
                    {p.nivel === "oficial" ? "Tienda oficial" : "Página de marca"}
                  </Badge>
                  <Badge tone={p.publicada ? "success" : "neutral"}>{p.publicada ? "Publicada" : "Oculta"}</Badge>
                  <span className="text-sm text-muted">{hrefMarca(p.slug)}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={hrefMarca(p.slug)}
                  className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  Ver página
                </a>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    correr(
                      () => guardarDatosMarca(p.slug, { publicada: !p.publicada }),
                      p.publicada ? "Página oculta" : "Página publicada",
                    )
                  }
                >
                  {p.publicada ? "Ocultar" : "Publicar"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending || i === 0}
                  aria-label={`Subir ${p.nombre}`}
                  onClick={() => correr(() => moverPaginaMarca(p.slug, "arriba"), "Orden actualizado")}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending || i === paginas.length - 1}
                  aria-label={`Bajar ${p.nombre}`}
                  onClick={() => correr(() => moverPaginaMarca(p.slug, "abajo"), "Orden actualizado")}
                >
                  ↓
                </Button>
                {borrando === p.slug ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      onClick={() => {
                        setBorrando(null);
                        correr(() => borrarPaginaMarca(p.slug), "Página borrada");
                      }}
                    >
                      Confirmar borrado
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setBorrando(null)}>
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setBorrando(p.slug)}>
                    Borrar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <NuevaPagina pending={pending} onCrear={(datos) => correr(() => crearPaginaMarca(datos), "Página creada")} />
    </div>
  );
}

function NuevaPagina({
  pending,
  onCrear,
}: {
  pending: boolean;
  onCrear: (datos: { nombre: string; slug: string; nivel: NivelMarca; marcasCatalogo: string[] }) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [nivel, setNivel] = useState<NivelMarca>("marca");
  const [marcasCatalogo, setMarcasCatalogo] = useState<string[]>([]);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <h2 className="font-display text-xl font-medium text-text">Nueva página</h2>
      <Field label="Nombre de la marca">
        <Input
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            if (!slugTocado) setSlug(slugDeNombre(e.target.value));
          }}
        />
      </Field>
      <Field label="Dirección" hint={`La página queda en /marcas/${slug || "…"}`}>
        <Input
          value={slug}
          onChange={(e) => {
            setSlugTocado(true);
            setSlug(e.target.value);
          }}
        />
      </Field>
      <Field label="Tipo de página">
        <SegmentedControl
          size="sm"
          ariaLabel="Tipo de página"
          options={NIVELES}
          value={nivel}
          onValueChange={(v) => setNivel(v as NivelMarca)}
        />
      </Field>
      <Field label="Marcas del catálogo" hint="Elija cómo figura esta marca en el catálogo. Si aparece escrita de varias formas, elija todas.">
        <SelectorValoresMarca elegidos={marcasCatalogo} onChange={setMarcasCatalogo} />
      </Field>
      <div>
        <Button type="button" loading={pending} onClick={() => onCrear({ nombre, slug, nivel, marcasCatalogo })}>
          Crear página
        </Button>
      </div>
    </section>
  );
}
