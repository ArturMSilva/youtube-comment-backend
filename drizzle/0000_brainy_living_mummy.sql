CREATE TABLE "interacao_comentarios" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"interacao_id" uuid NOT NULL,
	"comentario_id" text NOT NULL,
	"texto" text NOT NULL,
	"like_count" integer NOT NULL,
	"posicao" smallint NOT NULL,
	"foi_fonte" boolean DEFAULT false NOT NULL,
	CONSTRAINT "uq_ic_interacao_posicao" UNIQUE("interacao_id","posicao")
);
--> statement-breakpoint
CREATE TABLE "interacoes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"video_id" text,
	"pergunta" text NOT NULL,
	"resposta" text NOT NULL,
	"metodo" text NOT NULL,
	"modelo_llm" text,
	"total_comentarios_recebidos" integer NOT NULL,
	"latencia_filtro_ms" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_int_metodo" CHECK ("interacoes"."metodo" IN ('keyword', 'semantic'))
);
--> statement-breakpoint
ALTER TABLE "interacao_comentarios" ADD CONSTRAINT "interacao_comentarios_interacao_id_interacoes_id_fk" FOREIGN KEY ("interacao_id") REFERENCES "public"."interacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ic_interacao" ON "interacao_comentarios" USING btree ("interacao_id");--> statement-breakpoint
CREATE INDEX "idx_int_video" ON "interacoes" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "idx_int_metodo" ON "interacoes" USING btree ("metodo");--> statement-breakpoint
CREATE INDEX "idx_int_criado_em" ON "interacoes" USING btree ("criado_em");