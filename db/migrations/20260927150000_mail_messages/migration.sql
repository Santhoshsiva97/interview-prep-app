-- CreateEnum
CREATE TYPE "mail_status" AS ENUM ('queued', 'sending', 'retrying', 'sent', 'failed');

-- CreateTable
CREATE TABLE "mail_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "to_address" VARCHAR(254) NOT NULL,
    "template" VARCHAR(50) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "status" "mail_status" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "provider_message_id" VARCHAR(255),
    "last_error" VARCHAR(1000),
    "last_attempt_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_messages_status_idx" ON "mail_messages"("status");

-- CreateIndex
CREATE INDEX "mail_messages_to_address_idx" ON "mail_messages"("to_address");

-- CreateIndex
CREATE INDEX "mail_messages_user_id_idx" ON "mail_messages"("user_id");

-- CreateIndex
CREATE INDEX "mail_messages_created_at_idx" ON "mail_messages"("created_at");

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
