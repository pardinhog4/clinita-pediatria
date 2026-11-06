-- Ciclo de vida dos registros operacionais: arquivar agentes e modelos, editar/arquivar estoque, editar/cancelar
-- lançamentos, cancelar ausências com reversão, cancelar lote TISS antes do envio e estornar ajuste de repasse.

-- Histórico de versões passa a cobrir agentes, modelos clínicos, estoque e lançamentos.
ALTER TABLE record_versions DROP CONSTRAINT record_versions_entity_type_check;
ALTER TABLE record_versions ADD CONSTRAINT record_versions_entity_type_check CHECK(entity_type IN('patients','professionals','insurers','rooms','agents','models','inventory','ledger'));
INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason,created_by,created_at) SELECT tenant_id,'agents',agent_id,version,snapshot,NULL,created_by,created_at FROM agent_versions ON CONFLICT DO NOTHING;
INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason) SELECT tenant_id,'agents',id,version,to_jsonb(a),'Versão vigente na criação do histórico' FROM agents a ON CONFLICT DO NOTHING;
INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason) SELECT tenant_id,'models',id,version,to_jsonb(m),'Versão vigente na criação do histórico' FROM assessment_models m ON CONFLICT DO NOTHING;
INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason) SELECT tenant_id,'inventory',id,version,to_jsonb(i),'Versão vigente na criação do histórico' FROM inventory i ON CONFLICT DO NOTHING;
INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason) SELECT tenant_id,'ledger',id,version,to_jsonb(l),'Versão vigente na criação do histórico' FROM ledger l ON CONFLICT DO NOTHING;

-- Arquivar em vez de apagar.
ALTER TABLE agents ADD COLUMN archived_at timestamptz;
ALTER TABLE assessment_models ADD COLUMN archived_at timestamptz;
ALTER TABLE inventory ADD COLUMN active boolean NOT NULL DEFAULT true;

-- Lançamento em aberto pode ser cancelado com motivo (baixados só por estorno).
ALTER TABLE ledger DROP CONSTRAINT ledger_status_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_status_check CHECK(status IN('OPEN','SETTLED','CANCELLED'));
ALTER TABLE ledger ADD COLUMN cancelled_at timestamptz,ADD COLUMN cancelled_by uuid REFERENCES users(id),ADD COLUMN cancel_reason text CHECK(length(cancel_reason)<=1000);

-- Ausência cancelada devolve as sessões que ela cancelou (quando ainda possível).
ALTER TABLE professional_absences ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','CANCELLED')),ADD COLUMN cancelled_appointment_ids uuid[] NOT NULL DEFAULT '{}',ADD COLUMN cancelled_at timestamptz,ADD COLUMN cancelled_by uuid REFERENCES users(id),ADD COLUMN cancel_reason text CHECK(length(cancel_reason)<=1000);

-- Lote TISS pode ser cancelado antes do envio; os atendimentos voltam a ficar prontos para faturar.
ALTER TABLE billing_batches DROP CONSTRAINT billing_batches_status_check;
ALTER TABLE billing_batches ADD CONSTRAINT billing_batches_status_check CHECK(status IN('PREPARED','SENT','RETURNED','CANCELLED'));
ALTER TABLE billing_batches DROP CONSTRAINT billing_batches_amount_check;
ALTER TABLE billing_batches ADD CONSTRAINT billing_batches_amount_check CHECK(amount>0 OR status='CANCELLED');
ALTER TABLE billing_batches ADD COLUMN cancelled_at timestamptz,ADD COLUMN cancelled_by uuid REFERENCES users(id),ADD COLUMN cancel_reason text CHECK(length(cancel_reason)<=1000);

-- Estorno de ajuste de repasse: lançamento oposto ligado ao original (cada ajuste só pode ser estornado uma vez).
ALTER TABLE payout_adjustments ADD COLUMN reverses_id uuid REFERENCES payout_adjustments(id);
CREATE UNIQUE INDEX payout_adjustments_single_reversal ON payout_adjustments(reverses_id) WHERE reverses_id IS NOT NULL;
