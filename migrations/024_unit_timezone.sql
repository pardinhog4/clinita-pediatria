-- Fuso horário por unidade (ex.: unidade em Manaus, UTC−4). NULL = usa o fuso padrão da clínica
-- (clinic_settings.value.rules.timezone, que por padrão é America/Sao_Paulo).
ALTER TABLE units ADD COLUMN timezone text CHECK(timezone IS NULL OR timezone ~ '^[A-Za-z_]+/[A-Za-z_]+$');
