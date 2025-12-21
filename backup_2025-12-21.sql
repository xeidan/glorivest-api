--
-- PostgreSQL database dump
--

\restrict pESY9s2TRkUYF6UgBJAEEGskDhmpEp85fqdkGg4JgnKzH4nFrOooUCMtYLBxf7t

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.7 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: _heroku; Type: SCHEMA; Schema: -; Owner: heroku_admin
--

CREATE SCHEMA _heroku;


ALTER SCHEMA _heroku OWNER TO heroku_admin;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: uc001spkeri80k
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO uc001spkeri80k;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: uc001spkeri80k
--

COMMENT ON SCHEMA public IS '';


--
-- Name: create_ext(); Type: FUNCTION; Schema: _heroku; Owner: heroku_admin
--

CREATE FUNCTION _heroku.create_ext() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

DECLARE

  schemaname TEXT;
  databaseowner TEXT;

  r RECORD;

BEGIN

  IF tg_tag OPERATOR(pg_catalog.=) 'CREATE EXTENSION' AND current_user OPERATOR(pg_catalog.!=) 'rds_superuser' THEN
    PERFORM _heroku.validate_search_path();

    FOR r IN SELECT * FROM pg_catalog.pg_event_trigger_ddl_commands()
    LOOP
        CONTINUE WHEN r.command_tag != 'CREATE EXTENSION' OR r.object_type != 'extension';

        schemaname := (
            SELECT n.nspname
            FROM pg_catalog.pg_extension AS e
            INNER JOIN pg_catalog.pg_namespace AS n
            ON e.extnamespace = n.oid
            WHERE e.oid = r.objid
        );

        databaseowner := (
            SELECT pg_catalog.pg_get_userbyid(d.datdba)
            FROM pg_catalog.pg_database d
            WHERE d.datname = pg_catalog.current_database()
        );
        --RAISE NOTICE 'Record for event trigger %, objid: %,tag: %, current_user: %, schema: %, database_owenr: %', r.object_identity, r.objid, tg_tag, current_user, schemaname, databaseowner;
        IF r.object_identity = 'address_standardizer_data_us' THEN
            PERFORM _heroku.grant_table_if_exists(schemaname, 'SELECT, UPDATE, INSERT, DELETE', databaseowner, 'us_gaz');
            PERFORM _heroku.grant_table_if_exists(schemaname, 'SELECT, UPDATE, INSERT, DELETE', databaseowner, 'us_lex');
            PERFORM _heroku.grant_table_if_exists(schemaname, 'SELECT, UPDATE, INSERT, DELETE', databaseowner, 'us_rules');
        ELSIF r.object_identity = 'amcheck' THEN
            EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %I.bt_index_check TO %I;', schemaname, databaseowner);
            EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %I.bt_index_parent_check TO %I;', schemaname, databaseowner);
        ELSIF r.object_identity = 'dict_int' THEN
            EXECUTE pg_catalog.format('ALTER TEXT SEARCH DICTIONARY %I.intdict OWNER TO %I;', schemaname, databaseowner);
        ELSIF r.object_identity = 'pg_partman' THEN
            PERFORM _heroku.grant_table_if_exists(schemaname, 'SELECT, UPDATE, INSERT, DELETE', databaseowner, 'part_config');
            PERFORM _heroku.grant_table_if_exists(schemaname, 'SELECT, UPDATE, INSERT, DELETE', databaseowner, 'part_config_sub');
            PERFORM _heroku.grant_table_if_exists(schemaname, 'SELECT, UPDATE, INSERT, DELETE', databaseowner, 'custom_time_partitions');
        ELSIF r.object_identity = 'pg_stat_statements' THEN
            EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %I.pg_stat_statements_reset TO %I;', schemaname, databaseowner);
        ELSIF r.object_identity = 'postgis' THEN
            PERFORM _heroku.postgis_after_create();
        ELSIF r.object_identity = 'postgis_raster' THEN
            PERFORM _heroku.postgis_after_create();
            PERFORM _heroku.grant_table_if_exists(schemaname, 'SELECT', databaseowner, 'raster_columns');
            PERFORM _heroku.grant_table_if_exists(schemaname, 'SELECT', databaseowner, 'raster_overviews');
        ELSIF r.object_identity = 'postgis_topology' THEN
            PERFORM _heroku.postgis_after_create();
            EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA topology TO %I;', databaseowner);
            EXECUTE pg_catalog.format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA topology TO %I;', databaseowner);
            PERFORM _heroku.grant_table_if_exists('topology', 'SELECT, UPDATE, INSERT, DELETE', databaseowner);
            EXECUTE pg_catalog.format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA topology TO %I;', databaseowner);
        ELSIF r.object_identity = 'postgis_tiger_geocoder' THEN
            PERFORM _heroku.postgis_after_create();
            EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA tiger TO %I;', databaseowner);
            EXECUTE pg_catalog.format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tiger TO %I;', databaseowner);
            PERFORM _heroku.grant_table_if_exists('tiger', 'SELECT, UPDATE, INSERT, DELETE', databaseowner);

            EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA tiger_data TO %I;', databaseowner);
            EXECUTE pg_catalog.format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tiger_data TO %I;', databaseowner);
            PERFORM _heroku.grant_table_if_exists('tiger_data', 'SELECT, UPDATE, INSERT, DELETE', databaseowner);
        END IF;
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION _heroku.create_ext() OWNER TO heroku_admin;

--
-- Name: drop_ext(); Type: FUNCTION; Schema: _heroku; Owner: heroku_admin
--

CREATE FUNCTION _heroku.drop_ext() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

DECLARE

  schemaname TEXT;
  databaseowner TEXT;

  r RECORD;

BEGIN

  IF tg_tag OPERATOR(pg_catalog.=) 'DROP EXTENSION' AND current_user OPERATOR(pg_catalog.!=) 'rds_superuser' THEN
    PERFORM _heroku.validate_search_path();

    FOR r IN SELECT * FROM pg_catalog.pg_event_trigger_dropped_objects()
    LOOP
      CONTINUE WHEN r.object_type != 'extension';

      databaseowner := (
            SELECT pg_catalog.pg_get_userbyid(d.datdba)
            FROM pg_catalog.pg_database d
            WHERE d.datname = pg_catalog.current_database()
      );

      --RAISE NOTICE 'Record for event trigger %, objid: %,tag: %, current_user: %, database_owner: %, schemaname: %', r.object_identity, r.objid, tg_tag, current_user, databaseowner, r.schema_name;

      IF r.object_identity = 'postgis_topology' THEN
          EXECUTE pg_catalog.format('DROP SCHEMA IF EXISTS topology');
      END IF;
    END LOOP;

  END IF;
END;
$$;


ALTER FUNCTION _heroku.drop_ext() OWNER TO heroku_admin;

--
-- Name: extension_before_drop(); Type: FUNCTION; Schema: _heroku; Owner: heroku_admin
--

CREATE FUNCTION _heroku.extension_before_drop() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

DECLARE

  query TEXT;

BEGIN
  query := (SELECT pg_catalog.current_query());

  -- RAISE NOTICE 'executing extension_before_drop: tg_event: %, tg_tag: %, current_user: %, session_user: %, query: %', tg_event, tg_tag, current_user, session_user, query;
  IF tg_tag OPERATOR(pg_catalog.=) 'DROP EXTENSION' AND NOT pg_catalog.pg_has_role(session_user, 'rds_superuser', 'MEMBER') THEN
    PERFORM _heroku.validate_search_path();

    -- DROP EXTENSION [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
    IF (pg_catalog.regexp_match(query, 'DROP\s+EXTENSION\s+(IF\s+EXISTS)?.*(plpgsql)', 'i') IS NOT NULL) THEN
      RAISE EXCEPTION 'The plpgsql extension is required for database management and cannot be dropped.';
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION _heroku.extension_before_drop() OWNER TO heroku_admin;

--
-- Name: grant_table_if_exists(text, text, text, text); Type: FUNCTION; Schema: _heroku; Owner: heroku_admin
--

CREATE FUNCTION _heroku.grant_table_if_exists(alias_schemaname text, grants text, databaseowner text, alias_tablename text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

BEGIN
  PERFORM _heroku.validate_search_path();

  IF alias_tablename IS NULL THEN
    EXECUTE pg_catalog.format('GRANT %s ON ALL TABLES IN SCHEMA %I TO %I;', grants, alias_schemaname, databaseowner);
  ELSE
    IF EXISTS (SELECT 1 FROM pg_tables WHERE pg_tables.schemaname = alias_schemaname AND pg_tables.tablename = alias_tablename) THEN
      EXECUTE pg_catalog.format('GRANT %s ON TABLE %I.%I TO %I;', grants, alias_schemaname, alias_tablename, databaseowner);
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION _heroku.grant_table_if_exists(alias_schemaname text, grants text, databaseowner text, alias_tablename text) OWNER TO heroku_admin;

--
-- Name: postgis_after_create(); Type: FUNCTION; Schema: _heroku; Owner: heroku_admin
--

CREATE FUNCTION _heroku.postgis_after_create() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    schemaname TEXT;
    databaseowner TEXT;
BEGIN
    PERFORM _heroku.validate_search_path();

    schemaname := (
        SELECT n.nspname
        FROM pg_catalog.pg_extension AS e
        INNER JOIN pg_catalog.pg_namespace AS n ON e.extnamespace = n.oid
        WHERE e.extname = 'postgis'
    );
    databaseowner := (
        SELECT pg_catalog.pg_get_userbyid(d.datdba)
        FROM pg_catalog.pg_database d
        WHERE d.datname = pg_catalog.current_database()
    );

    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %I.st_tileenvelope TO %I;', schemaname, databaseowner);
    EXECUTE pg_catalog.format('GRANT SELECT, UPDATE, INSERT, DELETE ON TABLE %I.spatial_ref_sys TO %I;', schemaname, databaseowner);
END;
$$;


ALTER FUNCTION _heroku.postgis_after_create() OWNER TO heroku_admin;

--
-- Name: validate_extension(); Type: FUNCTION; Schema: _heroku; Owner: heroku_admin
--

CREATE FUNCTION _heroku.validate_extension() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

DECLARE

  schemaname TEXT;
  r RECORD;

BEGIN

  IF tg_tag OPERATOR(pg_catalog.=) 'CREATE EXTENSION' AND current_user OPERATOR(pg_catalog.!=) 'rds_superuser' THEN
    PERFORM _heroku.validate_search_path();

    FOR r IN SELECT * FROM pg_catalog.pg_event_trigger_ddl_commands()
    LOOP
      CONTINUE WHEN r.command_tag != 'CREATE EXTENSION' OR r.object_type != 'extension';

      schemaname := (
        SELECT n.nspname
        FROM pg_catalog.pg_extension AS e
        INNER JOIN pg_catalog.pg_namespace AS n
        ON e.extnamespace = n.oid
        WHERE e.oid = r.objid
      );

      IF schemaname = '_heroku' THEN
        RAISE EXCEPTION 'Creating extensions in the _heroku schema is not allowed';
      END IF;
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION _heroku.validate_extension() OWNER TO heroku_admin;

--
-- Name: validate_search_path(); Type: FUNCTION; Schema: _heroku; Owner: heroku_admin
--

CREATE FUNCTION _heroku.validate_search_path() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE

  current_search_path TEXT;
  schemas TEXT[];
  pg_catalog_index INTEGER;

BEGIN

  current_search_path := pg_catalog.current_setting('search_path');
  schemas := pg_catalog.string_to_array(current_search_path, ',');

  schemas := (
    SELECT pg_catalog.array_agg(TRIM(schema_name::text))
    FROM pg_catalog.unnest(schemas) AS schema_name
  );

  IF ('pg_catalog' OPERATOR(pg_catalog.=) ANY(schemas)) THEN
    SELECT pg_catalog.array_position(schemas, 'pg_catalog') INTO pg_catalog_index;
    IF pg_catalog_index OPERATOR(pg_catalog.!=) 1 THEN
      RAISE EXCEPTION 'pg_catalog must be first in the search_path for this operation. Current search_path: %', current_search_path;
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION _heroku.validate_search_path() OWNER TO heroku_admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_tiers; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.account_tiers (
    id integer NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    monthly_fee_cents bigint DEFAULT 0,
    withdrawal_limit_cents bigint DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.account_tiers OWNER TO uc001spkeri80k;

--
-- Name: account_tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.account_tiers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.account_tiers_id_seq OWNER TO uc001spkeri80k;

--
-- Name: account_tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.account_tiers_id_seq OWNED BY public.account_tiers.id;


--
-- Name: account_wallets; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.account_wallets (
    id integer NOT NULL,
    account_id integer NOT NULL,
    wallet_id bigint NOT NULL,
    role text DEFAULT 'primary'::text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.account_wallets OWNER TO uc001spkeri80k;

--
-- Name: account_wallets_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.account_wallets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.account_wallets_id_seq OWNER TO uc001spkeri80k;

--
-- Name: account_wallets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.account_wallets_id_seq OWNED BY public.account_wallets.id;


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.accounts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    tier_id integer NOT NULL,
    account_code text NOT NULL,
    status text DEFAULT 'inactive'::text NOT NULL,
    balance_cents bigint DEFAULT 0 NOT NULL,
    profit_cents bigint DEFAULT 0 NOT NULL,
    bot_started_at timestamp without time zone,
    bot_ends_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT balance_non_negative CHECK ((balance_cents >= 0))
);


ALTER TABLE public.accounts OWNER TO uc001spkeri80k;

--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.accounts_id_seq OWNER TO uc001spkeri80k;

--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: deposits; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.deposits (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    provider text,
    type text,
    amount_cents bigint,
    currency text,
    status text NOT NULL,
    provider_ref text,
    idempotency_key text,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    swept boolean DEFAULT false,
    sweep_tx_hash text,
    network text,
    token text,
    tx_hash text,
    from_addr text,
    to_addr text,
    amount numeric(38,8),
    confirmations integer DEFAULT 0,
    account_id integer,
    src_currency text,
    src_amount_cents bigint,
    fx_rate numeric(20,8),
    fx_at timestamp with time zone
);


ALTER TABLE public.deposits OWNER TO uc001spkeri80k;

--
-- Name: deposits_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.deposits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.deposits_id_seq OWNER TO uc001spkeri80k;

--
-- Name: deposits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.deposits_id_seq OWNED BY public.deposits.id;


--
-- Name: devices; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.devices (
    id integer NOT NULL,
    user_id integer,
    fingerprint text,
    user_agent text,
    last_seen timestamp with time zone DEFAULT now(),
    ip character varying(64),
    country character varying(100),
    city character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.devices OWNER TO uc001spkeri80k;

--
-- Name: devices_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.devices_id_seq OWNER TO uc001spkeri80k;

--
-- Name: devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.devices_id_seq OWNED BY public.devices.id;


--
-- Name: ledger; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.ledger (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    account_id uuid NOT NULL,
    type text NOT NULL,
    amount_cents bigint NOT NULL,
    ref_type text,
    ref_id uuid,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.ledger OWNER TO uc001spkeri80k;

--
-- Name: ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ledger_id_seq OWNER TO uc001spkeri80k;

--
-- Name: ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.ledger_id_seq OWNED BY public.ledger.id;


--
-- Name: login_events; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.login_events (
    id integer NOT NULL,
    user_id integer,
    ip character varying(64),
    user_agent text,
    device_fingerprint text,
    country character varying(100),
    city character varying(100),
    succeeded boolean DEFAULT false,
    suspicious boolean DEFAULT false,
    reason text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.login_events OWNER TO uc001spkeri80k;

--
-- Name: login_events_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.login_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.login_events_id_seq OWNER TO uc001spkeri80k;

--
-- Name: login_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.login_events_id_seq OWNED BY public.login_events.id;


--
-- Name: otps; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.otps (
    id integer NOT NULL,
    user_id integer,
    email text NOT NULL,
    code text NOT NULL,
    purpose text NOT NULL,
    used boolean DEFAULT false,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    meta jsonb
);


ALTER TABLE public.otps OWNER TO uc001spkeri80k;

--
-- Name: otps_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.otps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.otps_id_seq OWNER TO uc001spkeri80k;

--
-- Name: otps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.otps_id_seq OWNED BY public.otps.id;


--
-- Name: pending_email_updates; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.pending_email_updates (
    id integer NOT NULL,
    user_id integer NOT NULL,
    new_email character varying(255) NOT NULL,
    code character varying(10) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.pending_email_updates OWNER TO uc001spkeri80k;

--
-- Name: pending_email_updates_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.pending_email_updates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pending_email_updates_id_seq OWNER TO uc001spkeri80k;

--
-- Name: pending_email_updates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.pending_email_updates_id_seq OWNED BY public.pending_email_updates.id;


--
-- Name: positions; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.positions (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    symbol text NOT NULL,
    side text NOT NULL,
    qty numeric(18,6) DEFAULT 1 NOT NULL,
    entry_price numeric(18,6) NOT NULL,
    exit_price numeric(18,6),
    pnl numeric(18,6) DEFAULT 0,
    fees numeric(18,6) DEFAULT 0,
    status text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    duration_sec integer,
    strategy text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT positions_side_check CHECK ((side = ANY (ARRAY['BUY'::text, 'SELL'::text]))),
    CONSTRAINT positions_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'CLOSED'::text, 'CANCELLED'::text])))
);


ALTER TABLE public.positions OWNER TO uc001spkeri80k;

--
-- Name: positions_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.positions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.positions_id_seq OWNER TO uc001spkeri80k;

--
-- Name: positions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.positions_id_seq OWNED BY public.positions.id;


--
-- Name: rate_limit_logs; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.rate_limit_logs (
    id integer NOT NULL,
    ip_address text NOT NULL,
    endpoint text NOT NULL,
    attempts integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.rate_limit_logs OWNER TO uc001spkeri80k;

--
-- Name: rate_limit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.rate_limit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rate_limit_logs_id_seq OWNER TO uc001spkeri80k;

--
-- Name: rate_limit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.rate_limit_logs_id_seq OWNED BY public.rate_limit_logs.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.sessions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    ip_address text,
    user_agent text,
    token text,
    created_at timestamp without time zone DEFAULT now(),
    expires_at timestamp without time zone
);


ALTER TABLE public.sessions OWNER TO uc001spkeri80k;

--
-- Name: sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sessions_id_seq OWNER TO uc001spkeri80k;

--
-- Name: sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.sessions_id_seq OWNED BY public.sessions.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.settings (
    id integer NOT NULL,
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.settings OWNER TO uc001spkeri80k;

--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.settings_id_seq OWNER TO uc001spkeri80k;

--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: suspicious_logins; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.suspicious_logins (
    id integer NOT NULL,
    user_id integer NOT NULL,
    ip_address text,
    user_agent text,
    reason text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.suspicious_logins OWNER TO uc001spkeri80k;

--
-- Name: suspicious_logins_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.suspicious_logins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.suspicious_logins_id_seq OWNER TO uc001spkeri80k;

--
-- Name: suspicious_logins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.suspicious_logins_id_seq OWNED BY public.suspicious_logins.id;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.transactions (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    account_id bigint NOT NULL,
    type character varying(32) NOT NULL,
    amount_cents bigint NOT NULL,
    balance_after_cents bigint NOT NULL,
    reference character varying(64),
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.transactions OWNER TO uc001spkeri80k;

--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.transactions_id_seq OWNER TO uc001spkeri80k;

--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    referral_code text,
    referred_by text,
    rave_id text,
    reward_balance numeric DEFAULT 0,
    referral_earnings numeric DEFAULT 0,
    otp text,
    otp_created_at timestamp without time zone,
    bot_active boolean DEFAULT false,
    bot_started_at timestamp without time zone,
    bot_ended_at timestamp without time zone,
    eligible_for_withdrawal boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    is_verified boolean DEFAULT false,
    total_referrals integer DEFAULT 0,
    default_account_id bigint,
    password_hash text,
    total_earnings numeric DEFAULT 0,
    deleted_at timestamp with time zone,
    email_verified boolean DEFAULT false,
    last_login_at timestamp without time zone,
    last_login_ip text
);


ALTER TABLE public.users OWNER TO uc001spkeri80k;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO uc001spkeri80k;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.wallets (
    id bigint NOT NULL,
    account_id integer,
    network text,
    address text,
    private_key text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    user_id bigint
);


ALTER TABLE public.wallets OWNER TO uc001spkeri80k;

--
-- Name: wallets_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.wallets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.wallets_id_seq OWNER TO uc001spkeri80k;

--
-- Name: wallets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.wallets_id_seq OWNED BY public.wallets.id;


--
-- Name: withdrawals; Type: TABLE; Schema: public; Owner: uc001spkeri80k
--

CREATE TABLE public.withdrawals (
    id bigint NOT NULL,
    account_id integer,
    amount_cents bigint NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    provider_ref text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tx_hash text,
    idempotency_key text
);


ALTER TABLE public.withdrawals OWNER TO uc001spkeri80k;

--
-- Name: withdrawals_id_seq; Type: SEQUENCE; Schema: public; Owner: uc001spkeri80k
--

CREATE SEQUENCE public.withdrawals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.withdrawals_id_seq OWNER TO uc001spkeri80k;

--
-- Name: withdrawals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: uc001spkeri80k
--

ALTER SEQUENCE public.withdrawals_id_seq OWNED BY public.withdrawals.id;


--
-- Name: account_tiers id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.account_tiers ALTER COLUMN id SET DEFAULT nextval('public.account_tiers_id_seq'::regclass);


--
-- Name: account_wallets id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.account_wallets ALTER COLUMN id SET DEFAULT nextval('public.account_wallets_id_seq'::regclass);


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: deposits id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.deposits ALTER COLUMN id SET DEFAULT nextval('public.deposits_id_seq'::regclass);


--
-- Name: devices id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.devices ALTER COLUMN id SET DEFAULT nextval('public.devices_id_seq'::regclass);


--
-- Name: ledger id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.ledger ALTER COLUMN id SET DEFAULT nextval('public.ledger_id_seq'::regclass);


--
-- Name: login_events id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.login_events ALTER COLUMN id SET DEFAULT nextval('public.login_events_id_seq'::regclass);


--
-- Name: otps id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.otps ALTER COLUMN id SET DEFAULT nextval('public.otps_id_seq'::regclass);


--
-- Name: pending_email_updates id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.pending_email_updates ALTER COLUMN id SET DEFAULT nextval('public.pending_email_updates_id_seq'::regclass);


--
-- Name: positions id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.positions ALTER COLUMN id SET DEFAULT nextval('public.positions_id_seq'::regclass);


--
-- Name: rate_limit_logs id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.rate_limit_logs ALTER COLUMN id SET DEFAULT nextval('public.rate_limit_logs_id_seq'::regclass);


--
-- Name: sessions id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.sessions ALTER COLUMN id SET DEFAULT nextval('public.sessions_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: suspicious_logins id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.suspicious_logins ALTER COLUMN id SET DEFAULT nextval('public.suspicious_logins_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: wallets id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.wallets ALTER COLUMN id SET DEFAULT nextval('public.wallets_id_seq'::regclass);


--
-- Name: withdrawals id; Type: DEFAULT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.withdrawals ALTER COLUMN id SET DEFAULT nextval('public.withdrawals_id_seq'::regclass);


--
-- Data for Name: account_tiers; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.account_tiers (id, name, slug, monthly_fee_cents, withdrawal_limit_cents, created_at) FROM stdin;
1	Standard	standard	0	0	2025-11-24 22:40:31.226978+00
3	Pro	pro	2000	0	2025-11-25 22:44:56.287223+00
4	Elite	elite	5000	0	2025-11-25 22:44:56.287223+00
34	Demo	demo	0	0	2025-12-15 19:10:35.622477+00
\.


--
-- Data for Name: account_wallets; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.account_wallets (id, account_id, wallet_id, role, created_at) FROM stdin;
\.


--
-- Data for Name: accounts; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.accounts (id, user_id, tier_id, account_code, status, balance_cents, profit_cents, bot_started_at, bot_ends_at, created_at) FROM stdin;
\.


--
-- Data for Name: deposits; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.deposits (id, user_id, provider, type, amount_cents, currency, status, provider_ref, idempotency_key, meta, created_at, updated_at, swept, sweep_tx_hash, network, token, tx_hash, from_addr, to_addr, amount, confirmations, account_id, src_currency, src_amount_cents, fx_rate, fx_at) FROM stdin;
\.


--
-- Data for Name: devices; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.devices (id, user_id, fingerprint, user_agent, last_seen, ip, country, city, created_at) FROM stdin;
\.


--
-- Data for Name: ledger; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.ledger (id, user_id, account_id, type, amount_cents, ref_type, ref_id, idempotency_key, created_at) FROM stdin;
\.


--
-- Data for Name: login_events; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.login_events (id, user_id, ip, user_agent, device_fingerprint, country, city, succeeded, suspicious, reason, created_at) FROM stdin;
\.


--
-- Data for Name: otps; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.otps (id, user_id, email, code, purpose, used, expires_at, created_at, meta) FROM stdin;
\.


--
-- Data for Name: pending_email_updates; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.pending_email_updates (id, user_id, new_email, code, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: positions; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.positions (id, user_id, symbol, side, qty, entry_price, exit_price, pnl, fees, status, opened_at, closed_at, duration_sec, strategy, notes, created_at) FROM stdin;
\.


--
-- Data for Name: rate_limit_logs; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.rate_limit_logs (id, ip_address, endpoint, attempts, created_at) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.sessions (id, user_id, ip_address, user_agent, token, created_at, expires_at) FROM stdin;
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.settings (id, key, value, created_at, updated_at) FROM stdin;
1	tron	{"node": "https://api.trongrid.io"}	2025-11-24 22:40:31.226978+00	2025-11-24 22:40:31.226978+00
\.


--
-- Data for Name: suspicious_logins; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.suspicious_logins (id, user_id, ip_address, user_agent, reason, created_at) FROM stdin;
\.


--
-- Data for Name: transactions; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.transactions (id, user_id, account_id, type, amount_cents, balance_after_cents, reference, meta, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.users (id, email, referral_code, referred_by, rave_id, reward_balance, referral_earnings, otp, otp_created_at, bot_active, bot_started_at, bot_ended_at, eligible_for_withdrawal, created_at, is_verified, total_referrals, default_account_id, password_hash, total_earnings, deleted_at, email_verified, last_login_at, last_login_ip) FROM stdin;
\.


--
-- Data for Name: wallets; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.wallets (id, account_id, network, address, private_key, created_at, updated_at, user_id) FROM stdin;
\.


--
-- Data for Name: withdrawals; Type: TABLE DATA; Schema: public; Owner: uc001spkeri80k
--

COPY public.withdrawals (id, account_id, amount_cents, currency, status, provider_ref, created_at, updated_at, tx_hash, idempotency_key) FROM stdin;
\.


--
-- Name: account_tiers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.account_tiers_id_seq', 66, true);


--
-- Name: account_wallets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.account_wallets_id_seq', 1, false);


--
-- Name: accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.accounts_id_seq', 1, false);


--
-- Name: deposits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.deposits_id_seq', 1, false);


--
-- Name: devices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.devices_id_seq', 1, false);


--
-- Name: ledger_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.ledger_id_seq', 1, false);


--
-- Name: login_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.login_events_id_seq', 1, false);


--
-- Name: otps_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.otps_id_seq', 1, false);


--
-- Name: pending_email_updates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.pending_email_updates_id_seq', 1, false);


--
-- Name: positions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.positions_id_seq', 1, false);


--
-- Name: rate_limit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.rate_limit_logs_id_seq', 1, false);


--
-- Name: sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.sessions_id_seq', 1, false);


--
-- Name: settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.settings_id_seq', 33, true);


--
-- Name: suspicious_logins_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.suspicious_logins_id_seq', 1, false);


--
-- Name: transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.transactions_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.users_id_seq', 1, false);


--
-- Name: wallets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.wallets_id_seq', 1, false);


--
-- Name: withdrawals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: uc001spkeri80k
--

SELECT pg_catalog.setval('public.withdrawals_id_seq', 1, false);


--
-- Name: account_tiers account_tiers_name_key; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.account_tiers
    ADD CONSTRAINT account_tiers_name_key UNIQUE (name);


--
-- Name: account_tiers account_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.account_tiers
    ADD CONSTRAINT account_tiers_pkey PRIMARY KEY (id);


--
-- Name: account_tiers account_tiers_slug_key; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.account_tiers
    ADD CONSTRAINT account_tiers_slug_key UNIQUE (slug);


--
-- Name: account_wallets account_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.account_wallets
    ADD CONSTRAINT account_wallets_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_account_code_key; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_account_code_key UNIQUE (account_code);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: deposits deposits_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: deposits deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_pkey PRIMARY KEY (id);


--
-- Name: deposits deposits_provider_ref_key; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_provider_ref_key UNIQUE (provider_ref);


--
-- Name: deposits deposits_tx_hash_key; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_tx_hash_key UNIQUE (tx_hash);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: devices devices_user_id_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_fingerprint_key UNIQUE (user_id, fingerprint);


--
-- Name: ledger ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.ledger
    ADD CONSTRAINT ledger_pkey PRIMARY KEY (id);


--
-- Name: login_events login_events_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.login_events
    ADD CONSTRAINT login_events_pkey PRIMARY KEY (id);


--
-- Name: otps otps_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.otps
    ADD CONSTRAINT otps_pkey PRIMARY KEY (id);


--
-- Name: pending_email_updates pending_email_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.pending_email_updates
    ADD CONSTRAINT pending_email_updates_pkey PRIMARY KEY (id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_logs rate_limit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.rate_limit_logs
    ADD CONSTRAINT rate_limit_logs_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: settings settings_key_key; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_key_key UNIQUE (key);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: suspicious_logins suspicious_logins_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.suspicious_logins
    ADD CONSTRAINT suspicious_logins_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_address_key; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_address_key UNIQUE (address);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: withdrawals withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_pkey PRIMARY KEY (id);


--
-- Name: idx_accounts_user_id; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_accounts_user_id ON public.accounts USING btree (user_id);


--
-- Name: idx_deposits_user_status; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_deposits_user_status ON public.deposits USING btree (user_id, status);


--
-- Name: idx_devices_user_id; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_devices_user_id ON public.devices USING btree (user_id);


--
-- Name: idx_ledger_account; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_ledger_account ON public.ledger USING btree (account_id);


--
-- Name: idx_ledger_created; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_ledger_created ON public.ledger USING btree (created_at);


--
-- Name: idx_ledger_user; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_ledger_user ON public.ledger USING btree (user_id);


--
-- Name: idx_otps_email_code; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_otps_email_code ON public.otps USING btree (email, code);


--
-- Name: idx_otps_purpose; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_otps_purpose ON public.otps USING btree (purpose);


--
-- Name: idx_rate_limit_ip; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_rate_limit_ip ON public.rate_limit_logs USING btree (ip_address);


--
-- Name: idx_sessions_user_id; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);


--
-- Name: idx_suspicious_user; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_suspicious_user ON public.suspicious_logins USING btree (user_id);


--
-- Name: idx_tx_account; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_tx_account ON public.transactions USING btree (account_id);


--
-- Name: idx_tx_user; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE INDEX idx_tx_user ON public.transactions USING btree (user_id);


--
-- Name: idx_withdrawals_tx_hash; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE UNIQUE INDEX idx_withdrawals_tx_hash ON public.withdrawals USING btree (tx_hash) WHERE (tx_hash IS NOT NULL);


--
-- Name: uniq_deposit_idempo; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE UNIQUE INDEX uniq_deposit_idempo ON public.deposits USING btree (account_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uniq_ledger_idempo; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE UNIQUE INDEX uniq_ledger_idempo ON public.ledger USING btree (account_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uniq_withdraw_idempo; Type: INDEX; Schema: public; Owner: uc001spkeri80k
--

CREATE UNIQUE INDEX uniq_withdraw_idempo ON public.withdrawals USING btree (account_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: account_wallets account_wallets_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.account_wallets
    ADD CONSTRAINT account_wallets_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: account_wallets account_wallets_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.account_wallets
    ADD CONSTRAINT account_wallets_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON DELETE CASCADE;


--
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: deposits deposits_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: deposits deposits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: devices devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: login_events login_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.login_events
    ADD CONSTRAINT login_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: otps otps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.otps
    ADD CONSTRAINT otps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pending_email_updates pending_email_updates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.pending_email_updates
    ADD CONSTRAINT pending_email_updates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: positions positions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: suspicious_logins suspicious_logins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.suspicious_logins
    ADD CONSTRAINT suspicious_logins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: wallets wallets_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: withdrawals withdrawals_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uc001spkeri80k
--

ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: uc001spkeri80k
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;


--
-- Name: extension_before_drop; Type: EVENT TRIGGER; Schema: -; Owner: heroku_admin
--

CREATE EVENT TRIGGER extension_before_drop ON ddl_command_start
   EXECUTE FUNCTION _heroku.extension_before_drop();


ALTER EVENT TRIGGER extension_before_drop OWNER TO heroku_admin;

--
-- Name: log_create_ext; Type: EVENT TRIGGER; Schema: -; Owner: heroku_admin
--

CREATE EVENT TRIGGER log_create_ext ON ddl_command_end
   EXECUTE FUNCTION _heroku.create_ext();


ALTER EVENT TRIGGER log_create_ext OWNER TO heroku_admin;

--
-- Name: log_drop_ext; Type: EVENT TRIGGER; Schema: -; Owner: heroku_admin
--

CREATE EVENT TRIGGER log_drop_ext ON sql_drop
   EXECUTE FUNCTION _heroku.drop_ext();


ALTER EVENT TRIGGER log_drop_ext OWNER TO heroku_admin;

--
-- Name: validate_extension; Type: EVENT TRIGGER; Schema: -; Owner: heroku_admin
--

CREATE EVENT TRIGGER validate_extension ON ddl_command_end
   EXECUTE FUNCTION _heroku.validate_extension();


ALTER EVENT TRIGGER validate_extension OWNER TO heroku_admin;

--
-- PostgreSQL database dump complete
--

\unrestrict pESY9s2TRkUYF6UgBJAEEGskDhmpEp85fqdkGg4JgnKzH4nFrOooUCMtYLBxf7t

