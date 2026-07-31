BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS pending_email text,
    ADD COLUMN IF NOT EXISTS pending_email_token text,
    ADD COLUMN IF NOT EXISTS pending_email_requested_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS users_pending_email_token_key
    ON public.users (pending_email_token)
    WHERE pending_email_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_pending_email_lower_idx
    ON public.users (LOWER(pending_email))
    WHERE pending_email IS NOT NULL;

COMMIT;
