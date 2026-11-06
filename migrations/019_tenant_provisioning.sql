-- Clínica de demonstração marcada por dado (não mais pelo e-mail fixo no código) e ordem das unidades configurável.
ALTER TABLE tenants ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN demo_admin_user_id uuid REFERENCES users(id);
ALTER TABLE units ADD COLUMN sort_order int NOT NULL DEFAULT 100;
UPDATE tenants t SET demo_admin_user_id=u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.role='ADMIN' WHERE u.email='local@integrar.test' AND m.tenant_id=t.id;
UPDATE units u SET sort_order=0 FROM tenants t WHERE t.id=u.tenant_id AND t.demo_admin_user_id IS NOT NULL AND u.name='Filial 01';
