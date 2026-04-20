CREATE TABLE "operator_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"model_label" text,
	"context_snapshot_json" jsonb,
	"promoted_at" timestamp with time zone,
	"promoted_by" text,
	"promotion_note" text,
	"promotion_kind" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text,
	"session_title" text,
	"operator_name" text NOT NULL,
	"context_snapshot_json" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_import_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source_app" text NOT NULL,
	"source_path" text,
	"imported_by" text NOT NULL,
	"thread_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operator_thread_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"turn_index" integer NOT NULL,
	"metadata_json" jsonb,
	"promoted_at" timestamp with time zone,
	"promoted_by" text,
	"promotion_note" text,
	"promotion_kind" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_thread_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"summary_kind" text NOT NULL,
	"content" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source_app" text NOT NULL,
	"source_thread_key" text,
	"source_locator" text,
	"imported_by" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"import_run_id" text,
	"raw_title" text,
	"raw_summary" text,
	"promoted_title" text,
	"promoted_summary" text,
	"privacy_state" text DEFAULT 'private' NOT NULL,
	"review_state" text DEFAULT 'imported' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"project_slug" text,
	"owner_name" text,
	"why_it_matters" text,
	"source_payload_json" jsonb,
	"parent_thread_id" text,
	"promoted_from_id" text,
	"pulled_from_id" text,
	"visible_in_studio" integer DEFAULT 1 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"is_global" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_chat_messages" ADD CONSTRAINT "operator_chat_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_chat_sessions" ADD CONSTRAINT "operator_chat_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_import_runs" ADD CONSTRAINT "operator_import_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_thread_messages" ADD CONSTRAINT "operator_thread_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_thread_summaries" ADD CONSTRAINT "operator_thread_summaries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_threads" ADD CONSTRAINT "operator_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_os_chat_messages_session" ON "operator_chat_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_os_chat_messages_workspace" ON "operator_chat_messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_os_sessions_thread" ON "operator_chat_sessions" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_os_sessions_workspace" ON "operator_chat_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_os_import_runs_workspace" ON "operator_import_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_os_import_runs_status" ON "operator_import_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_os_messages_thread" ON "operator_thread_messages" USING btree ("thread_id","turn_index");--> statement-breakpoint
CREATE INDEX "idx_os_messages_workspace" ON "operator_thread_messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_os_summaries_thread" ON "operator_thread_summaries" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_os_summaries_workspace" ON "operator_thread_summaries" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_os_threads_workspace" ON "operator_threads" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_os_threads_workspace_state" ON "operator_threads" USING btree ("workspace_id","review_state");--> statement-breakpoint
CREATE INDEX "idx_os_threads_workspace_source" ON "operator_threads" USING btree ("workspace_id","source_app");--> statement-breakpoint
CREATE INDEX "idx_os_threads_imported_at" ON "operator_threads" USING btree ("imported_at");