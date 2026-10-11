CREATE TYPE "public"."alert_type" AS ENUM('platform_change', 'cancellation', 'delay', 'predicted_disruption');--> statement-breakpoint
CREATE TYPE "public"."association_kind" AS ENUM('forms', 'join', 'divide');--> statement-breakpoint
CREATE TYPE "public"."call_activity" AS ENUM('origin', 'stop', 'pass', 'destination');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('none', 'claimed', 'paid', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."journey_source" AS ENUM('live', 'hsp', 'manual');--> statement-breakpoint
CREATE TYPE "public"."journey_status" AS ENUM('suggested', 'confirmed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."network_event_kind" AS ENUM('movement', 'cancellation', 'berth_step');--> statement-breakpoint
CREATE TYPE "public"."ticket_type" AS ENUM('single', 'return', 'season');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"commute_id" uuid,
	"service_id" uuid,
	"type" "alert_type" NOT NULL,
	"value" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"email_message_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_log_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "alert_settings" (
	"commute_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"types" "alert_type"[] DEFAULT '{platform_change,cancellation,delay,predicted_disruption}'::alert_type[] NOT NULL,
	"delay_threshold_min" integer DEFAULT 5 NOT NULL,
	"quiet_start" time,
	"quiet_end" time,
	"unsubscribe_token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_settings_unsubscribe_token_unique" UNIQUE("unsubscribe_token"),
	CONSTRAINT "alert_settings_threshold_range" CHECK ("alert_settings"."delay_threshold_min" between 1 and 240),
	CONSTRAINT "alert_settings_quiet_both_or_neither" CHECK (("alert_settings"."quiet_start" is null) = ("alert_settings"."quiet_end" is null))
);
--> statement-breakpoint
CREATE TABLE "associations" (
	"main_service_id" uuid NOT NULL,
	"assoc_service_id" uuid NOT NULL,
	"kind" "association_kind" NOT NULL,
	"tiploc" varchar(7) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "associations_main_service_id_assoc_service_id_kind_pk" PRIMARY KEY("main_service_id","assoc_service_id","kind")
);
--> statement-breakpoint
CREATE TABLE "commutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"home_crs" char(3) NOT NULL,
	"work_crs" char(3) NOT NULL,
	"outbound_start" time NOT NULL,
	"outbound_end" time NOT NULL,
	"return_start" time NOT NULL,
	"return_end" time NOT NULL,
	"active_days" smallint NOT NULL,
	"operator_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commutes_distinct_stations" CHECK ("commutes"."home_crs" <> "commutes"."work_crs"),
	CONSTRAINT "commutes_active_days_range" CHECK ("commutes"."active_days" between 1 and 127)
);
--> statement-breakpoint
CREATE TABLE "delay_repay_schemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"toc" char(2) NOT NULL,
	"name" text NOT NULL,
	"bands" jsonb NOT NULL,
	"claim_url" text,
	"notes" text,
	"verified_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delay_repay_schemes_toc_unique" UNIQUE("toc")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" text NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"affected_crs" text[] DEFAULT '{}'::text[] NOT NULL,
	"operator_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "incidents_feed_id_unique" UNIQUE("feed_id")
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"commute_id" uuid,
	"service_id" uuid,
	"travel_date" date NOT NULL,
	"origin_crs" char(3) NOT NULL,
	"dest_crs" char(3) NOT NULL,
	"toc" char(2) NOT NULL,
	"sched_dep" timestamp with time zone NOT NULL,
	"sched_arr" timestamp with time zone NOT NULL,
	"actual_arr" timestamp with time zone,
	"arrival_delay_min" integer,
	"dest_cancelled" boolean DEFAULT false NOT NULL,
	"status" "journey_status" DEFAULT 'suggested' NOT NULL,
	"ticket_type" "ticket_type" DEFAULT 'single' NOT NULL,
	"claim_status" "claim_status" DEFAULT 'none' NOT NULL,
	"source" "journey_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "network_event_kind" NOT NULL,
	"train_ref" text,
	"service_feed_id" text,
	"tiploc" varchar(7),
	"crs" char(3),
	"delay_min" integer,
	"reason" text,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"claim_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_calls" (
	"service_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"tiploc" varchar(7) NOT NULL,
	"crs" char(3),
	"activity" "call_activity" NOT NULL,
	"is_public" boolean NOT NULL,
	"sched_arr" timestamp with time zone,
	"sched_dep" timestamp with time zone,
	"fcst_arr" timestamp with time zone,
	"fcst_dep" timestamp with time zone,
	"actual_arr" timestamp with time zone,
	"actual_dep" timestamp with time zone,
	"platform" text,
	"platform_booked" text,
	"platform_confirmed" boolean DEFAULT false NOT NULL,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"delay_reason" text,
	CONSTRAINT "service_calls_service_id_seq_pk" PRIMARY KEY("service_id","seq")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" text NOT NULL,
	"uid" text NOT NULL,
	"ssd" date NOT NULL,
	"toc" char(2) NOT NULL,
	"headcode" text,
	"origin_tiploc" varchar(7),
	"dest_tiploc" varchar(7),
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"delay_reason" text,
	"last_feed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_feed_id_unique" UNIQUE("feed_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"crs" char(3) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"search_name" text NOT NULL,
	"lat" real,
	"lon" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tiplocs" (
	"tiploc" varchar(7) PRIMARY KEY NOT NULL,
	"crs" char(3),
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_log" ADD CONSTRAINT "alert_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_log" ADD CONSTRAINT "alert_log_commute_id_commutes_id_fk" FOREIGN KEY ("commute_id") REFERENCES "public"."commutes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_log" ADD CONSTRAINT "alert_log_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_settings" ADD CONSTRAINT "alert_settings_commute_id_commutes_id_fk" FOREIGN KEY ("commute_id") REFERENCES "public"."commutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "associations" ADD CONSTRAINT "associations_main_service_id_services_id_fk" FOREIGN KEY ("main_service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "associations" ADD CONSTRAINT "associations_assoc_service_id_services_id_fk" FOREIGN KEY ("assoc_service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commutes" ADD CONSTRAINT "commutes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commutes" ADD CONSTRAINT "commutes_home_crs_stations_crs_fk" FOREIGN KEY ("home_crs") REFERENCES "public"."stations"("crs") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commutes" ADD CONSTRAINT "commutes_work_crs_stations_crs_fk" FOREIGN KEY ("work_crs") REFERENCES "public"."stations"("crs") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_repay_schemes" ADD CONSTRAINT "delay_repay_schemes_toc_operators_code_fk" FOREIGN KEY ("toc") REFERENCES "public"."operators"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_commute_id_commutes_id_fk" FOREIGN KEY ("commute_id") REFERENCES "public"."commutes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_calls" ADD CONSTRAINT "service_calls_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiplocs" ADD CONSTRAINT "tiplocs_crs_stations_crs_fk" FOREIGN KEY ("crs") REFERENCES "public"."stations"("crs") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_log_user_time_idx" ON "alert_log" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "associations_assoc_idx" ON "associations" USING btree ("assoc_service_id");--> statement-breakpoint
CREATE INDEX "commutes_user_idx" ON "commutes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commutes_one_default_per_user" ON "commutes" USING btree ("user_id") WHERE "commutes"."is_default";--> statement-breakpoint
CREATE INDEX "incidents_affected_crs_idx" ON "incidents" USING gin ("affected_crs");--> statement-breakpoint
CREATE INDEX "journeys_user_date_idx" ON "journeys" USING btree ("user_id","travel_date");--> statement-breakpoint
CREATE UNIQUE INDEX "journeys_user_service_uniq" ON "journeys" USING btree ("user_id","service_id") WHERE "journeys"."service_id" is not null;--> statement-breakpoint
CREATE INDEX "network_events_crs_time_idx" ON "network_events" USING btree ("crs","observed_at");--> statement-breakpoint
CREATE INDEX "network_events_time_idx" ON "network_events" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "service_calls_crs_dep_idx" ON "service_calls" USING btree ("crs","sched_dep");--> statement-breakpoint
CREATE INDEX "service_calls_crs_arr_idx" ON "service_calls" USING btree ("crs","sched_arr");--> statement-breakpoint
CREATE INDEX "services_ssd_idx" ON "services" USING btree ("ssd");--> statement-breakpoint
CREATE INDEX "services_uid_ssd_idx" ON "services" USING btree ("uid","ssd");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stations_search_trgm_idx" ON "stations" USING gin ("search_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tiplocs_crs_idx" ON "tiplocs" USING btree ("crs");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE VIEW "public"."watched_crs" AS (select distinct crs as "crs" from (select home_crs as crs from commutes union select work_crs from commutes) as w);