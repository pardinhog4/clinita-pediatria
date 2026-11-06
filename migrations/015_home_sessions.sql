-- Sessões em domicílio (ex.: assistente terapêutico): entram na agenda do profissional e do paciente, mas não ocupam sala.
ALTER TABLE appointments ADD COLUMN location text NOT NULL DEFAULT 'CLINIC' CHECK(location IN('CLINIC','HOME'));
