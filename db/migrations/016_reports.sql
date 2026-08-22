-- 016_reports.sql — Report & Moderation system (FEAT-8.5, #330).
--
-- Members can report content (profiles, items, reviews, comments) for
-- moderator review. Reports are private and auditable. Moderators have
-- least-privilege permissions (separate from admin).
--
-- Design:
--   - Reports are PRIVATE: only the reporter and moderators can see them.
--   - `target_type` identifies what kind of content is being reported
--     (profile, item, review, comment).
--   - `target_id` is the id of the reported content.
--   - `reason` is a free-text explanation from the reporter.
--   - `status` tracks the moderation workflow: open → under_review →
--     resolved | dismissed.
--   - `action_taken` records what the moderator did (e.g. 'content_hidden',
--     'user_warned', 'user_blocked', 'none').
--   - `moderator_id` records who handled the report.
--   - `moderator_note` is the moderator's internal note (never exposed).
--   - Reports are immutable after resolution (status cannot be changed back).
--   - Account deletion removes the reporter's association (anonymizes).

CREATE TABLE reports (
  id              uuid PRIMARY KEY,
  reporter_id     text NOT NULL,          -- the member who filed the report
  target_type     text NOT NULL,          -- 'profile' | 'item' | 'review' | 'comment'
  target_id       text NOT NULL,          -- id of the reported content
  reason          text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  status          text NOT NULL DEFAULT 'open',  -- open|under_review|resolved|dismissed
  action_taken    text NOT NULL DEFAULT '',       -- content_hidden|user_warned|user_blocked|none
  moderator_id    text NOT NULL DEFAULT '',       -- who handled it
  moderator_note  text NOT NULL DEFAULT '',       -- internal note (never exposed)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reports_status_check
    CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed')),
  CONSTRAINT reports_action_check
    CHECK (action_taken IN ('', 'content_hidden', 'user_warned', 'user_blocked', 'none'))
);

-- Moderation queue: open reports first, newest first.
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);
-- Lookup: all reports about a specific target.
CREATE INDEX reports_target_idx ON reports (target_type, target_id);
-- Cleanup: reports by a specific reporter.
CREATE INDEX reports_reporter_idx ON reports (reporter_id);