-- Plano de encaminhamento gerado a partir de laudo/pedido: um item por serviço, com profissional sugerido ou coordenação clínica.
CREATE TABLE referral_plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),unit_id uuid NOT NULL REFERENCES units(id),conversation_id uuid NOT NULL REFERENCES conversations(id),agent_run_id uuid REFERENCES agent_runs(id),patient_id uuid REFERENCES patients(id),
 patient_label text NOT NULL DEFAULT '' CHECK(length(patient_label)<=120),age_years numeric(5,2) CHECK(age_years IS NULL OR age_years BETWEEN 0 AND 120),notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),sandbox boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','SUPERSEDED')),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX referral_plans_conversation ON referral_plans(tenant_id,conversation_id,status);
CREATE UNIQUE INDEX referral_plans_one_active ON referral_plans(tenant_id,conversation_id) WHERE status='ACTIVE';
CREATE TABLE referral_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),unit_id uuid NOT NULL REFERENCES units(id),plan_id uuid NOT NULL REFERENCES referral_plans(id),conversation_id uuid NOT NULL REFERENCES conversations(id),position int NOT NULL,
 service_text text NOT NULL CHECK(length(service_text) BETWEEN 1 AND 400),specialties text[] NOT NULL DEFAULT '{}',requirements text[] NOT NULL DEFAULT '{}',catalog_codes text[] NOT NULL DEFAULT '{}',load_text text NOT NULL DEFAULT '' CHECK(length(load_text)<=200),weekly_hours numeric(5,2),modality text CHECK(modality IN('CLINIC','HOME','ONLINE')),
 match_status text NOT NULL CHECK(match_status IN('SUGGESTED','PARTIAL','NO_MATCH','NOT_OFFERED')),professional_id uuid REFERENCES professionals(id),alternatives jsonb NOT NULL DEFAULT '[]',reason text NOT NULL DEFAULT '' CHECK(length(reason)<=1000),warnings text[] NOT NULL DEFAULT '{}',
 route text NOT NULL CHECK(route IN('PROFESSIONAL','COORDINATION')),state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','ACCEPTED','RESOLVED','SUPERSEDED')),
 history jsonb NOT NULL DEFAULT '[]',decided_by uuid REFERENCES users(id),decided_at timestamptz,version int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((route='PROFESSIONAL')=(professional_id IS NOT NULL)));
CREATE INDEX referral_items_professional ON referral_items(tenant_id,professional_id,state);
CREATE INDEX referral_items_route ON referral_items(tenant_id,unit_id,route,state);
CREATE INDEX referral_items_plan ON referral_items(plan_id,position);
