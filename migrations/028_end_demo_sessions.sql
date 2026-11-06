-- Fase 4: o acesso de demonstração saiu do produto. Encerra as sessões de demonstração abertas;
-- a partir daqui só se entra com e-mail e senha.
UPDATE sessions SET revoked_at=now() WHERE method='LOCAL_DEMO' AND revoked_at IS NULL;
