-- Create borrow_slips table
CREATE TABLE IF NOT EXISTS borrow_slips (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patron_id uuid NOT NULL,
  borrow_at timestamp DEFAULT CURRENT_TIMESTAMP,
  due_at timestamp NOT NULL,
  status varchar(20) DEFAULT 'active',
  created_by_user_id uuid,
  created_by_email varchar(255),
  total_items int DEFAULT 0,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_borrow_slips_patron_status ON borrow_slips(patron_id, status);

-- Add slip_id to borrow_records
ALTER TABLE borrow_records ADD COLUMN IF NOT EXISTS slip_id uuid REFERENCES borrow_slips(id);
CREATE INDEX IF NOT EXISTS idx_borrow_records_slip ON borrow_records(slip_id);
