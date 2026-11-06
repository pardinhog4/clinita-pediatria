-- Agendamento a partir do plano: itens aceitos viram proposta de sessões semanais; a aprovação da proposta marca o item como agendado.
ALTER TABLE referral_items DROP CONSTRAINT referral_items_state_check;
ALTER TABLE referral_items ADD CONSTRAINT referral_items_state_check CHECK(state IN('PENDING','ACCEPTED','SCHEDULED','RESOLVED','SUPERSEDED'));
ALTER TABLE referral_items ADD COLUMN proposal_id uuid REFERENCES conversation_proposals(id),ADD COLUMN scheduled_at timestamptz;
ALTER TABLE conversation_proposals ADD COLUMN referral_item_ids uuid[] NOT NULL DEFAULT '{}';
CREATE INDEX referral_items_proposal ON referral_items(proposal_id) WHERE proposal_id IS NOT NULL;
