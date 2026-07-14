ALTER TABLE "interacoes" ADD COLUMN "par_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_int_par" ON "interacoes" USING btree ("par_id");