-- Fase 3 · e-mail transacional (SMTP genérico) e links de acesso.

-- Caixa de saída: todo e-mail passa por aqui. Sem SMTP configurado, fica SIMULATED (não sai da
-- máquina) e o conteúdo pode ser lido em Integrações. Com SMTP, vira SENT ou FAILED (com novas
-- tentativas pelo worker). O corpo de e-mails enviados de verdade é apagado após o envio,
-- porque pode conter links de acesso.
CREATE TABLE email_outbox(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  kind text NOT NULL CHECK(kind IN('INVITE','PASSWORD_RESET','PAYOUT_MIRROR','TEST')),
  to_email text NOT NULL CHECK(length(to_email) BETWEEN 3 AND 200),
  to_name text NOT NULL DEFAULT '' CHECK(length(to_name)<=200),
  subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 300),
  body text CHECK(body IS NULL OR length(body)<=20000),
  status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN('QUEUED','SENT','FAILED','SIMULATED')),
  attempts int NOT NULL DEFAULT 0,
  last_error text CHECK(last_error IS NULL OR length(last_error)<=1000),
  provider_id text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_outbox_pending ON email_outbox(next_attempt_at) WHERE status IN('QUEUED','FAILED');
CREATE INDEX email_outbox_tenant ON email_outbox(tenant_id,created_at DESC);

-- Link de uso único para definir senha: convite (72 h) ou recuperação (1 h). Só o hash fica salvo.
CREATE TABLE access_tokens(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  tenant_id uuid REFERENCES tenants(id),
  purpose text NOT NULL CHECK(purpose IN('INVITE','PASSWORD_RESET')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_tokens_user ON access_tokens(user_id,purpose) WHERE used_at IS NULL;
