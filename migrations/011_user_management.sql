-- Gestão de usuários: senha provisória com troca obrigatória e histórico do vínculo.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE memberships ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN created_by uuid REFERENCES users(id),ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN deactivated_at timestamptz;
