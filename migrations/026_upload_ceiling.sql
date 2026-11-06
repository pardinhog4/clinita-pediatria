-- Tamanho de anexo configurável (Configurações → Horários e regras, padrão 2 MB).
-- O banco mantém um teto fixo de 10 MB por arquivo; a clínica escolhe um limite até esse teto.
ALTER TABLE documents DROP CONSTRAINT documents_content_check;
ALTER TABLE documents ADD CONSTRAINT documents_content_check CHECK(octet_length(content)<=10485760);
ALTER TABLE sandbox_attachments DROP CONSTRAINT sandbox_attachments_content_check;
ALTER TABLE sandbox_attachments ADD CONSTRAINT sandbox_attachments_content_check CHECK(octet_length(content)<=10485760);
