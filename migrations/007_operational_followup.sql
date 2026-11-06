ALTER TABLE appointments ADD COLUMN reminder_requested_at timestamptz;
ALTER TABLE session_credits ALTER COLUMN source_appointment_id DROP NOT NULL,ADD COLUMN source_reference text;
CREATE UNIQUE INDEX imported_credit_reference ON session_credits(tenant_id,source_reference) WHERE source_reference IS NOT NULL;
