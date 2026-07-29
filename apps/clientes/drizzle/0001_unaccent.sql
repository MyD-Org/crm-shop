-- Búsqueda insensible a tildes.
--
-- El shop es en español y el catálogo tiene texto acentuado ("Termomagnético",
-- "CÓNICO"). Con ILIKE pelado, buscar "termomagnetico" no encuentra nada. Antes
-- esto lo resolvía Alegra server-side; al pasar la búsqueda a nuestra DB pasó a
-- ser problema nuestro.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- `unaccent()` no es IMMUTABLE (depende del diccionario), así que Postgres no la
-- acepta en un índice de expresión. Este wrapper fija el diccionario y sí es
-- indexable, por si más adelante hace falta. Hoy, con ~2800 filas, el seq scan
-- sobra: no se crea el índice todavía.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;