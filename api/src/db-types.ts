export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  created_at: string;
  updated_at: string;
}

export interface HouseholdRow {
  id: number;
  name: string;
  created_at: string;
}

export interface BabyRow {
  id: number;
  household_id: number;
  name: string;
  birth_date: string;
  gender: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedingRow {
  id: number;
  baby_id: number;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  amount: number | null;
  type: string;
  side: string | null;
  notes: string | null;
  created_at: string;
}

export interface DiaperRow {
  id: number;
  baby_id: number;
  change_time: string;
  type: string;
  color: string | null;
  consistency: string | null;
  notes: string | null;
  created_at: string;
}

export interface SleepRow {
  id: number;
  baby_id: number;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  location: string | null;
  notes: string | null;
  created_at: string;
}

export interface GrowthRow {
  id: number;
  baby_id: number;
  measurement_date: string;
  weight: number | null;
  height: number | null;
  head_circumference: number | null;
  bmi: number | null;
  unit_system: string;
  notes: string | null;
  created_at: string;
}

export interface MilestoneRow {
  id: number;
  baby_id: number;
  title: string;
  description: string | null;
  achieved_date: string;
  category: string | null;
  created_at: string;
}

export interface VaccinationRow {
  id: number;
  baby_id: number;
  name: string;
  date_given: string | null;
  next_due_date: string | null;
  administered_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface FeedingAggRow {
  total_feedings: number;
  avg_amount: number;
  avg_duration: number;
  breast_feedings: number;
  formula_feedings: number;
  solid_feedings: number;
}

export interface SleepAggRow {
  total_sleep_periods: number;
  avg_duration: number;
  total_duration: number;
}

export interface DiaperAggRow {
  total_changes: number;
  wet_changes: number;
  dirty_changes: number;
  both_changes: number;
}

export type GrowthWithBabyRow = GrowthRow & {
  birth_date: string;
  gender: string | null;
};

export interface MoodRow {
  id: number;
  baby_id: number;
  mood: string;
  recorded_at: string;
  notes: string | null;
  created_at: string;
}

export interface JournalEntryRow {
  id: number;
  baby_id: number;
  title: string | null;
  body: string | null;
  entry_date: string | null;
  created_at: string;
}