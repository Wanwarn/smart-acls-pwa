export type RhythmType = 'VF' | 'pVT' | 'Asystole' | 'PEA' | 'ROSC' | null;
export type CodeStatus = 'IDLE' | 'ACTIVE' | 'POST_CODE';
export type LogType = 'med' | 'shock' | 'rhythm' | 'procedure' | 'info' | 'lab';

export interface LogItem {
  id: string;
  time: string; // MM:SS relative to start
  action: string;
  detail?: string;
  type: LogType;
  timestamp: number; // Absolute timestamp for sorting if needed
}

export interface MedicationState {
  adrenalineCount: number;
  lastAdrenalineTime: number | null;
  amioCount: number; // 0=None, 1=300mg given, 2=150mg given
  lidoCount: number;
}

export interface AppState {
  status: CodeStatus;
  startTime: number | null;
  cprStartTime: number | null;
  currentRhythm: RhythmType;
  logs: LogItem[];
  meds: MedicationState;
  airway: 'Basic' | 'Advanced';
  shockEnergy: number;
  leaderName: string;
  totalCPRTime: number; // In milliseconds, for CCF calculation
  roscChecklist: Record<string, boolean>;
}

export type ModalType = 'NONE' | 'SHOCK' | 'MEDS' | 'AIRWAY' | 'OTHER' | 'REPORT' | 'WIZARD_RHYTHM' | 'WIZARD_SPECIFIC' | 'PROCEDURES' | 'LABS';
