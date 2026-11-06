-- Fuso da unidade para consultas: o próprio da unidade, senão o padrão da clínica, senão Brasília.
-- Usado em "AT TIME ZONE unit_tz(tenant_id, unit_id)" no lugar de um fuso fixo.
-- p_unit pode ser NULL (registros gerais da clínica): vale o fuso da clínica.
CREATE FUNCTION unit_tz(p_tenant uuid, p_unit uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT timezone FROM units WHERE tenant_id=p_tenant AND id=p_unit),
    (SELECT value->'rules'->>'timezone' FROM clinic_settings WHERE tenant_id=p_tenant),
    'America/Sao_Paulo'
  )
$$;
