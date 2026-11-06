-- Cadastros base: unidades ativas/inativas, filas configuráveis, especialidades por clínica e catálogo de competências com ativação.

-- Unidades
ALTER TABLE units ADD COLUMN active boolean NOT NULL DEFAULT true,ADD COLUMN deactivated_at timestamptz,ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX units_tenant_name ON units(tenant_id,lower(name));

-- Filas: as 6 filas de sistema (usadas pela IA e pelos fluxos) não mudam de código nem são desativadas.
ALTER TABLE service_queues ADD COLUMN system boolean NOT NULL DEFAULT false,ADD COLUMN sort_order int NOT NULL DEFAULT 100;
UPDATE service_queues SET system=true,sort_order=CASE code WHEN 'recepcao' THEN 1 WHEN 'agenda' THEN 2 WHEN 'convenios' THEN 3 WHEN 'clinica' THEN 4 WHEN 'auditoria' THEN 5 WHEN 'financeiro' THEN 6 END WHERE code IN('recepcao','agenda','convenios','clinica','auditoria','financeiro');
CREATE FUNCTION create_system_queues() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO service_queues(tenant_id,unit_id,code,name,system,sort_order) VALUES(NEW.tenant_id,NEW.id,'recepcao','Recepção',true,1),(NEW.tenant_id,NEW.id,'agenda','Agendamento',true,2),(NEW.tenant_id,NEW.id,'convenios','Documentos e convênios',true,3),(NEW.tenant_id,NEW.id,'clinica','Coordenação clínica',true,4),(NEW.tenant_id,NEW.id,'auditoria','Auditoria',true,5),(NEW.tenant_id,NEW.id,'financeiro','Financeiro',true,6) ON CONFLICT DO NOTHING;
 RETURN NEW;END$$;
CREATE TRIGGER units_system_queues AFTER INSERT ON units FOR EACH ROW EXECUTE FUNCTION create_system_queues();
-- Unidades antigas que nunca abriram um Sandbox ficaram sem filas.
INSERT INTO service_queues(tenant_id,unit_id,code,name,system,sort_order) SELECT u.tenant_id,u.id,q.code,q.name,true,q.ord FROM units u CROSS JOIN (VALUES('recepcao','Recepção',1),('agenda','Agendamento',2),('convenios','Documentos e convênios',3),('clinica','Coordenação clínica',4),('auditoria','Auditoria',5),('financeiro','Financeiro',6)) q(code,name,ord) ON CONFLICT DO NOTHING;

-- Especialidades por clínica (antes, lista fixa no código). shared_room substitui a regra "só ABA usa sala coletiva".
CREATE TABLE specialties(tenant_id uuid NOT NULL REFERENCES tenants(id),code text NOT NULL CHECK(code ~ '^[a-z][a-z0-9_]{1,29}$'),name text NOT NULL CHECK(length(name) BETWEEN 2 AND 80),shared_room boolean NOT NULL DEFAULT false,sort_order int NOT NULL DEFAULT 100,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,code));
CREATE UNIQUE INDEX specialties_tenant_name ON specialties(tenant_id,lower(name));
CREATE FUNCTION create_default_specialties() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO specialties(tenant_id,code,name,shared_room,sort_order) VALUES(NEW.id,'fono','Fonoaudiologia',false,1),(NEW.id,'psico','Psicologia',false,2),(NEW.id,'to','Terapia ocupacional',false,3),(NEW.id,'aba','Terapia ABA',true,4),(NEW.id,'psped','Psicopedagogia',false,5),(NEW.id,'fisio','Fisioterapia',false,6),(NEW.id,'nutri','Nutrição',false,7) ON CONFLICT DO NOTHING;
 RETURN NEW;END$$;
CREATE TRIGGER tenants_default_specialties AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION create_default_specialties();
INSERT INTO specialties(tenant_id,code,name,shared_room,sort_order) SELECT t.id,s.code,s.name,s.shared,s.ord FROM tenants t CROSS JOIN (VALUES('fono','Fonoaudiologia',false,1),('psico','Psicologia',false,2),('to','Terapia ocupacional',false,3),('aba','Terapia ABA',true,4),('psped','Psicopedagogia',false,5),('fisio','Fisioterapia',false,6),('nutri','Nutrição',false,7)) s(code,name,shared,ord) ON CONFLICT DO NOTHING;

-- Catálogo de competências: desativar em vez de apagar (profissionais guardam os códigos).
ALTER TABLE competency_catalog ADD COLUMN active boolean NOT NULL DEFAULT true,ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
