-- Free-to-play prediction game. Points have no cash value.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS line_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_group_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by_admin_id UUID NOT NULL REFERENCES admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL UNIQUE,
  public_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  points BIGINT NOT NULL DEFAULT 0 CHECK (points >= 0),
  last_daily_bonus_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_players (
  group_id UUID NOT NULL REFERENCES line_groups(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, player_id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES line_groups(id) ON DELETE RESTRICT,
  round_no INTEGER NOT NULL CHECK (round_no > 0),
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLOSED', 'RESOLVED', 'CANCELLED')),
  winning_option_no SMALLINT,
  created_by_admin_id UUID NOT NULL REFERENCES admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  UNIQUE (group_id, round_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_live_round_per_group
  ON rounds(group_id) WHERE status IN ('OPEN', 'CLOSED');

CREATE TABLE IF NOT EXISTS round_options (
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  option_no SMALLINT NOT NULL CHECK (option_no BETWEEN 1 AND 6),
  label TEXT NOT NULL,
  multiplier_tenths SMALLINT NOT NULL CHECK (multiplier_tenths BETWEEN 11 AND 100),
  PRIMARY KEY (round_id, option_no)
);

CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  option_no SMALLINT NOT NULL,
  multiplier_tenths SMALLINT NOT NULL,
  stake_points BIGINT NOT NULL CHECK (stake_points > 0),
  reward_points BIGINT,
  line_message_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PLACED'
    CHECK (status IN ('PLACED', 'WON', 'LOST', 'REFUNDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (round_id, player_id),
  FOREIGN KEY (round_id, option_no) REFERENCES round_options(round_id, option_no)
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  round_id UUID REFERENCES rounds(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('STARTING', 'DAILY_BONUS', 'STAKE', 'REWARD', 'REFUND')),
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_ledger_player ON point_ledger(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admins(id),
  group_id UUID REFERENCES line_groups(id),
  round_id UUID REFERENCES rounds(id),
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PROCESSING'
    CHECK (status IN ('PROCESSING', 'PROCESSED', 'FAILED')),
  payload JSONB NOT NULL,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

COMMIT;
