-- Login individual por e-mail e senha, perfil do usuário e inventário de sessões.
ALTER TABLE users ADD COLUMN password_hash text,ADD COLUMN password_changed_at timestamptz,ADD COLUMN last_login_at timestamptz,ADD COLUMN phone text CHECK(phone IS NULL OR length(phone)<=30),ADD COLUMN job_title text CHECK(job_title IS NULL OR length(job_title)<=80),ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE users SET email=lower(trim(email)) WHERE email<>lower(trim(email));
CREATE UNIQUE INDEX users_email_normalized ON users(lower(email));
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK(email=lower(email));
ALTER TABLE sessions ADD COLUMN method text NOT NULL DEFAULT 'LOCAL_DEMO' CHECK(method IN('PASSWORD','LOCAL_DEMO')),ADD COLUMN user_agent text,ADD COLUMN ip text,ADD COLUMN last_seen_at timestamptz;
CREATE INDEX sessions_user_active ON sessions(user_id,tenant_id) WHERE revoked_at IS NULL;
