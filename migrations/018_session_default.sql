-- Sessões criadas sem método explícito passam a ser login com senha; LOCAL_DEMO só quando a demonstração emite.
ALTER TABLE sessions ALTER COLUMN method SET DEFAULT 'PASSWORD';
