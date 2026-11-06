-- Fase 2: regras operacionais configuráveis.
-- As regras da clínica ficam em clinic_settings.value.rules (validadas em src/lib/clinic-rules.ts).
-- Cada unidade pode ter o próprio horário de funcionamento; NULL = usa o horário da clínica.
ALTER TABLE units ADD COLUMN business_hours jsonb;
ALTER TABLE units ADD CONSTRAINT units_business_hours_week CHECK(
  business_hours IS NULL OR (jsonb_typeof(business_hours)='array' AND jsonb_array_length(business_hours)=7)
);
