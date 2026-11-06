-- Ciclo de vida dos cadastros: desativar em vez de apagar, histórico de versões, procedimentos e preços por convênio
-- e remoção auditada de documentos.

ALTER TABLE rooms ADD COLUMN active boolean NOT NULL DEFAULT true,ADD COLUMN deactivated_at timestamptz;
ALTER TABLE insurers ADD COLUMN active boolean NOT NULL DEFAULT true,ADD COLUMN deactivated_at timestamptz;
-- Paciente com alta (ou arquivado) não recebe novos agendamentos; o prontuário continua acessível.
ALTER TABLE patients ADD COLUMN active boolean NOT NULL DEFAULT true,ADD COLUMN discharged_at timestamptz,ADD COLUMN discharge_reason text NOT NULL DEFAULT '' CHECK(length(discharge_reason)<=1000);
ALTER TABLE documents ADD COLUMN deleted_at timestamptz,ADD COLUMN deleted_by uuid REFERENCES users(id),ADD COLUMN delete_reason text CHECK(length(delete_reason)<=500);

-- Histórico de versões dos cadastros (cópia completa a cada alteração, com motivo e autor).
CREATE TABLE record_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),entity_type text NOT NULL CHECK(entity_type IN('patients','professionals','insurers','rooms')),entity_id uuid NOT NULL,version int NOT NULL,snapshot jsonb NOT NULL,reason text,created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(entity_type,entity_id,version));
CREATE INDEX record_versions_entity ON record_versions(tenant_id,entity_type,entity_id,version DESC);
INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason) SELECT tenant_id,'patients',id,version,to_jsonb(p)-'content','Versão vigente na criação do histórico' FROM patients p;
INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason) SELECT tenant_id,'professionals',id,version,to_jsonb(p),'Versão vigente na criação do histórico' FROM professionals p;
INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason) SELECT tenant_id,'insurers',id,version,to_jsonb(i),'Versão vigente na criação do histórico' FROM insurers i;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;
INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason) SELECT tenant_id,'rooms',id,version,to_jsonb(r),'Versão vigente na criação do histórico' FROM rooms r;

-- Procedimentos e preços por convênio (código TUSS). Substituem o valor único "session_value" quando cadastrados.
CREATE TABLE insurer_procedures(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),insurer_id uuid NOT NULL,code text NOT NULL CHECK(code ~ '^[0-9A-Za-z.-]{3,20}$'),description text NOT NULL CHECK(length(description) BETWEEN 3 AND 200),specialty text,duration int NOT NULL CHECK(duration BETWEEN 15 AND 240),price numeric(12,2) NOT NULL CHECK(price>=0),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,insurer_id) REFERENCES insurers(tenant_id,id),FOREIGN KEY(tenant_id,specialty) REFERENCES specialties(tenant_id,code));
CREATE UNIQUE INDEX insurer_procedures_active ON insurer_procedures(tenant_id,insurer_id,coalesce(specialty,''),duration) WHERE active;
-- Valor faturável de uma sessão: procedimento ativo da especialidade (ou geral) com a mesma duração; senão, a regra antiga
-- (duração / duração do contrato × valor da sessão).
CREATE FUNCTION session_amount(p_tenant uuid,p_insurer uuid,p_specialty text,p_minutes numeric,p_rules jsonb) RETURNS numeric STABLE LANGUAGE sql AS $$
 SELECT coalesce((SELECT price FROM insurer_procedures WHERE tenant_id=p_tenant AND insurer_id=p_insurer AND active AND duration=p_minutes AND (specialty=p_specialty OR specialty IS NULL) ORDER BY specialty NULLS LAST LIMIT 1),
  p_minutes/nullif(coalesce((p_rules->>'duration')::numeric,60),0)*coalesce((p_rules->>'session_value')::numeric,0))$$;
