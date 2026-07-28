CREATE TABLE IF NOT EXISTS settings (

    id SMALLINT PRIMARY KEY DEFAULT 1,

    maintenance BOOLEAN NOT NULL DEFAULT FALSE,

    title TEXT DEFAULT 'We''ll be back shortly',

    message TEXT DEFAULT 'We are currently performing scheduled maintenance.',

    ends_at TIMESTAMPTZ,

    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT settings_single_row CHECK (id = 1)

);

INSERT INTO settings (id)

VALUES (1)

ON CONFLICT (id) DO NOTHING;