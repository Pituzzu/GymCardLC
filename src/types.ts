export interface Member {
  id: string;
  name: string;
  card: string;
  birth_date: string;
  weekly_frequency: number;
  price: number;
  email: string;
  phone: string;
  subscription_expiry?: string;
  available_recoveries?: number;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  member_id: string;
  name: string;
  check_in: string;
  check_out: string | null;
}

export interface Stats {
  totalMembers: number;
  activeNow: number;
  todayCount: number;
}
