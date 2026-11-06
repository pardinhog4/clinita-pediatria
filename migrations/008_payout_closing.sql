ALTER TABLE payout_reviews ALTER COLUMN confirmed_by DROP NOT NULL,ALTER COLUMN confirmed_at DROP NOT NULL,ALTER COLUMN confirmed_at DROP DEFAULT,ADD COLUMN sent_by uuid REFERENCES users(id),ADD COLUMN sent_at timestamptz,ADD COLUMN contest_reason text;
ALTER TABLE payout_adjustments ADD COLUMN period_from date,ADD COLUMN period_to date;
