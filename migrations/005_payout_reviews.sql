CREATE TABLE payout_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),unit_id uuid NOT NULL,professional_id uuid NOT NULL,
 snapshot text NOT NULL,status text NOT NULL CHECK(status IN('CONFIRMED','APPROVED')),
 confirmed_by uuid NOT NULL REFERENCES users(id),confirmed_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES users(id),approved_at timestamptz,reason text NOT NULL,
 FOREIGN KEY(tenant_id,unit_id) REFERENCES units(tenant_id,id),FOREIGN KEY(tenant_id,professional_id) REFERENCES professionals(tenant_id,id),
 UNIQUE(tenant_id,unit_id,professional_id)
);
