CREATE TABLE IF NOT EXISTS committee_proposals (
  committee_code TEXT NOT NULL REFERENCES committee_forms(code),
  id TEXT NOT NULL,
  voting_round INTEGER NOT NULL CHECK (voting_round >= 0),
  proposal_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (committee_code, id),
  UNIQUE (committee_code, voting_round)
);

CREATE INDEX IF NOT EXISTS committee_proposals_created
  ON committee_proposals (committee_code, voting_round DESC);
