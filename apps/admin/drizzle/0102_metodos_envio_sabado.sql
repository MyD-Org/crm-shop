-- Método de envío por zona: permite entregar los sábados (ISO 6). El domingo (7) sigue sin poder elegirse.
-- Sólo cambia el CHECK de días operativos: los datos existentes ({1..5}) siguen cumpliéndolo.
ALTER TABLE "metodos_envio" DROP CONSTRAINT "metodos_envio_dias_chk";--> statement-breakpoint
ALTER TABLE "metodos_envio" ADD CONSTRAINT "metodos_envio_dias_chk" CHECK (cardinality("dias_operativos") > 0 AND "dias_operativos" <@ '{1,2,3,4,5,6}'::smallint[]);
