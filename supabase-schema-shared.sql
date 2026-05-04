-- Shared expense groups
CREATE TABLE IF NOT EXISTS shared_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'general',
  invite_code TEXT UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'UYU',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Members of each group
CREATE TABLE IF NOT EXISTS shared_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES shared_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

-- Expenses inside a group
CREATE TABLE IF NOT EXISTS shared_group_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES shared_groups(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UYU',
  member_count INT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial payments against a specific expense
CREATE TABLE IF NOT EXISTS shared_expense_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES shared_group_expenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE shared_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_group_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_expense_payments ENABLE ROW LEVEL SECURITY;

-- shared_groups: visible to members
CREATE POLICY "members can view group" ON shared_groups
  FOR SELECT USING (
    id IN (SELECT group_id FROM shared_group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "authenticated can create group" ON shared_groups
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "creator can update group" ON shared_groups
  FOR UPDATE USING (created_by = auth.uid());

CREATE POLICY "creator can delete group" ON shared_groups
  FOR DELETE USING (created_by = auth.uid());

-- shared_group_members
CREATE POLICY "members can view members" ON shared_group_members
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM shared_group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "authenticated can join" ON shared_group_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "member can leave" ON shared_group_members
  FOR DELETE USING (user_id = auth.uid());

-- shared_group_expenses
CREATE POLICY "members can view expenses" ON shared_group_expenses
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM shared_group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "members can add expense" ON shared_group_expenses
  FOR INSERT WITH CHECK (
    created_by = auth.uid() AND
    group_id IN (SELECT group_id FROM shared_group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "creator can delete expense" ON shared_group_expenses
  FOR DELETE USING (created_by = auth.uid());

-- shared_expense_payments
CREATE POLICY "members can view payments" ON shared_expense_payments
  FOR SELECT USING (
    expense_id IN (
      SELECT e.id FROM shared_group_expenses e
      JOIN shared_group_members m ON m.group_id = e.group_id
      WHERE m.user_id = auth.uid()
    )
  );

CREATE POLICY "authenticated can add payment" ON shared_expense_payments
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    expense_id IN (
      SELECT e.id FROM shared_group_expenses e
      JOIN shared_group_members m ON m.group_id = e.group_id
      WHERE m.user_id = auth.uid()
    )
  );

CREATE POLICY "payer can delete payment" ON shared_expense_payments
  FOR DELETE USING (user_id = auth.uid());
