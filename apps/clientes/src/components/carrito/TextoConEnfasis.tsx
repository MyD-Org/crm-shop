/**
 * Texto con un fragmento en énfasis semántico (<strong>), por ejemplo el monto que falta para una
 * meta del carrito. Sin `enfasis`, o si no aparece en el texto, se muestra tal cual.
 */
export function TextoConEnfasis({ texto, enfasis }: { texto: string; enfasis?: string }) {
  const i = enfasis ? texto.indexOf(enfasis) : -1;
  if (!enfasis || i < 0) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, i)}
      <strong>{enfasis}</strong>
      {texto.slice(i + enfasis.length)}
    </>
  );
}
