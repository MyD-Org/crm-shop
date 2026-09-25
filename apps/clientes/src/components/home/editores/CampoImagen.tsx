"use client";

import { useState } from "react";
import { Alert, Field, FileDropZone, Input, Spinner } from "@myd-org/ui";
import { firmarSubidaImagenHome } from "@/lib/home-acciones";
import { generarVariantes, ImagenInvalida } from "../redimensionar";

const ERROR_SUBIDA = "No se pudo subir la imagen. Verifique la configuración de CORS del bucket e inténtelo de nuevo.";

/**
 * Campo de imagen del editor de la home: convierte el archivo elegido a una
 * variante webp de 1600 px en el navegador, pide una URL PUT prefirmada
 * (`firmarSubidaImagenHome`) y sube directo a R2. El valor NO se persiste
 * hasta que el Dialog hace "Guardar" — acá solo se actualiza el borrador.
 */
export function CampoImagen({
  valor,
  onChange,
  alt,
  onAltChange,
  label = "Imagen",
}: {
  valor: string;
  onChange: (url: string) => void;
  alt?: string;
  onAltChange?: (alt: string) => void;
  label?: string;
}) {
  const [previa, setPrevia] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subir(file: File | null) {
    if (!file) return;
    setError(null);
    setSubiendo(true);
    try {
      const variantes = await generarVariantes(file);
      const elegida = variantes.find((v) => v.ancho === 1600) ?? variantes[variantes.length - 1];

      const firma = await firmarSubidaImagenHome({ bytes: elegida.blob.size });
      if (!firma.ok) {
        setError(firma.errores.join(" "));
        return;
      }

      let res: Response;
      try {
        res = await fetch(firma.url, { method: "PUT", headers: firma.headers, body: elegida.blob });
      } catch {
        setError(ERROR_SUBIDA);
        return;
      }
      if (!res.ok) {
        setError(ERROR_SUBIDA);
        return;
      }

      setPrevia(URL.createObjectURL(elegida.blob));
      onChange(firma.urlPublica);
    } catch (e) {
      setError(e instanceof ImagenInvalida ? e.message : ERROR_SUBIDA);
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label={label}>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- previa local (blob:) o URL recién subida; next/image no aplica */}
          <img src={previa ?? valor} alt="" className="h-16 w-24 shrink-0 rounded-md object-cover" />
          <FileDropZone
            size="sm"
            className="min-w-0 flex-1"
            file={null}
            onChange={subir}
            accept="image/jpeg,image/png,image/webp,image/avif"
            title="Cambiar imagen"
            orLabel=""
            browseLabel="Arrastre o seleccione un archivo"
            hint="JPG, PNG, WEBP o AVIF de hasta 25 MB."
          />
          {subiendo ? <Spinner /> : null}
        </div>
      </Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {onAltChange ? (
        <Field label="Texto alternativo">
          <Input value={alt ?? ""} onChange={(e) => onAltChange(e.target.value)} />
        </Field>
      ) : null}
    </div>
  );
}
