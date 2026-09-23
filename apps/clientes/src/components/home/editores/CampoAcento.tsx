"use client";

import { useEffect, useRef } from "react";
import { Button } from "@myd-org/ui";
import { aMarcas, aMascara, alternarAcento } from "@/lib/home-editor";

/**
 * Campo de una línea donde el acento se ve pintado (sin los `*` del
 * contrato). Se edita como texto; "Acento" pinta o despinta lo seleccionado.
 * `value`/`onChange` hablan el contrato con marcas (`Los más *vendidos*`).
 *
 * Es un `contentEditable` no controlado: el DOM solo se repinta cuando
 * `value` cambia desde afuera, para no mover el cursor mientras se escribe.
 */
export function CampoAcento({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ultimo = useRef<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || value === ultimo.current) return;
    pintar(el, value);
    ultimo.current = value;
  }, [value]);

  function emitir(marcado: string) {
    ultimo.current = marcado;
    onChange(marcado);
  }

  function alternar() {
    const el = ref.current;
    if (!el) return;
    const sel = seleccion(el);
    const r = sel && alternarAcento(ultimo.current ?? value, sel.desde, sel.hasta);
    if (!sel || r === null) {
      el.focus();
      return;
    }
    pintar(el, r);
    emitir(r);
    seleccionar(el, sel.desde, sel.hasta);
  }

  return (
    <div className="flex gap-2">
      <div
        ref={ref}
        role="textbox"
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        className="min-h-[38px] w-full whitespace-pre-wrap rounded-sm border-[1.5px] border-border-strong bg-surface px-3 py-2 text-sm text-text transition-[border-color] duration-150 focus-visible:border-primary focus-visible:outline-none [&_em]:font-semibold [&_em]:not-italic [&_em]:text-accent"
        onInput={(e) => emitir(leer(e.currentTarget))}
        onKeyDown={(e) => {
          // Una sola línea y sin negrita/itálica del navegador.
          if (e.key === "Enter") e.preventDefault();
          if ((e.metaKey || e.ctrlKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) e.preventDefault();
        }}
        onPaste={(e) => {
          e.preventDefault();
          const texto = e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " ");
          document.execCommand("insertText", false, texto);
        }}
      />
      <Button
        type="button"
        variant="outline"
        title="Seleccione palabras y toque para pintarlas (o despintarlas) en color acento"
        // Sin esto el botón le saca el foco (y la selección) al campo.
        onMouseDown={(e) => e.preventDefault()}
        onClick={alternar}
      >
        Acento
      </Button>
    </div>
  );
}

function pintar(el: HTMLElement, marcado: string) {
  const { texto, acento } = aMascara(marcado);
  const nodos: Node[] = [];
  let i = 0;
  while (i < texto.length) {
    let j = i;
    while (j < texto.length && acento[j] === acento[i]) j++;
    const trozo = document.createTextNode(texto.slice(i, j));
    if (acento[i]) {
      const em = document.createElement("em");
      em.appendChild(trozo);
      nodos.push(em);
    } else {
      nodos.push(trozo);
    }
    i = j;
  }
  el.replaceChildren(...nodos);
}

/** El DOM editado de vuelta al contrato: lo que está dentro de un <em> es acento. */
function leer(el: HTMLElement): string {
  let texto = "";
  const acento: boolean[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const trozo = (n.textContent ?? "").replace(/\n/g, " ");
    const enAcento = n.parentElement?.closest("em");
    texto += trozo;
    acento.push(...Array<boolean>(trozo.length).fill(!!enAcento && el.contains(enAcento)));
  }
  return aMarcas({ texto, acento });
}

/** Selección actual como offsets sobre el texto plano del campo. */
function seleccion(el: HTMLElement): { desde: number; hasta: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const offset = (nodo: Node, off: number) => {
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(nodo, off);
    return pre.toString().length;
  };
  return { desde: offset(r.startContainer, r.startOffset), hasta: offset(r.endContainer, r.endOffset) };
}

function seleccionar(el: HTMLElement, desde: number, hasta: number) {
  const punto = (objetivo: number): [Node, number] => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let resto = objetivo;
    let ultimo: Node | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const largo = n.textContent?.length ?? 0;
      if (resto <= largo) return [n, resto];
      resto -= largo;
      ultimo = n;
    }
    return ultimo ? [ultimo, ultimo.textContent?.length ?? 0] : [el, 0];
  };
  const r = document.createRange();
  r.setStart(...punto(desde));
  r.setEnd(...punto(hasta));
  el.focus();
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}
