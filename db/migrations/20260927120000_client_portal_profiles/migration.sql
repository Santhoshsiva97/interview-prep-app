-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "headline" VARCHAR(120),
    "bio" VARCHAR(1000),
    "location" VARCHAR(100),
    "target_role" VARCHAR(100),
    "experience_years" SMALLINT,
    "linkedin_url" VARCHAR(255),
    "github_url" VARCHAR(255),
    "avatar_key" VARCHAR(512),
    "resume_key" VARCHAR(512),
    "resume_file_name" VARCHAR(255),
    "resume_size_bytes" INTEGER,
    "resume_uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
