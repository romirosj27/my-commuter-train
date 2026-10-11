CREATE TABLE "associations" (
	"main_feed_id" text NOT NULL,
	"assoc_feed_id" text NOT NULL,
	"kind" "association_kind" NOT NULL,
	"tiploc" varchar(7) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "associations_main_feed_id_assoc_feed_id_kind_pk" PRIMARY KEY("main_feed_id","assoc_feed_id","kind")
);
--> statement-breakpoint
CREATE INDEX "associations_assoc_idx" ON "associations" USING btree ("assoc_feed_id");