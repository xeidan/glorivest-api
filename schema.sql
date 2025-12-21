--
-- PostgreSQL database dump
--

\restrict ZrpIaWwBeKcaclZ4Y253hBtUC8pDcLaXafhULLT3jWJ82s1dKmXEVWuldCSCrGL

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.7 (Homebrew)

-- Started on 2025-12-21 12:26:33 WAT

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
-- TOC entry 6 (class 2615 OID 5721162)
-- Name: _heroku; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA _heroku;


--
-- TOC entry 5 (class 2615 OID 925237234)
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- TOC entry 4554 (class 0 OID 0)
-- Dependencies: 5
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- TOC entry 254 (class 1255 OID 5721164)
-- Name: create_ext(); Type: FUNCTION; Schema: _heroku; Owner: -
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


--
-- TOC entry 267 (class 1255 OID 5721165)
-- Name: drop_ext(); Type: FUNCTION; Schema: _heroku; Owner: -
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


--
-- TOC entry 268 (class 1255 OID 5721166)
-- Name: extension_before_drop(); Type: FUNCTION; Schema: _heroku; Owner: -
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


--
-- TOC entry 269 (class 1255 OID 5721167)
-- Name: grant_table_if_exists(text, text, text, text); Type: FUNCTION; Schema: _heroku; Owner: -
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


--
-- TOC entry 270 (class 1255 OID 5721168)
-- Name: postgis_after_create(); Type: FUNCTION; Schema: _heroku; Owner: -
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


--
-- TOC entry 271 (class 1255 OID 5721169)
-- Name: validate_extension(); Type: FUNCTION; Schema: _heroku; Owner: -
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


--
-- TOC entry 255 (class 1255 OID 925250470)
-- Name: validate_search_path(); Type: FUNCTION; Schema: _heroku; Owner: -
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 229 (class 1259 OID 925238621)
-- Name: account_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_tiers (
    id integer NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    monthly_fee_cents bigint DEFAULT 0,
    withdrawal_limit_cents bigint DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 228 (class 1259 OID 925238620)
-- Name: account_tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.account_tiers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4555 (class 0 OID 0)
-- Dependencies: 228
-- Name: account_tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.account_tiers_id_seq OWNED BY public.account_tiers.id;


--
-- TOC entry 235 (class 1259 OID 925238670)
-- Name: account_wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_wallets (
    id integer NOT NULL,
    account_id integer NOT NULL,
    wallet_id bigint NOT NULL,
    role text DEFAULT 'primary'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 234 (class 1259 OID 925238669)
-- Name: account_wallets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.account_wallets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4556 (class 0 OID 0)
-- Dependencies: 234
-- Name: account_wallets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.account_wallets_id_seq OWNED BY public.account_wallets.id;


--
-- TOC entry 221 (class 1259 OID 925237271)
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 220 (class 1259 OID 925237270)
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4557 (class 0 OID 0)
-- Dependencies: 220
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- TOC entry 223 (class 1259 OID 925237307)
-- Name: deposits; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 222 (class 1259 OID 925237306)
-- Name: deposits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deposits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4558 (class 0 OID 0)
-- Dependencies: 222
-- Name: deposits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deposits_id_seq OWNED BY public.deposits.id;


--
-- TOC entry 241 (class 1259 OID 925288966)
-- Name: devices; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 240 (class 1259 OID 925288965)
-- Name: devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4559 (class 0 OID 0)
-- Dependencies: 240
-- Name: devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.devices_id_seq OWNED BY public.devices.id;


--
-- TOC entry 253 (class 1259 OID 928530685)
-- Name: ledger; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 252 (class 1259 OID 928530684)
-- Name: ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4560 (class 0 OID 0)
-- Dependencies: 252
-- Name: ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ledger_id_seq OWNED BY public.ledger.id;


--
-- TOC entry 239 (class 1259 OID 925288949)
-- Name: login_events; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 238 (class 1259 OID 925288948)
-- Name: login_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4561 (class 0 OID 0)
-- Dependencies: 238
-- Name: login_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_events_id_seq OWNED BY public.login_events.id;


--
-- TOC entry 237 (class 1259 OID 925242886)
-- Name: otps; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 236 (class 1259 OID 925242885)
-- Name: otps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.otps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4562 (class 0 OID 0)
-- Dependencies: 236
-- Name: otps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.otps_id_seq OWNED BY public.otps.id;


--
-- TOC entry 243 (class 1259 OID 925293278)
-- Name: pending_email_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_email_updates (
    id integer NOT NULL,
    user_id integer NOT NULL,
    new_email character varying(255) NOT NULL,
    code character varying(10) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 242 (class 1259 OID 925293277)
-- Name: pending_email_updates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pending_email_updates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4563 (class 0 OID 0)
-- Dependencies: 242
-- Name: pending_email_updates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pending_email_updates_id_seq OWNED BY public.pending_email_updates.id;


--
-- TOC entry 225 (class 1259 OID 925237337)
-- Name: positions; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 224 (class 1259 OID 925237336)
-- Name: positions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.positions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4564 (class 0 OID 0)
-- Dependencies: 224
-- Name: positions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.positions_id_seq OWNED BY public.positions.id;


--
-- TOC entry 249 (class 1259 OID 925293330)
-- Name: rate_limit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_logs (
    id integer NOT NULL,
    ip_address text NOT NULL,
    endpoint text NOT NULL,
    attempts integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 248 (class 1259 OID 925293329)
-- Name: rate_limit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_limit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4565 (class 0 OID 0)
-- Dependencies: 248
-- Name: rate_limit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_limit_logs_id_seq OWNED BY public.rate_limit_logs.id;


--
-- TOC entry 245 (class 1259 OID 925293291)
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 244 (class 1259 OID 925293290)
-- Name: sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4566 (class 0 OID 0)
-- Dependencies: 244
-- Name: sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sessions_id_seq OWNED BY public.sessions.id;


--
-- TOC entry 231 (class 1259 OID 925238637)
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id integer NOT NULL,
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 230 (class 1259 OID 925238636)
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4567 (class 0 OID 0)
-- Dependencies: 230
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- TOC entry 247 (class 1259 OID 925293311)
-- Name: suspicious_logins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suspicious_logins (
    id integer NOT NULL,
    user_id integer NOT NULL,
    ip_address text,
    user_agent text,
    reason text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 246 (class 1259 OID 925293310)
-- Name: suspicious_logins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suspicious_logins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4568 (class 0 OID 0)
-- Dependencies: 246
-- Name: suspicious_logins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suspicious_logins_id_seq OWNED BY public.suspicious_logins.id;


--
-- TOC entry 251 (class 1259 OID 928443784)
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 250 (class 1259 OID 928443783)
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4569 (class 0 OID 0)
-- Dependencies: 250
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- TOC entry 219 (class 1259 OID 925237252)
-- Name: users; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 218 (class 1259 OID 925237251)
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4570 (class 0 OID 0)
-- Dependencies: 218
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- TOC entry 233 (class 1259 OID 925238651)
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 232 (class 1259 OID 925238650)
-- Name: wallets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4571 (class 0 OID 0)
-- Dependencies: 232
-- Name: wallets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wallets_id_seq OWNED BY public.wallets.id;


--
-- TOC entry 227 (class 1259 OID 925237358)
-- Name: withdrawals; Type: TABLE; Schema: public; Owner: -
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


--
-- TOC entry 226 (class 1259 OID 925237357)
-- Name: withdrawals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.withdrawals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 4572 (class 0 OID 0)
-- Dependencies: 226
-- Name: withdrawals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.withdrawals_id_seq OWNED BY public.withdrawals.id;


--
-- TOC entry 4274 (class 2604 OID 925238624)
-- Name: account_tiers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_tiers ALTER COLUMN id SET DEFAULT nextval('public.account_tiers_id_seq'::regclass);


--
-- TOC entry 4285 (class 2604 OID 925238673)
-- Name: account_wallets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_wallets ALTER COLUMN id SET DEFAULT nextval('public.account_wallets_id_seq'::regclass);


--
-- TOC entry 4254 (class 2604 OID 925237274)
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- TOC entry 4259 (class 2604 OID 925237310)
-- Name: deposits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits ALTER COLUMN id SET DEFAULT nextval('public.deposits_id_seq'::regclass);


--
-- TOC entry 4295 (class 2604 OID 925288969)
-- Name: devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices ALTER COLUMN id SET DEFAULT nextval('public.devices_id_seq'::regclass);


--
-- TOC entry 4310 (class 2604 OID 928530688)
-- Name: ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger ALTER COLUMN id SET DEFAULT nextval('public.ledger_id_seq'::regclass);


--
-- TOC entry 4291 (class 2604 OID 925288952)
-- Name: login_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_events ALTER COLUMN id SET DEFAULT nextval('public.login_events_id_seq'::regclass);


--
-- TOC entry 4288 (class 2604 OID 925242889)
-- Name: otps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otps ALTER COLUMN id SET DEFAULT nextval('public.otps_id_seq'::regclass);


--
-- TOC entry 4298 (class 2604 OID 925293281)
-- Name: pending_email_updates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_email_updates ALTER COLUMN id SET DEFAULT nextval('public.pending_email_updates_id_seq'::regclass);


--
-- TOC entry 4265 (class 2604 OID 925237340)
-- Name: positions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions ALTER COLUMN id SET DEFAULT nextval('public.positions_id_seq'::regclass);


--
-- TOC entry 4304 (class 2604 OID 925293333)
-- Name: rate_limit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_logs ALTER COLUMN id SET DEFAULT nextval('public.rate_limit_logs_id_seq'::regclass);


--
-- TOC entry 4300 (class 2604 OID 925293294)
-- Name: sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions ALTER COLUMN id SET DEFAULT nextval('public.sessions_id_seq'::regclass);


--
-- TOC entry 4278 (class 2604 OID 925238640)
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- TOC entry 4302 (class 2604 OID 925293314)
-- Name: suspicious_logins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspicious_logins ALTER COLUMN id SET DEFAULT nextval('public.suspicious_logins_id_seq'::regclass);


--
-- TOC entry 4307 (class 2604 OID 928443787)
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- TOC entry 4244 (class 2604 OID 925237255)
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- TOC entry 4282 (class 2604 OID 925238654)
-- Name: wallets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets ALTER COLUMN id SET DEFAULT nextval('public.wallets_id_seq'::regclass);


--
-- TOC entry 4271 (class 2604 OID 925237361)
-- Name: withdrawals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawals ALTER COLUMN id SET DEFAULT nextval('public.withdrawals_id_seq'::regclass);


--
-- TOC entry 4341 (class 2606 OID 925238633)
-- Name: account_tiers account_tiers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_tiers
    ADD CONSTRAINT account_tiers_name_key UNIQUE (name);


--
-- TOC entry 4343 (class 2606 OID 925238631)
-- Name: account_tiers account_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_tiers
    ADD CONSTRAINT account_tiers_pkey PRIMARY KEY (id);


--
-- TOC entry 4345 (class 2606 OID 925238635)
-- Name: account_tiers account_tiers_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_tiers
    ADD CONSTRAINT account_tiers_slug_key UNIQUE (slug);


--
-- TOC entry 4355 (class 2606 OID 925238679)
-- Name: account_wallets account_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_wallets
    ADD CONSTRAINT account_wallets_pkey PRIMARY KEY (id);


--
-- TOC entry 4320 (class 2606 OID 925237284)
-- Name: accounts accounts_account_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_account_code_key UNIQUE (account_code);


--
-- TOC entry 4322 (class 2606 OID 925237282)
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- TOC entry 4325 (class 2606 OID 925237323)
-- Name: deposits deposits_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_idempotency_key_key UNIQUE (idempotency_key);


--
-- TOC entry 4327 (class 2606 OID 925237319)
-- Name: deposits deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_pkey PRIMARY KEY (id);


--
-- TOC entry 4329 (class 2606 OID 925237321)
-- Name: deposits deposits_provider_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_provider_ref_key UNIQUE (provider_ref);


--
-- TOC entry 4331 (class 2606 OID 925237325)
-- Name: deposits deposits_tx_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_tx_hash_key UNIQUE (tx_hash);


--
-- TOC entry 4363 (class 2606 OID 925288975)
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- TOC entry 4365 (class 2606 OID 925288977)
-- Name: devices devices_user_id_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_fingerprint_key UNIQUE (user_id, fingerprint);


--
-- TOC entry 4386 (class 2606 OID 928530693)
-- Name: ledger ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger
    ADD CONSTRAINT ledger_pkey PRIMARY KEY (id);


--
-- TOC entry 4361 (class 2606 OID 925288959)
-- Name: login_events login_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_events
    ADD CONSTRAINT login_events_pkey PRIMARY KEY (id);


--
-- TOC entry 4359 (class 2606 OID 925242895)
-- Name: otps otps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otps
    ADD CONSTRAINT otps_pkey PRIMARY KEY (id);


--
-- TOC entry 4368 (class 2606 OID 925293284)
-- Name: pending_email_updates pending_email_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_email_updates
    ADD CONSTRAINT pending_email_updates_pkey PRIMARY KEY (id);


--
-- TOC entry 4335 (class 2606 OID 925237351)
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- TOC entry 4377 (class 2606 OID 925293339)
-- Name: rate_limit_logs rate_limit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_logs
    ADD CONSTRAINT rate_limit_logs_pkey PRIMARY KEY (id);


--
-- TOC entry 4371 (class 2606 OID 925293299)
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- TOC entry 4347 (class 2606 OID 925238649)
-- Name: settings settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_key_key UNIQUE (key);


--
-- TOC entry 4349 (class 2606 OID 925238647)
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- TOC entry 4374 (class 2606 OID 925293319)
-- Name: suspicious_logins suspicious_logins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspicious_logins
    ADD CONSTRAINT suspicious_logins_pkey PRIMARY KEY (id);


--
-- TOC entry 4381 (class 2606 OID 928443793)
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- TOC entry 4316 (class 2606 OID 925237269)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 4318 (class 2606 OID 925237267)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 4351 (class 2606 OID 925238662)
-- Name: wallets wallets_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_address_key UNIQUE (address);


--
-- TOC entry 4353 (class 2606 OID 925238660)
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- TOC entry 4339 (class 2606 OID 925237367)
-- Name: withdrawals withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_pkey PRIMARY KEY (id);


--
-- TOC entry 4323 (class 1259 OID 925238696)
-- Name: idx_accounts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_user_id ON public.accounts USING btree (user_id);


--
-- TOC entry 4332 (class 1259 OID 925238697)
-- Name: idx_deposits_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deposits_user_status ON public.deposits USING btree (user_id, status);


--
-- TOC entry 4366 (class 1259 OID 925293226)
-- Name: idx_devices_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_user_id ON public.devices USING btree (user_id);


--
-- TOC entry 4382 (class 1259 OID 928530696)
-- Name: idx_ledger_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_account ON public.ledger USING btree (account_id);


--
-- TOC entry 4383 (class 1259 OID 928530697)
-- Name: idx_ledger_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_created ON public.ledger USING btree (created_at);


--
-- TOC entry 4384 (class 1259 OID 928530694)
-- Name: idx_ledger_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_user ON public.ledger USING btree (user_id);


--
-- TOC entry 4356 (class 1259 OID 925293218)
-- Name: idx_otps_email_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otps_email_code ON public.otps USING btree (email, code);


--
-- TOC entry 4357 (class 1259 OID 925293258)
-- Name: idx_otps_purpose; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otps_purpose ON public.otps USING btree (purpose);


--
-- TOC entry 4375 (class 1259 OID 925293340)
-- Name: idx_rate_limit_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limit_ip ON public.rate_limit_logs USING btree (ip_address);


--
-- TOC entry 4369 (class 1259 OID 925293305)
-- Name: idx_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);


--
-- TOC entry 4372 (class 1259 OID 925293325)
-- Name: idx_suspicious_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suspicious_user ON public.suspicious_logins USING btree (user_id);


--
-- TOC entry 4378 (class 1259 OID 928443804)
-- Name: idx_tx_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_account ON public.transactions USING btree (account_id);


--
-- TOC entry 4379 (class 1259 OID 928443805)
-- Name: idx_tx_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_user ON public.transactions USING btree (user_id);


--
-- TOC entry 4336 (class 1259 OID 925238691)
-- Name: idx_withdrawals_tx_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_withdrawals_tx_hash ON public.withdrawals USING btree (tx_hash) WHERE (tx_hash IS NOT NULL);


--
-- TOC entry 4333 (class 1259 OID 928527204)
-- Name: uniq_deposit_idempo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_deposit_idempo ON public.deposits USING btree (account_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- TOC entry 4387 (class 1259 OID 928530699)
-- Name: uniq_ledger_idempo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_ledger_idempo ON public.ledger USING btree (account_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- TOC entry 4337 (class 1259 OID 928527200)
-- Name: uniq_withdraw_idempo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_withdraw_idempo ON public.withdrawals USING btree (account_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- TOC entry 4394 (class 2606 OID 925238680)
-- Name: account_wallets account_wallets_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_wallets
    ADD CONSTRAINT account_wallets_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- TOC entry 4395 (class 2606 OID 925238685)
-- Name: account_wallets account_wallets_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_wallets
    ADD CONSTRAINT account_wallets_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON DELETE CASCADE;


--
-- TOC entry 4388 (class 2606 OID 925237285)
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4389 (class 2606 OID 925237331)
-- Name: deposits deposits_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- TOC entry 4390 (class 2606 OID 925237326)
-- Name: deposits deposits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 4398 (class 2606 OID 925288978)
-- Name: devices devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4397 (class 2606 OID 925288960)
-- Name: login_events login_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_events
    ADD CONSTRAINT login_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 4396 (class 2606 OID 925242896)
-- Name: otps otps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otps
    ADD CONSTRAINT otps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4399 (class 2606 OID 925293285)
-- Name: pending_email_updates pending_email_updates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_email_updates
    ADD CONSTRAINT pending_email_updates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4391 (class 2606 OID 925237352)
-- Name: positions positions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4400 (class 2606 OID 925293300)
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4401 (class 2606 OID 925293320)
-- Name: suspicious_logins suspicious_logins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspicious_logins
    ADD CONSTRAINT suspicious_logins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4402 (class 2606 OID 928443799)
-- Name: transactions transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- TOC entry 4403 (class 2606 OID 928443794)
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 4393 (class 2606 OID 925238663)
-- Name: wallets wallets_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- TOC entry 4392 (class 2606 OID 925237368)
-- Name: withdrawals withdrawals_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- TOC entry 4240 (class 3466 OID 5721171)
-- Name: extension_before_drop; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER extension_before_drop ON ddl_command_start
   EXECUTE FUNCTION _heroku.extension_before_drop();


--
-- TOC entry 4241 (class 3466 OID 5721172)
-- Name: log_create_ext; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER log_create_ext ON ddl_command_end
   EXECUTE FUNCTION _heroku.create_ext();


--
-- TOC entry 4242 (class 3466 OID 5721173)
-- Name: log_drop_ext; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER log_drop_ext ON sql_drop
   EXECUTE FUNCTION _heroku.drop_ext();


--
-- TOC entry 4243 (class 3466 OID 5721175)
-- Name: validate_extension; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER validate_extension ON ddl_command_end
   EXECUTE FUNCTION _heroku.validate_extension();


-- Completed on 2025-12-21 12:27:02 WAT

--
-- PostgreSQL database dump complete
--

\unrestrict ZrpIaWwBeKcaclZ4Y253hBtUC8pDcLaXafhULLT3jWJ82s1dKmXEVWuldCSCrGL

