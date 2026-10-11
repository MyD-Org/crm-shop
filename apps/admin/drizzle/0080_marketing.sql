-- Plataforma de marketing, iteración 1 (spec platform 2026-10-11-plataforma-marketing-design).
--
-- Cada pieza de contenido es una fila con estado; el studio, la rutina y ai-api la toman por
-- la API interna /api/internal/marketing/*. Ningún rol del Shop lee estas tablas (sin GRANT).
--
-- Drift sólo en SQL: los CHECK de los "enums" de texto (drizzle-kit no los conoce) y el
-- bloque final de REVOKE condicional sobre shop_app (cinturón; ver el final del archivo).
--
-- Reversa (en una migración nueva, SOLO después de revertir el código que las usa):
--   DROP TABLE marketing_interacciones, marketing_metricas, marketing_musica,
--     marketing_solicitudes, marketing_material, marketing_pieza_eventos, marketing_piezas,
--     marketing_campanas, marketing_marca;
CREATE TABLE "marketing_marca" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "voz" text DEFAULT '' NOT NULL,
  "reglas" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "paleta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "tipografias" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "logo_key" text,
  "hashtags_base" text[] DEFAULT '{}'::text[] NOT NULL,
  "horarios_preferidos" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "plantillas_habilitadas" text[] DEFAULT '{}'::text[] NOT NULL,
  "reparto" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "politica_comentarios" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketing_marca_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_marca_tenant_uniq" ON "marketing_marca" ("tenant_id");
--> statement-breakpoint
CREATE TABLE "marketing_campanas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "nombre" text NOT NULL,
  "objetivo" text DEFAULT '' NOT NULL,
  "desde" date,
  "hasta" date,
  "sucursal_id" uuid,
  "estado" text DEFAULT 'activa' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketing_campanas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
  CONSTRAINT "marketing_campanas_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id"),
  CONSTRAINT "marketing_campanas_estado_check" CHECK ("estado" IN ('activa','pausada','cerrada'))
);
--> statement-breakpoint
CREATE TABLE "marketing_musica" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "archivo_key" text NOT NULL,
  "titulo" text NOT NULL,
  "autor" text DEFAULT '' NOT NULL,
  "licencia" text DEFAULT '' NOT NULL,
  "content_id" boolean DEFAULT false NOT NULL,
  "bpm" numeric(6,2) NOT NULL,
  "drop_seg" numeric(7,3) DEFAULT 0 NOT NULL,
  "duracion_seg" numeric(7,2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketing_musica_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
);
--> statement-breakpoint
CREATE TABLE "marketing_piezas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "campana_id" uuid,
  "canal" text NOT NULL,
  "formato" text NOT NULL,
  "plantilla" text NOT NULL,
  "contenido" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "caption" text DEFAULT '' NOT NULL,
  "hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
  "productos" text[] DEFAULT '{}'::text[] NOT NULL,
  "musica_id" uuid,
  "sucursal_id" uuid,
  "publico" text NOT NULL,
  "tema" text NOT NULL,
  "objetivo" text NOT NULL,
  "produccion" text NOT NULL,
  "brief_grabacion" jsonb,
  "programada_para" timestamp with time zone,
  "estado" text DEFAULT 'borrador' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "render_key" text,
  "portada_key" text,
  "alertas" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "chequeo_ia" boolean DEFAULT false NOT NULL,
  "claim_por" text,
  "claim_hasta" timestamp with time zone,
  "origen" text DEFAULT 'usuario' NOT NULL,
  "externo_id" text,
  "permalink" text,
  "publicada_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketing_piezas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
  CONSTRAINT "marketing_piezas_campana_id_marketing_campanas_id_fk" FOREIGN KEY ("campana_id") REFERENCES "marketing_campanas"("id"),
  CONSTRAINT "marketing_piezas_musica_id_marketing_musica_id_fk" FOREIGN KEY ("musica_id") REFERENCES "marketing_musica"("id"),
  CONSTRAINT "marketing_piezas_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id"),
  CONSTRAINT "marketing_piezas_canal_check" CHECK ("canal" IN ('instagram','google_business')),
  CONSTRAINT "marketing_piezas_formato_check" CHECK ("formato" IN ('reel','carrusel','story','post','novedad_google')),
  CONSTRAINT "marketing_piezas_publico_check" CHECK ("publico" IN ('profesional','consumidor','ambos')),
  CONSTRAINT "marketing_piezas_tema_check" CHECK ("tema" IN ('tecnico','inspiracion','producto','precio_promo','marca_comunidad')),
  CONSTRAINT "marketing_piezas_objetivo_check" CHECK ("objetivo" IN ('alcance','local','consulta')),
  CONSTRAINT "marketing_piezas_produccion_check" CHECK ("produccion" IN ('auto','semi','grabado')),
  CONSTRAINT "marketing_piezas_origen_check" CHECK ("origen" IN ('planificador','usuario')),
  CONSTRAINT "marketing_piezas_estado_check" CHECK ("estado" IN ('esperando_material','borrador','renderizando','para_revisar','cambios_pedidos','aprobada','programada','publicada','fallida','descartada'))
);
--> statement-breakpoint
CREATE INDEX "marketing_piezas_tenant_estado_idx" ON "marketing_piezas" ("tenant_id","estado");
--> statement-breakpoint
CREATE INDEX "marketing_piezas_tenant_programada_idx" ON "marketing_piezas" ("tenant_id","programada_para");
--> statement-breakpoint
CREATE TABLE "marketing_pieza_eventos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "pieza_id" uuid NOT NULL,
  "de" text,
  "a" text NOT NULL,
  "actor" text NOT NULL,
  "nota" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketing_pieza_eventos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
  CONSTRAINT "marketing_pieza_eventos_pieza_id_marketing_piezas_id_fk" FOREIGN KEY ("pieza_id") REFERENCES "marketing_piezas"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "marketing_pieza_eventos_pieza_idx" ON "marketing_pieza_eventos" ("pieza_id","created_at");
--> statement-breakpoint
CREATE TABLE "marketing_material" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "pieza_id" uuid,
  "archivo_key" text NOT NULL,
  "tipo" text NOT NULL,
  "content_type" text NOT NULL,
  "bytes" integer NOT NULL,
  "duracion_seg" numeric(7,2),
  "etiquetas" text[] DEFAULT '{}'::text[] NOT NULL,
  "subido_por" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketing_material_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
  CONSTRAINT "marketing_material_pieza_id_marketing_piezas_id_fk" FOREIGN KEY ("pieza_id") REFERENCES "marketing_piezas"("id") ON DELETE SET NULL,
  CONSTRAINT "marketing_material_tipo_check" CHECK ("tipo" IN ('video','foto'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_material_key_uniq" ON "marketing_material" ("archivo_key");
--> statement-breakpoint
CREATE TABLE "marketing_solicitudes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "tipo" text NOT NULL,
  "pieza_id" uuid,
  "nota" text DEFAULT '' NOT NULL,
  "estado" text DEFAULT 'pendiente' NOT NULL,
  "resultado" text DEFAULT '' NOT NULL,
  "resuelta_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketing_solicitudes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
  CONSTRAINT "marketing_solicitudes_pieza_id_marketing_piezas_id_fk" FOREIGN KEY ("pieza_id") REFERENCES "marketing_piezas"("id") ON DELETE CASCADE,
  CONSTRAINT "marketing_solicitudes_tipo_check" CHECK ("tipo" IN ('plan_semana','cambios','ajuste_reparto')),
  CONSTRAINT "marketing_solicitudes_estado_check" CHECK ("estado" IN ('pendiente','resuelta','fallida'))
);
--> statement-breakpoint
CREATE INDEX "marketing_solicitudes_tenant_estado_idx" ON "marketing_solicitudes" ("tenant_id","estado");
--> statement-breakpoint
CREATE TABLE "marketing_metricas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "ambito" text NOT NULL,
  "ref_id" text NOT NULL,
  "fecha" date NOT NULL,
  "metricas" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketing_metricas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
  CONSTRAINT "marketing_metricas_ambito_check" CHECK ("ambito" IN ('pieza','cuenta_ig','ficha_google'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_metricas_uniq" ON "marketing_metricas" ("tenant_id","ambito","ref_id","fecha");
--> statement-breakpoint
CREATE TABLE "marketing_interacciones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "origen" text NOT NULL,
  "externo_id" text NOT NULL,
  "pieza_id" uuid,
  "autor" text DEFAULT '' NOT NULL,
  "texto" text NOT NULL,
  "categoria" text NOT NULL,
  "sentimiento" text DEFAULT 'neutro' NOT NULL,
  "respuesta_sugerida" text DEFAULT '' NOT NULL,
  "respuesta_final" text,
  "estado" text DEFAULT 'pendiente' NOT NULL,
  "conversacion_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketing_interacciones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
  CONSTRAINT "marketing_interacciones_pieza_id_marketing_piezas_id_fk" FOREIGN KEY ("pieza_id") REFERENCES "marketing_piezas"("id") ON DELETE SET NULL,
  CONSTRAINT "marketing_interacciones_origen_check" CHECK ("origen" IN ('comentario','dm','mencion','resena_google')),
  CONSTRAINT "marketing_interacciones_categoria_check" CHECK ("categoria" IN ('consulta','asesoramiento','elogio','queja','spam','otro')),
  CONSTRAINT "marketing_interacciones_sentimiento_check" CHECK ("sentimiento" IN ('positivo','neutro','negativo')),
  CONSTRAINT "marketing_interacciones_estado_check" CHECK ("estado" IN ('pendiente','aprobada','respondida','derivada','oculta','ignorada'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_interacciones_externo_uniq" ON "marketing_interacciones" ("tenant_id","origen","externo_id");
--> statement-breakpoint
CREATE INDEX "marketing_interacciones_tenant_estado_idx" ON "marketing_interacciones" ("tenant_id","estado");
--> statement-breakpoint
-- REVOKE condicional: ningún rol del Shop lee estas tablas. Es un cinturón por si algún
-- DEFAULT PRIVILEGES del esquema public le diera algo a shop_app al crearlas (mismo patrón que
-- contactos_acceso_facturacion en 0039). Si el rol se crea DESPUÉS de esta migración, correr
-- este bloque a mano como owner.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    REVOKE ALL ON "public"."marketing_marca" FROM shop_app;
    REVOKE ALL ON "public"."marketing_campanas" FROM shop_app;
    REVOKE ALL ON "public"."marketing_musica" FROM shop_app;
    REVOKE ALL ON "public"."marketing_piezas" FROM shop_app;
    REVOKE ALL ON "public"."marketing_pieza_eventos" FROM shop_app;
    REVOKE ALL ON "public"."marketing_material" FROM shop_app;
    REVOKE ALL ON "public"."marketing_solicitudes" FROM shop_app;
    REVOKE ALL ON "public"."marketing_metricas" FROM shop_app;
    REVOKE ALL ON "public"."marketing_interacciones" FROM shop_app;
  END IF;
END $$;
