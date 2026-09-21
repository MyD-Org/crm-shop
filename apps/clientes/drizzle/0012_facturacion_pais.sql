-- País del documento de facturación. Define qué documentos se aceptan (AR: CUIT/DNI,
-- BR: CNPJ/CPF, PY: RUC/CI) y si se ofrece envío (solo Argentina).
--
-- DEFAULT 'AR': todos los perfiles cargados hasta hoy son argentinos, porque no había otra opción.
--
-- Escrita a mano a partir de lo que generó drizzle-kit: como la 0011 no dejó snapshot, el generador
-- volvía a emitir sus CREATE TABLE acá y la migración habría fallado con "already exists". El
-- snapshot 0012 sí quedó completo, así que la próxima generación sale limpia.
ALTER TABLE "billing_profiles" ADD COLUMN IF NOT EXISTS "pais" text DEFAULT 'AR' NOT NULL;
