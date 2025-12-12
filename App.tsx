import React, { useReducer, useEffect, useState, useMemo } from 'react';
import { 
  Activity, Syringe, Zap, FileDown, CheckCircle, 
  Thermometer, Droplet, TestTube, Stethoscope, X, 
  HeartPulse, User, Clock, RotateCcw, Menu, FileText, List, 
  ClipboardList, CheckSquare, Square, Printer, Skull, Undo2,
  AlertTriangle, Eye, Wind, Heart, PlayCircle, Gauge, Pencil,
  HelpCircle, ChevronDown, ChevronUp, Pill, MessageSquare, Trash2
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// --- 1. TYPES & INTERFACES ---

type RhythmType = 'VF' | 'pVT' | 'Asystole' | 'PEA' | 'ROSC' | null;
type ViewMode = 'SURVEY' | 'WIZARD' | 'RECORDER';

interface PatientData {
  hn: string;
  name: string;
  age: string;
  weight: string;
  leaderName: string;
}

interface PrimarySurveyData {
  generalImpression: 'Stable' | 'Critical' | null;
  avpu: 'A' | 'V' | 'P' | 'U' | null;
  airway: 'Patent' | 'Obstructed' | 'Threatened' | null;
  breathingStatus: 'Normal' | 'Dyspnea' | 'Apnea' | null;
  spo2: string;
  rr: string;
  pulse: 'Present' | 'Absent' | null;
  bpSys: string;
  bpDia: string;
  skin: 'Normal' | 'Pale' | 'Diaphoretic' | null;
  notes: string;
}

interface LogEntry {
  id: string;
  timestamp: Date;
  offsetTime: string;
  seconds: number;
  action: string;
  category: 'MED' | 'PROCEDURE' | 'RHYTHM' | 'INFO' | 'LAB' | 'SURVEY';
  detail?: string;
}

interface ACLSState {
  viewMode: ViewMode;
  isActive: boolean;
  startTime: number | null;
  totalSeconds: number;
  cycleSeconds: number;
  logs: LogEntry[];
  survey: PrimarySurveyData;
  
  // Counters for Badges
  shockCount: number;
  epiDoseCount: number;
  amioDoseCount: number;
  
  // Clinical States
  atropineTotalDose: number;
  lastEpiTime: number | null;
  lastMedClick: number; // For debounce
  airwaySecure: boolean;
  ivAccessEstablished: boolean; // Track IV/IO status
  labsSent: boolean; // Track Labs status
  isAutoCPR: boolean;
  currentRhythm: RhythmType;
  ccfPercentage: number; // Chest Compression Fraction
}

type ModalType = 'NONE' | 'ETT' | 'IV_ACCESS' | 'DTX' | 'OTHER_MEDS' | 'RHYTHM_SELECT' | 'SUMMARY' | 'LABS' | 'PROCEDURES' | 'ROSC_CHECKLIST' | 'TOR' | 'EDIT_PATIENT' | 'DIAGNOSIS' | 'VS_NOTE' | 'SHOCK_ENERGY';

const initialSurvey: PrimarySurveyData = {
  generalImpression: null, avpu: null, airway: null,
  breathingStatus: null, spo2: '', rr: '',
  pulse: null, bpSys: '', bpDia: '', skin: null, notes: ''
};

const initialState: ACLSState = {
  viewMode: 'SURVEY',
  isActive: false,
  startTime: null,
  totalSeconds: 0,
  cycleSeconds: 0,
  logs: [],
  survey: initialSurvey,
  shockCount: 0,
  epiDoseCount: 0,
  amioDoseCount: 0,
  atropineTotalDose: 0,
  lastEpiTime: null,
  lastMedClick: 0,
  airwaySecure: false,
  ivAccessEstablished: false,
  labsSent: false,
  isAutoCPR: false,
  currentRhythm: null,
  ccfPercentage: 0,
};

const ROSC_CHECKLIST_LABELS: Record<string, string> = {
  'Airway': 'Airway : early ETT placement, recheck ETT',
  'Breathing': 'Breathing : RR 10/min, SpO2 92-98%, PaCO2 35-45',
  'Circulation': 'Circulation : SBP > 90, MAP > 65',
  'Diagnosis': 'Diagnosis : 5H 5T',
  'ECG': 'ECG 12 leads : PCI if STEMI, ECMO',
  'Commands': 'Follow commands? : if not TTM, EEG, CT',
  'ICU': 'Consider ICU admission'
};

const LAB_OPTIONS = ['DTX', 'CBC', 'Elyte', 'BUN/Cr', 'Hemo/Coag', 'Trop-T', 'Lactate', 'ABG'];

const HT_DATA = [
  { type: 'H', id: 'Hypovolemia', label: 'Hypovolemia', clues: ['History of fluid loss/blood loss', 'Flat neck veins', 'IV Fluids required'] },
  { type: 'H', id: 'Hypoxia', label: 'Hypoxia', clues: ['Airway obstruction', 'Desaturation', 'Cyanosis'] },
  { type: 'H', id: 'Hydrogen', label: 'Hydrogen Ion (Acidosis)', clues: ['Diabetes', 'Renal Failure', 'ABG shows acidosis'] },
  { type: 'H', id: 'Hyperkalemia', label: 'Hypo/Hyperkalemia', clues: ['Renal failure', 'Dialysis history', 'Peaked T waves (Hyper)', 'Flat T waves (Hypo)'] },
  { type: 'H', id: 'Hypothermia', label: 'Hypothermia', clues: ['Exposure to cold', 'Low body temp'] },
  
  { type: 'T', id: 'TensionPneumo', label: 'Tension Pneumothorax', clues: ['Tracheal deviation', 'Unequal breath sounds', 'Hypotension'] },
  { type: 'T', id: 'Tamponade', label: 'Tamponade, Cardiac', clues: ['Muffled heart sounds', 'Distended neck veins', 'Hypotension'] },
  { type: 'T', id: 'Toxins', label: 'Toxins', clues: ['History of ingestion', 'Empty bottles', 'Pupillary changes'] },
  { type: 'T', id: 'ThrombosisPulm', label: 'Thrombosis, Pulmonary', clues: ['History of DVT', 'Bed bound', 'Distended neck veins'] },
  { type: 'T', id: 'ThrombosisCoronary', label: 'Thrombosis, Coronary', clues: ['ST elevation', 'Angina history', 'Elevated troponin'] },
];

// --- 2. REDUCER LOGIC ---

type Action = 
  | { type: 'UPDATE_SURVEY'; field: keyof PrimarySurveyData; value: any }
  | { type: 'GO_TO_WIZARD' }
  | { type: 'START_CODE'; rhythm: RhythmType }
  | { type: 'TICK' }
  | { type: 'ADD_LOG'; category: LogEntry['category']; action: string; detail?: string }
  | { type: 'RESET_CYCLE' }
  | { type: 'ADMINISTER_MED'; medName: string }
  | { type: 'SECURE_AIRWAY'; detail: string }
  | { type: 'ESTABLISH_IV'; detail: string }
  | { type: 'SEND_LABS'; detail: string }
  | { type: 'TOGGLE_AUTO_CPR' }
  | { type: 'CHANGE_RHYTHM'; rhythm: RhythmType }
  | { type: 'UNDO' }
  | { type: 'REMOVE_LOG'; logId: string };

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

const formatRealTime = (date: Date) => date.toLocaleTimeString('th-TH', { hour12: false });

const aclsReducer = (state: ACLSState, action: Action): ACLSState => {
  switch (action.type) {
    case 'UPDATE_SURVEY':
      return {
        ...state,
        survey: { ...state.survey, [action.field]: action.value }
      };

    case 'GO_TO_WIZARD':
      return { ...state, viewMode: 'WIZARD' };

    case 'START_CODE':
      // Log the primary survey summary if coming from survey
      const surveySummary = state.survey.avpu ? 
        `Survey: ${state.survey.generalImpression}, AVPU:${state.survey.avpu}, Airway:${state.survey.airway}, Pulse:${state.survey.pulse}` : 
        'Skipped Primary Survey';

      return {
        ...state,
        isActive: true,
        viewMode: 'RECORDER',
        startTime: Date.now(),
        currentRhythm: action.rhythm,
        ccfPercentage: 100, // Initial ideal
        logs: [
          {
            id: 'init-log',
            timestamp: new Date(),
            offsetTime: '00:00',
            seconds: 0,
            action: 'STARTED CODE BLUE',
            category: 'INFO',
            detail: `Initial Rhythm: ${action.rhythm}`
          },
          {
            id: 'survey-log',
            timestamp: new Date(),
            offsetTime: '00:00',
            seconds: 0,
            action: 'Primary Survey',
            category: 'SURVEY',
            detail: surveySummary
          }
        ]
      };

    case 'TICK':
      if (!state.isActive) return state;
      // Simple CCF logic as requested: 100% if active/autoCPR, 0 otherwise (placeholder for real calc)
      let currentCCF = state.isAutoCPR ? 100 : 98; 
      if (state.cycleSeconds > 115) currentCCF = 85; // Warning zone

      return {
        ...state,
        totalSeconds: state.totalSeconds + 1,
        cycleSeconds: state.cycleSeconds + 1,
        ccfPercentage: currentCCF
      };

    case 'RESET_CYCLE':
      return {
        ...state,
        cycleSeconds: 0,
        logs: [{
          id: Date.now().toString(),
          timestamp: new Date(),
          offsetTime: formatTime(state.totalSeconds),
          seconds: state.totalSeconds,
          action: 'Cycle Check (2 Min)',
          category: 'PROCEDURE',
          detail: 'Pulse Check / Rotate Compressor'
        }, ...state.logs]
      };

    case 'ADD_LOG':
      let sCount = state.shockCount;
      if (action.action === 'Defibrillation') sCount++;

      return {
        ...state,
        shockCount: sCount,
        logs: [{
          id: Date.now().toString(),
          timestamp: new Date(),
          offsetTime: formatTime(state.totalSeconds),
          seconds: state.totalSeconds,
          action: action.action,
          category: action.category,
          detail: action.detail
        }, ...state.logs]
      };

    case 'ADMINISTER_MED':
      // Debounce Check
      if (Date.now() - state.lastMedClick < 500) return state;

      let newEpiCount = state.epiDoseCount;
      let newAmioCount = state.amioDoseCount;
      let newAtropineTotal = state.atropineTotalDose;
      let newLastEpi = state.lastEpiTime;
      let drugDetail = '';

      if (action.medName === 'Adrenaline') {
        newEpiCount += 1;
        newLastEpi = state.totalSeconds;
        drugDetail = `1 mg IV/IO Push (Dose ${newEpiCount})`;
      }
      else if (action.medName === 'Amiodarone') {
        newAmioCount += 1;
        const dose = newAmioCount === 1 ? '300 mg' : '150 mg';
        drugDetail = `${dose} IV/IO Push (Dose ${newAmioCount})`;
      }
      else if (action.medName === 'Atropine') {
        const dose = 0.5;
        if (newAtropineTotal + dose > 3) {
            alert('Total Atropine > 3 mg');
        }
        newAtropineTotal += dose;
        drugDetail = `${dose} mg IV (Total: ${newAtropineTotal} mg)`;
      }
      else if (action.medName === 'Dopamine') drugDetail = 'Start Infusion (Titrate)';
      else if (action.medName === 'Magnesium Sulfate') drugDetail = '2 g IV Slow Push (Diluted)';
      else if (action.medName === 'Sodium Bicarbonate') drugDetail = '50 mEq IV Push';
      else if (action.medName === 'Calcium Gluconate') drugDetail = '10% 10ml IV Slow Push';
      else if (action.medName === 'Lidocaine') drugDetail = '1-1.5 mg/kg IV';

      return {
        ...state,
        epiDoseCount: newEpiCount,
        amioDoseCount: newAmioCount,
        atropineTotalDose: newAtropineTotal,
        lastEpiTime: newLastEpi,
        lastMedClick: Date.now(),
        logs: [{
          id: Date.now().toString(),
          timestamp: new Date(),
          offsetTime: formatTime(state.totalSeconds),
          seconds: state.totalSeconds,
          action: `Given ${action.medName}`,
          category: 'MED',
          detail: drugDetail
        }, ...state.logs]
      };

    case 'SECURE_AIRWAY':
      return {
        ...state,
        airwaySecure: true,
        logs: [{
          id: Date.now().toString(),
          timestamp: new Date(),
          offsetTime: formatTime(state.totalSeconds),
          seconds: state.totalSeconds,
          action: 'Advanced Airway Secured',
          category: 'PROCEDURE',
          detail: `${action.detail} (Continuous CPR)`
        }, ...state.logs]
      };

    case 'ESTABLISH_IV':
      return {
        ...state,
        ivAccessEstablished: true,
        logs: [{
          id: Date.now().toString(),
          timestamp: new Date(),
          offsetTime: formatTime(state.totalSeconds),
          seconds: state.totalSeconds,
          action: 'Vascular Access',
          category: 'PROCEDURE',
          detail: action.detail
        }, ...state.logs]
      };

    case 'SEND_LABS':
      return {
        ...state,
        labsSent: true,
        logs: [{
          id: Date.now().toString(),
          timestamp: new Date(),
          offsetTime: formatTime(state.totalSeconds),
          seconds: state.totalSeconds,
          action: 'Labs / Specimen',
          category: 'LAB',
          detail: action.detail
        }, ...state.logs]
      };

    case 'TOGGLE_AUTO_CPR':
      const nextAuto = !state.isAutoCPR;
      return {
        ...state,
        isAutoCPR: nextAuto,
        ccfPercentage: nextAuto ? 100 : state.ccfPercentage,
        logs: [{
          id: Date.now().toString(),
          timestamp: new Date(),
          offsetTime: formatTime(state.totalSeconds),
          seconds: state.totalSeconds,
          action: nextAuto ? 'Start Auto CPR' : 'Stop Auto CPR',
          category: 'PROCEDURE',
          detail: nextAuto ? 'Mechanical Compression ON' : 'Switch to Manual CPR'
        }, ...state.logs]
      };
      
    case 'CHANGE_RHYTHM':
      return {
        ...state,
        currentRhythm: action.rhythm,
        logs: [{
          id: Date.now().toString(),
          timestamp: new Date(),
          offsetTime: formatTime(state.totalSeconds),
          seconds: state.totalSeconds,
          action: 'Rhythm Change',
          category: 'RHYTHM',
          detail: `New Rhythm: ${action.rhythm}`
        }, ...state.logs]
      };

    case 'REMOVE_LOG':
      const logToRemove = state.logs.find(l => l.id === action.logId);
      if (!logToRemove) return state;
      
      const filteredLogs = state.logs.filter(l => l.id !== action.logId);
      
      let updates: Partial<ACLSState> = { logs: filteredLogs };
      
      // Update counters based on what was removed
      if (logToRemove.action === 'Defibrillation') {
          updates.shockCount = Math.max(0, state.shockCount - 1);
      }
      
      if (logToRemove.action.includes('Adrenaline')) {
          updates.epiDoseCount = Math.max(0, state.epiDoseCount - 1);
          // Recalculate last Epi time from remaining logs
          const remainingEpi = filteredLogs.filter(l => l.action.includes('Adrenaline'));
          updates.lastEpiTime = remainingEpi.length > 0 ? remainingEpi[0].seconds : null;
      }
      
      if (logToRemove.action.includes('Amiodarone')) {
          updates.amioDoseCount = Math.max(0, state.amioDoseCount - 1);
      }

      if (logToRemove.action.includes('Atropine')) {
         const match = logToRemove.detail?.match(/([\d\.]+) mg/);
         const dose = match ? parseFloat(match[1]) : 0.5;
         updates.atropineTotalDose = Math.max(0, state.atropineTotalDose - dose);
      }

      if (logToRemove.action.includes('Advanced Airway Secured')) {
         updates.airwaySecure = filteredLogs.some(l => l.action.includes('Advanced Airway Secured'));
      }
      if (logToRemove.action === 'Vascular Access') {
         updates.ivAccessEstablished = filteredLogs.some(l => l.action === 'Vascular Access');
      }
      if (logToRemove.action === 'Labs / Specimen') {
         updates.labsSent = filteredLogs.some(l => l.action === 'Labs / Specimen');
      }
      
      return { ...state, ...updates };

    case 'UNDO':
      // Safety check for generic undo (last item)
      if (state.logs.length === 0) return state;
      
      const [lastLog, ...remainingLogs] = state.logs;
      // Re-use logic for specific types essentially by creating a new state object
      // But since we have specific reducer logic for decrementing based on the *last* item already in 'REMOVE_LOG' logic style,
      // we can just leverage similar logic or keep the existing simplified UNDO for the "Last Item" case.
      // To ensure consistency, we'll use the same logic pattern as REMOVE_LOG but targeting the first item.
      
      // Simplified: Just dispatch REMOVE_LOG with the ID? No, reducer can't dispatch. 
      // So we duplicate the update logic or extract it. For now, keep existing logic but sync it.
      
      const undoUpdates: Partial<ACLSState> = { logs: remainingLogs };
      
      if (lastLog.action === 'Defibrillation') {
          undoUpdates.shockCount = Math.max(0, state.shockCount - 1);
      }
      
      if (lastLog.action.includes('Adrenaline')) {
          undoUpdates.epiDoseCount = Math.max(0, state.epiDoseCount - 1);
          const prevEpi = remainingLogs.find(l => l.action.includes('Adrenaline'));
          undoUpdates.lastEpiTime = prevEpi ? prevEpi.seconds : null;
      }
      
      if (lastLog.action.includes('Amiodarone')) {
          undoUpdates.amioDoseCount = Math.max(0, state.amioDoseCount - 1);
      }
      
      if (lastLog.action.includes('Advanced Airway Secured')) {
          undoUpdates.airwaySecure = false; // Simple undo assumes toggling back recent action
      }
      
      if (lastLog.action === 'Vascular Access') {
          undoUpdates.ivAccessEstablished = false;
      }
      
      if (lastLog.action === 'Labs / Specimen') {
          undoUpdates.labsSent = false;
      }
      
      if (lastLog.action.includes('Auto CPR')) {
          undoUpdates.isAutoCPR = !state.isAutoCPR; 
      }

      return { ...state, ...undoUpdates };

    default:
      return state;
  }
};

// --- 3. HELPER COMPONENT: BADGE ---
const Badge = ({ count, color = 'bg-red-600' }: { count: number, color?: string }) => {
  if (count === 0) return null;
  return (
    <div className={`absolute -top-2 -right-2 ${color} text-white text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full shadow-md border-2 border-gray-800 z-10 animate-in zoom-in duration-200`}>
      {count}
    </div>
  );
};

// --- 4. MAIN COMPONENT ---

export default function ACLSRecorder() {
  const [state, dispatch] = useReducer(aclsReducer, initialState);
  
  // Patient Data
  const [patient, setPatient] = useState<PatientData>({ hn: '', name: '', age: '', weight: '', leaderName: '' });
  
  // UI States
  const [activeModal, setActiveModal] = useState<ModalType>('NONE');
  const [ettSize, setEttSize] = useState('7.5');
  const [ettDepth, setEttDepth] = useState('22');
  const [ivType, setIvType] = useState('NSS 0.9%');
  const [ivRate, setIvRate] = useState('Free Flow');
  const [ivSite, setIvSite] = useState('Peripheral IV');
  const [dtxValue, setDtxValue] = useState('');
  const [ventMethod, setVentMethod] = useState('BVM'); // Added for ventilation method
  const [airwayDevice, setAirwayDevice] = useState<'ETT' | 'LMA'>('ETT');
  
  // VS/Note States
  const [vsBpSys, setVsBpSys] = useState('');
  const [vsBpDia, setVsBpDia] = useState('');
  const [vsHr, setVsHr] = useState('');
  const [vsRr, setVsRr] = useState('');
  const [vsSpo2, setVsSpo2] = useState('');
  const [vsNote, setVsNote] = useState('');

  // Shock Energy State
  const [energy, setEnergy] = useState('200');
  
  // Summary Selection
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  
  // Diagnosis State
  const [expandedDiagnosis, setExpandedDiagnosis] = useState<string | null>(null);

  // Labs State
  const [customLab, setCustomLab] = useState("");
  const [selectedLabs, setSelectedLabs] = useState<string[]>([]);
  
  // ROSC State
  const [roscChecklist, setRoscChecklist] = useState<Record<string, boolean>>({
    'Airway': false, 'Breathing': false, 'Circulation': false, 'Diagnosis': false, 'ECG': false, 'Commands': false, 'ICU': false
  });

  // Critical Logic Trigger for Primary Survey
  useEffect(() => {
    if (state.viewMode === 'SURVEY') {
      const s = state.survey;
      if (s.avpu === 'U' && s.breathingStatus === 'Apnea' && s.pulse === 'Absent') {
        // Critical Patient - Auto trigger Code
        dispatch({ type: 'GO_TO_WIZARD' });
      }
    }
  }, [state.survey, state.viewMode]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (state.isActive) {
      interval = setInterval(() => dispatch({ type: 'TICK' }), 1000);
    }
    return () => clearInterval(interval);
  }, [state.isActive]);

  const handleStart = (rhythm: RhythmType) => {
    if (!patient.hn) {
       // Ask for confirmation if skipping, but rephrased to imply they can add later.
       const confirmStart = confirm('คุณยังไม่ได้ระบุ HN\nระบบจะบันทึกเป็น "Unknown" ชั่วคราว และคุณสามารถแก้ไขข้อมูลย้อนหลังได้\n\nยืนยันเริ่ม Code หรือไม่?');
       if (!confirmStart) return;
    }
    dispatch({ type: 'START_CODE', rhythm });
  };
  
  const handleSaveVsNote = () => {
    const parts = [];
    if (vsBpSys || vsBpDia) parts.push(`BP: ${vsBpSys}/${vsBpDia}`);
    if (vsHr) parts.push(`HR: ${vsHr}`);
    if (vsRr) parts.push(`RR: ${vsRr}`);
    if (vsSpo2) parts.push(`SpO2: ${vsSpo2}%`);
    
    const vsString = parts.join(', ');
    
    if (vsString || vsNote) {
        let action = 'Vital Signs';
        if (!vsString && vsNote) action = 'Clinical Note';
        
        let detail = vsString;
        if (vsNote) detail = vsString ? `${vsString} | ${vsNote}` : vsNote;

        dispatch({
            type: 'ADD_LOG', 
            category: 'INFO', 
            action: action, 
            detail: detail
        });
    }

    // Reset
    setVsBpSys(''); setVsBpDia(''); setVsHr(''); setVsRr(''); setVsSpo2(''); setVsNote('');
    setActiveModal('NONE');
  };

  const isEpiReady = () => {
    if (!state.lastEpiTime) return true;
    return (state.totalSeconds - state.lastEpiTime) >= 180; // 3 mins
  };
  
  const isShockable = ['VF', 'pVT'].includes(state.currentRhythm || '');

  const generatePDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("CPCR RECORD FORM (Digital ACLS 2025)", 105, 15, { align: "center" });
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString('th-TH')}`, 105, 22, { align: "center" });

    doc.setDrawColor(0);
    doc.setFillColor(245, 245, 245);
    doc.rect(14, 25, 182, 45, 'F'); // Increased height for survey summary
    doc.setFontSize(11);
    doc.text(`HN: ${patient.hn || '-'}  Name: ${patient.name || '-'}`, 20, 33);
    doc.text(`Age: ${patient.age || '-'} | Wt: ${patient.weight || '-'} kg`, 20, 40);
    doc.text(`Leader: ${patient.leaderName || '-'}`, 20, 47);
    
    // Survey Summary in Header
    doc.setFontSize(9);
    const s = state.survey;
    const surveyText = `Initial Assessment: ${s.generalImpression || '-'} | AVPU: ${s.avpu || '-'} | Airway: ${s.airway || '-'} | Breathing: ${s.breathingStatus || '-'} (${s.spo2}% / ${s.rr}rpm) | Circ: ${s.pulse || '-'} (${s.bpSys}/${s.bpDia})`;
    doc.text(surveyText, 20, 55);

    // Stats
    const epiCount = state.logs.filter(l => l.action.includes('Adrenaline')).length;
    const shockCount = state.logs.filter(l => l.action.includes('Defibrillation')).length;
    doc.setFontSize(11);
    doc.text(`Summary: Adrenaline x${epiCount} | Shock x${shockCount} | Duration: ${formatTime(state.totalSeconds)}`, 14, 78);

    const tableData = state.logs.slice().reverse().map(log => [
      formatRealTime(log.timestamp),
      log.offsetTime,
      log.category,
      log.action,
      log.detail || '-'
    ]);

    autoTable(doc, {
      startY: 83,
      head: [['Time', 'T+ (min)', 'Cat', 'Action', 'Detail']],
      body: tableData,
      theme: 'grid',
    });

    const finalY = (doc as any).lastAutoTable.finalY + 15;
    
    // Detailed Footer Summary
    doc.setFontSize(10);
    doc.text("Medication Summary:", 14, finalY);
    doc.setFontSize(9);
    doc.text(`- Adrenaline (Total): ${state.epiDoseCount} mg`, 20, finalY + 5);
    doc.text(`- Amiodarone: ${state.amioDoseCount > 0 ? (state.amioDoseCount === 1 ? '300mg' : '450mg') : '0mg'}`, 20, finalY + 10);
    doc.text(`- Atropine: ${state.atropineTotalDose} mg`, 20, finalY + 15);
    
    doc.setFontSize(10);
    doc.text("Final Airway Status:", 100, finalY);
    doc.setFontSize(9);
    doc.text(state.airwaySecure ? "Advanced Airway Secured" : "Basic / BVM", 100, finalY + 5);

    doc.line(130, finalY + 30, 190, finalY + 30);
    doc.text("Leader / Recorder Signature", 135, finalY + 35);
    doc.save(`ACLS_${patient.hn || 'Unknown'}.pdf`);
  };
  
  // Logic for Lab Modal
  const toggleLabSelection = (lab: string) => {
    if (selectedLabs.includes(lab)) {
        setSelectedLabs(prev => prev.filter(l => l !== lab));
    } else {
        setSelectedLabs(prev => [...prev, lab]);
    }
  };
  const toggleSelectAllLabs = () => {
    if (selectedLabs.length === LAB_OPTIONS.length) setSelectedLabs([]);
    else setSelectedLabs([...LAB_OPTIONS]);
  };
  
  const submitLabs = () => {
      const parts = [];
      
      // Standard labs (exclude DTX string if we treat it specially, but we keep it simple)
      const standardLabs = selectedLabs.filter(l => l !== 'DTX');
      if (standardLabs.length > 0) parts.push(standardLabs.join(', '));
      
      // DTX special handling
      if (selectedLabs.includes('DTX')) {
         parts.push(dtxValue ? `DTX: ${dtxValue} mg%` : 'DTX');
      }

      if (customLab.trim()) parts.push(customLab.trim());
      
      if (parts.length > 0) {
          dispatch({type: 'SEND_LABS', detail: parts.join(', ')});
      }
      setSelectedLabs([]);
      setCustomLab("");
      setDtxValue(""); // Clear DTX
      setActiveModal('NONE');
  };
  
  const handleRoscCheck = (key: string) => {
      setRoscChecklist(prev => ({...prev, [key]: !prev[key]}));
  };

  // --- RENDER HELPERS ---
  
  const renderPrimarySurvey = () => (
    <div className="absolute inset-0 z-50 bg-gray-900 overflow-y-auto">
      <div className="bg-gray-800 p-4 sticky top-0 z-10 border-b border-gray-700 flex justify-between items-center shadow-lg">
        <h2 className="text-xl font-bold text-white flex items-center gap-2"><ClipboardList className="text-blue-400"/> Primary Survey</h2>
        <button onClick={() => dispatch({type: 'GO_TO_WIZARD'})} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300">Skip to Code</button>
      </div>
      
      <div className="p-4 space-y-6 max-w-md mx-auto pb-24">
         {/* 1. General Impression */}
         <div className="space-y-2">
            <h3 className="text-sm font-bold text-blue-400 uppercase">1. สภาพทั่วไป (General)</h3>
            <div className="grid grid-cols-2 gap-3">
               <button onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'generalImpression', value: 'Stable'})} className={`p-4 rounded-xl border font-bold ${state.survey.generalImpression === 'Stable' ? 'bg-green-600 border-green-400' : 'bg-gray-800 border-gray-700'}`}>STABLE</button>
               <button onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'generalImpression', value: 'Critical'})} className={`p-4 rounded-xl border font-bold ${state.survey.generalImpression === 'Critical' ? 'bg-red-600 border-red-400 animate-pulse' : 'bg-gray-800 border-gray-700'}`}>CRITICAL</button>
            </div>
         </div>

         {/* 2. AVPU */}
         <div className="space-y-2">
            <h3 className="text-sm font-bold text-blue-400 uppercase flex items-center gap-2"><Eye size={16}/> 2. ความรู้สึกตัว (AVPU)</h3>
            <div className="grid grid-cols-4 gap-2">
               {['A', 'V', 'P', 'U'].map((level) => (
                   <button key={level} onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'avpu', value: level})} className={`p-3 rounded-lg border font-bold ${state.survey.avpu === level ? (level === 'U' ? 'bg-red-600 border-red-400' : 'bg-blue-600 border-blue-400') : 'bg-gray-800 border-gray-700'}`}>
                     {level}
                   </button>
               ))}
            </div>
            {state.survey.avpu === 'U' && <div className="text-red-400 text-xs font-bold flex items-center gap-1 animate-pulse"><AlertTriangle size={12}/> Unresponsive: Check Pulse & Breathing!</div>}
         </div>

         {/* 3. Airway */}
         <div className="space-y-2">
            <h3 className="text-sm font-bold text-blue-400 uppercase flex items-center gap-2"><Wind size={16}/> 3. ทางเดินหายใจ (Airway)</h3>
            <div className="grid grid-cols-3 gap-2">
               <button onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'airway', value: 'Patent'})} className={`p-3 rounded-lg border text-sm font-bold ${state.survey.airway === 'Patent' ? 'bg-green-600 border-green-400' : 'bg-gray-800 border-gray-700'}`}>Patent</button>
               <button onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'airway', value: 'Threatened'})} className={`p-3 rounded-lg border text-sm font-bold ${state.survey.airway === 'Threatened' ? 'bg-yellow-600 border-yellow-400' : 'bg-gray-800 border-gray-700'}`}>Threatened</button>
               <button onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'airway', value: 'Obstructed'})} className={`p-3 rounded-lg border text-sm font-bold ${state.survey.airway === 'Obstructed' ? 'bg-red-600 border-red-400' : 'bg-gray-800 border-gray-700'}`}>Obstructed</button>
            </div>
            {state.survey.airway === 'Obstructed' && <button className="w-full p-2 bg-red-900/50 border border-red-600 text-red-200 rounded text-sm font-bold mt-1">Action: Open Airway / Suction</button>}
         </div>

         {/* 4. Breathing */}
         <div className="space-y-2">
            <h3 className="text-sm font-bold text-blue-400 uppercase">4. การหายใจ (Breathing)</h3>
            <div className="grid grid-cols-3 gap-2">
               <button onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'breathingStatus', value: 'Normal'})} className={`p-3 rounded-lg border text-sm font-bold ${state.survey.breathingStatus === 'Normal' ? 'bg-green-600 border-green-400' : 'bg-gray-800 border-gray-700'}`}>Normal</button>
               <button onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'breathingStatus', value: 'Dyspnea'})} className={`p-3 rounded-lg border text-sm font-bold ${state.survey.breathingStatus === 'Dyspnea' ? 'bg-yellow-600 border-yellow-400' : 'bg-gray-800 border-gray-700'}`}>Dyspnea</button>
               <button onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'breathingStatus', value: 'Apnea'})} className={`p-3 rounded-lg border text-sm font-bold ${state.survey.breathingStatus === 'Apnea' ? 'bg-red-600 border-red-400' : 'bg-gray-800 border-gray-700'}`}>Apnea</button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
                <input type="number" placeholder="SpO2 %" value={state.survey.spo2} onChange={(e) => dispatch({type: 'UPDATE_SURVEY', field: 'spo2', value: e.target.value})} className="bg-gray-800 border border-gray-700 p-2 rounded text-white text-sm" />
                <input type="number" placeholder="RR /min" value={state.survey.rr} onChange={(e) => dispatch({type: 'UPDATE_SURVEY', field: 'rr', value: e.target.value})} className="bg-gray-800 border border-gray-700 p-2 rounded text-white text-sm" />
            </div>
         </div>

         {/* 5. Circulation */}
         <div className="space-y-2">
            <h3 className="text-sm font-bold text-blue-400 uppercase flex items-center gap-2"><Heart size={16}/> 5. การไหลเวียนเลือด (Circulation)</h3>
            <div className="grid grid-cols-2 gap-3">
               <button onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'pulse', value: 'Present'})} className={`p-4 rounded-xl border font-bold ${state.survey.pulse === 'Present' ? 'bg-green-600 border-green-400' : 'bg-gray-800 border-gray-700'}`}>Pulse Present</button>
               <button onClick={() => dispatch({type: 'UPDATE_SURVEY', field: 'pulse', value: 'Absent'})} className={`p-4 rounded-xl border font-bold ${state.survey.pulse === 'Absent' ? 'bg-red-600 border-red-400' : 'bg-gray-800 border-gray-700'}`}>Pulseless</button>
            </div>
            <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-gray-400">BP:</span>
                <input type="number" placeholder="Sys" value={state.survey.bpSys} onChange={(e) => dispatch({type: 'UPDATE_SURVEY', field: 'bpSys', value: e.target.value})} className="bg-gray-800 border border-gray-700 p-2 rounded text-white w-20 text-center" />
                <span className="text-gray-500">/</span>
                <input type="number" placeholder="Dia" value={state.survey.bpDia} onChange={(e) => dispatch({type: 'UPDATE_SURVEY', field: 'bpDia', value: e.target.value})} className="bg-gray-800 border border-gray-700 p-2 rounded text-white w-20 text-center" />
            </div>
         </div>
         
         <div className="pt-4 pb-20">
            <button onClick={() => dispatch({type: 'GO_TO_WIZARD'})} className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2">
                Proceed to Code Wizard <PlayCircle size={24}/>
            </button>
         </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans max-w-md mx-auto relative overflow-hidden flex flex-col shadow-2xl">
      
      {/* --- RENDER PRIMARY SURVEY --- */}
      {state.viewMode === 'SURVEY' && renderPrimarySurvey()}

      {/* --- MODALS --- */}
      {activeModal !== 'NONE' && (
        <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-gray-800 rounded-2xl w-full max-w-sm p-5 shadow-2xl border border-gray-700 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
              <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2">
                {activeModal === 'SUMMARY' && <><List/> Case Summary</>}
                {activeModal === 'ETT' && 'Advanced Airway'}
                {activeModal === 'IV_ACCESS' && 'Vascular Access'}
                {activeModal === 'OTHER_MEDS' && 'Other Drugs'}
                {activeModal === 'RHYTHM_SELECT' && 'Change Rhythm'}
                {activeModal === 'LABS' && 'Labs Selection'}
                {activeModal === 'PROCEDURES' && 'Procedures'}
                {activeModal === 'ROSC_CHECKLIST' && 'ROSC Checklist'}
                {activeModal === 'TOR' && 'Termination of Resuscitation'}
                {activeModal === 'EDIT_PATIENT' && 'Edit Patient Info'}
                {activeModal === 'DIAGNOSIS' && (
                   <>
                      <div className="bg-yellow-500/20 p-1 rounded-full"><HelpCircle size={18} className="text-yellow-500"/></div>
                      <span>Differential Diagnosis Helper</span>
                   </>
                )}
                {activeModal === 'VS_NOTE' && (
                   <>
                      <MessageSquare size={18} className="text-yellow-400"/>
                      <span>Vital Signs / Note</span>
                   </>
                )}
                {activeModal === 'SHOCK_ENERGY' && (
                   <>
                      <Zap size={18} className="text-yellow-500"/>
                      <span>Energy Selection</span>
                   </>
                )}
              </h3>
              <button onClick={() => setActiveModal('NONE')} className="p-2 bg-gray-700 rounded-full hover:bg-gray-600"><X size={20}/></button>
            </div>

            {/* --- SHOCK ENERGY MODAL --- */}
            {activeModal === 'SHOCK_ENERGY' && (
              <div className="space-y-5">
                <div className="text-center">
                    <div className="inline-flex items-center justify-center p-3 bg-yellow-500 rounded-full mb-2 shadow-lg shadow-yellow-500/50">
                        <Zap size={32} className="text-black" fill="black"/>
                    </div>
                    <h2 className="text-2xl font-black text-white">DEFIBRILLATION</h2>
                    <p className="text-gray-400 text-sm">Select Energy (Joules)</p>
                </div>
                
                <div className="grid grid-cols-3 gap-3">
                    {['120', '150', '200', '270', '300', '360'].map(j => (
                        <button 
                            key={j} 
                            onClick={() => setEnergy(j)}
                            className={`p-4 rounded-xl font-bold text-xl transition-all ${energy === j ? 'bg-yellow-500 text-black scale-105 shadow-xl shadow-yellow-900/20' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                        >
                            {j}
                        </button>
                    ))}
                </div>

                <button 
                    onClick={() => {
                        dispatch({type:'ADD_LOG', category:'PROCEDURE', action:'Defibrillation', detail:`${energy}J`}); 
                        setActiveModal('NONE');
                    }} 
                    className="w-full py-5 bg-red-600 hover:bg-red-500 rounded-2xl font-black text-2xl text-white shadow-2xl shadow-red-900/50 flex items-center justify-center gap-3 active:scale-95 transition-all"
                >
                    <Zap fill="currentColor"/> SHOCK {energy}J
                </button>
              </div>
            )}

            {/* --- SUMMARY MODAL --- */}
            {activeModal === 'SUMMARY' && (
              <div className="space-y-4">
                 <div className="bg-gray-900 p-4 rounded-xl space-y-2">
                    <div className="flex justify-between border-b border-gray-700 pb-2">
                      <span className="text-gray-400">Duration</span>
                      <span className="font-mono font-bold text-xl">{formatTime(state.totalSeconds)}</span>
                    </div>
                    {/* Patient Info Block with Edit Button */}
                    <div className="flex justify-between items-center bg-gray-800 p-3 rounded-lg mt-2">
                       <div className="text-sm">
                          <div className="font-bold text-gray-300">Patient Data</div>
                          <div className="text-gray-400 text-xs">HN: {patient.hn || '-'} | Name: {patient.name || '-'}</div>
                       </div>
                       <button onClick={() => setActiveModal('EDIT_PATIENT')} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-blue-300"><Pencil size={16}/></button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2">
                       <div className="text-center p-2 bg-gray-800 rounded-lg">
                          <div className="text-xs text-gray-400">Shocks</div>
                          <div className="text-2xl font-bold text-yellow-400">{state.shockCount}</div>
                       </div>
                       <div className="text-center p-2 bg-gray-800 rounded-lg">
                          <div className="text-xs text-gray-400">Epi Doses</div>
                          <div className="text-2xl font-bold text-red-400">{state.epiDoseCount}</div>
                       </div>
                       <div className="text-center p-2 bg-gray-800 rounded-lg">
                          <div className="text-xs text-gray-400">Amio Doses</div>
                          <div className="text-2xl font-bold text-purple-400">{state.amioDoseCount}</div>
                       </div>
                       <div className="text-center p-2 bg-gray-800 rounded-lg">
                          <div className="text-xs text-gray-400">Airway</div>
                          <div className="text-sm font-bold text-blue-300">{state.airwaySecure ? 'Secured' : 'BVM'}</div>
                       </div>
                    </div>
                 </div>

                 <div className="max-h-60 overflow-y-auto bg-black/20 rounded-xl p-2 text-xs space-y-1">
                    {state.logs.length === 0 && <p className="text-center text-gray-500 py-4">No logs recorded.</p>}
                    {state.logs.map(log => (
                       <div 
                         key={log.id} 
                         onClick={() => setSelectedLogId(selectedLogId === log.id ? null : log.id)}
                         className={`flex gap-2 border-b border-gray-800 pb-1 p-2 rounded cursor-pointer transition-colors ${selectedLogId === log.id ? 'bg-red-900/30 border-red-800' : 'hover:bg-white/5'}`}
                       >
                          <span className="text-gray-500 font-mono">{log.offsetTime}</span>
                          <span className={`flex-1 ${log.category==='MED'?'text-pink-300':'text-white'}`}>{log.action} {log.detail}</span>
                          {selectedLogId === log.id && (
                              <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if(confirm('Delete this entry?')) {
                                        dispatch({type: 'REMOVE_LOG', logId: log.id});
                                        setSelectedLogId(null);
                                    }
                                }}
                                className="px-2 py-0.5 bg-red-600 rounded text-white font-bold text-[10px] flex items-center gap-1"
                              >
                                <Trash2 size={10}/> Undo
                              </button>
                          )}
                       </div>
                    ))}
                 </div>
                 
                 <p className="text-[10px] text-gray-500 text-center">Tap entry to undo specific item. Double-tap main Summary button for quick undo.</p>

                 <button onClick={generatePDF} className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg">
                    <FileDown size={20}/> Export Full PDF
                 </button>
              </div>
            )}
            
            {/* VS/NOTE MODAL */}
            {activeModal === 'VS_NOTE' && (
              <div className="space-y-4">
                <div>
                   <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Vital Signs</h4>
                   <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-1 bg-gray-700 p-2 rounded-xl border border-gray-600">
                         <input type="number" placeholder="Sys" value={vsBpSys} onChange={(e)=>setVsBpSys(e.target.value)} className="bg-transparent w-full text-center outline-none text-white font-mono font-bold" />
                         <span className="text-gray-400">/</span>
                         <input type="number" placeholder="Dia" value={vsBpDia} onChange={(e)=>setVsBpDia(e.target.value)} className="bg-transparent w-full text-center outline-none text-white font-mono font-bold" />
                      </div>
                      <input type="number" placeholder="HR /min" value={vsHr} onChange={(e)=>setVsHr(e.target.value)} className="bg-gray-700 p-3 rounded-xl border border-gray-600 text-white font-mono font-bold text-center placeholder:text-xs outline-none" />
                      <input type="number" placeholder="RR /min" value={vsRr} onChange={(e)=>setVsRr(e.target.value)} className="bg-gray-700 p-3 rounded-xl border border-gray-600 text-white font-mono font-bold text-center placeholder:text-xs outline-none" />
                      <input type="number" placeholder="SpO2 %" value={vsSpo2} onChange={(e)=>setVsSpo2(e.target.value)} className="bg-gray-700 p-3 rounded-xl border border-gray-600 text-white font-mono font-bold text-center placeholder:text-xs outline-none" />
                   </div>
                </div>

                <div>
                   <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Clinical Note</h4>
                   <textarea 
                     rows={3} 
                     placeholder="Enter additional clinical notes here..." 
                     value={vsNote} 
                     onChange={(e)=>setVsNote(e.target.value)} 
                     className="w-full bg-gray-700 p-3 rounded-xl border border-gray-600 text-white placeholder:text-sm outline-none resize-none"
                   />
                </div>

                <button onClick={handleSaveVsNote} className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold flex items-center justify-center gap-2">
                   Save Log
                </button>
              </div>
            )}
            
            {/* DIAGNOSIS MODAL */}
            {activeModal === 'DIAGNOSIS' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 h-[60vh] overflow-y-auto pr-1">
                     <div>
                        <h4 className="text-gray-300 font-bold mb-2 text-sm sticky top-0 bg-gray-800 py-1 z-10">6 H (Reversible)</h4>
                        <div className="space-y-2">
                           {HT_DATA.filter(i=>i.type==='H').map(item => (
                              <div key={item.id} className="border border-gray-700 rounded-lg overflow-hidden">
                                 <button onClick={()=>setExpandedDiagnosis(expandedDiagnosis === item.id ? null : item.id)} className={`w-full p-2 text-left font-bold text-sm flex justify-between items-center ${expandedDiagnosis === item.id ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400'}`}>
                                    {item.label}
                                    {expandedDiagnosis === item.id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                                 </button>
                                 {expandedDiagnosis === item.id && (
                                    <div className="p-2 bg-gray-900/50 text-xs space-y-2">
                                       <div>
                                          <span className="text-gray-500 font-bold block mb-1">Diagnostic Clues:</span>
                                          <ul className="list-disc pl-4 text-gray-300 space-y-0.5">
                                             {item.clues.map((clue, idx) => <li key={idx}>{clue}</li>)}
                                          </ul>
                                       </div>
                                       <div className="flex gap-2 pt-1">
                                          <button onClick={()=>{dispatch({type:'ADD_LOG', category:'INFO', action:`Rule Out ${item.label}`, detail: 'Diagnostic'});}} className="flex-1 bg-gray-700 hover:bg-gray-600 py-1.5 rounded text-gray-300 font-bold">Rule Out</button>
                                          <button onClick={()=>{dispatch({type:'ADD_LOG', category:'PROCEDURE', action:`Treating ${item.label}`, detail: 'Therapeutic'});}} className="flex-1 bg-indigo-600 hover:bg-indigo-500 py-1.5 rounded text-white font-bold">Treating</button>
                                       </div>
                                    </div>
                                 )}
                              </div>
                           ))}
                        </div>
                     </div>
                     <div>
                        <h4 className="text-gray-300 font-bold mb-2 text-sm sticky top-0 bg-gray-800 py-1 z-10">6 T (Reversible)</h4>
                        <div className="space-y-2">
                           {HT_DATA.filter(i=>i.type==='T').map(item => (
                              <div key={item.id} className="border border-gray-700 rounded-lg overflow-hidden">
                                 <button onClick={()=>setExpandedDiagnosis(expandedDiagnosis === item.id ? null : item.id)} className={`w-full p-2 text-left font-bold text-sm flex justify-between items-center ${expandedDiagnosis === item.id ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400'}`}>
                                    {item.label}
                                    {expandedDiagnosis === item.id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                                 </button>
                                 {expandedDiagnosis === item.id && (
                                    <div className="p-2 bg-gray-900/50 text-xs space-y-2">
                                       <div>
                                          <span className="text-gray-500 font-bold block mb-1">Diagnostic Clues:</span>
                                          <ul className="list-disc pl-4 text-gray-300 space-y-0.5">
                                             {item.clues.map((clue, idx) => <li key={idx}>{clue}</li>)}
                                          </ul>
                                       </div>
                                       <div className="flex gap-2 pt-1">
                                          <button onClick={()=>{dispatch({type:'ADD_LOG', category:'INFO', action:`Rule Out ${item.label}`, detail: 'Diagnostic'});}} className="flex-1 bg-gray-700 hover:bg-gray-600 py-1.5 rounded text-gray-300 font-bold">Rule Out</button>
                                          <button onClick={()=>{dispatch({type:'ADD_LOG', category:'PROCEDURE', action:`Treating ${item.label}`, detail: 'Therapeutic'});}} className="flex-1 bg-indigo-600 hover:bg-indigo-500 py-1.5 rounded text-white font-bold">Treating</button>
                                       </div>
                                    </div>
                                 )}
                              </div>
                           ))}
                        </div>
                     </div>
                  </div>
                </div>
            )}
            
            {/* EDIT PATIENT MODAL */}
            {activeModal === 'EDIT_PATIENT' && (
               <div className="space-y-4">
                  <div className="space-y-3">
                     <div>
                        <label className="text-xs text-gray-400">HN / ID</label>
                        <input type="text" className="w-full bg-gray-900 p-3 rounded-xl border border-gray-600 text-white" value={patient.hn} onChange={e=>setPatient({...patient, hn:e.target.value})} placeholder="HN / ID" />
                     </div>
                     <div>
                        <label className="text-xs text-gray-400">Patient Name</label>
                        <input type="text" className="w-full bg-gray-900 p-3 rounded-xl border border-gray-600 text-white" value={patient.name} onChange={e=>setPatient({...patient, name:e.target.value})} placeholder="Name" />
                     </div>
                     <div className="grid grid-cols-2 gap-2">
                        <div>
                           <label className="text-xs text-gray-400">Age</label>
                           <input type="text" className="w-full bg-gray-900 p-3 rounded-xl border border-gray-600 text-white" value={patient.age} onChange={e=>setPatient({...patient, age:e.target.value})} placeholder="Age" />
                        </div>
                        <div>
                           <label className="text-xs text-gray-400">Weight (kg)</label>
                           <input type="text" className="w-full bg-gray-900 p-3 rounded-xl border border-gray-600 text-white" value={patient.weight} onChange={e=>setPatient({...patient, weight:e.target.value})} placeholder="Weight" />
                        </div>
                     </div>
                     <div>
                        <label className="text-xs text-gray-400">Leader Name</label>
                        <input type="text" className="w-full bg-gray-900 p-3 rounded-xl border border-gray-600 text-white" value={patient.leaderName} onChange={e=>setPatient({...patient, leaderName:e.target.value})} placeholder="Leader Name" />
                     </div>
                  </div>
                  <button onClick={() => setActiveModal('SUMMARY')} className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-xl font-bold">Save Changes</button>
               </div>
            )}

            {/* ETT MODAL */}
            {activeModal === 'ETT' && (
              <div className="space-y-4">
                 <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setAirwayDevice('LMA')} className={`p-3 rounded-xl border font-bold ${airwayDevice === 'LMA' ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>LMA</button>
                    <button onClick={() => setAirwayDevice('ETT')} className={`p-3 rounded-xl border font-bold ${airwayDevice === 'ETT' ? 'bg-blue-600 border-blue-400 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>ETT</button>
                 </div>
                 
                 {airwayDevice === 'ETT' && (
                    <>
                     <div>
                       <label className="text-sm text-gray-400">Size</label>
                       <div className="flex gap-2 mt-2">
                         {['7.0', '7.5', '8.0'].map(s => <button key={s} onClick={()=>setEttSize(s)} className={`flex-1 py-3 rounded-lg border font-bold ${ettSize===s ? 'bg-blue-600 border-blue-400':'bg-gray-700 border-gray-600'}`}>{s}</button>)}
                       </div>
                     </div>
                     <div>
                       <label className="text-sm text-gray-400">Depth (cm)</label>
                       <div className="flex gap-2 mt-2">
                         {['20', '21', '22', '23'].map(d => <button key={d} onClick={()=>setEttDepth(d)} className={`flex-1 py-3 rounded-lg border font-bold ${ettDepth===d ? 'bg-blue-600 border-blue-400':'bg-gray-700 border-gray-600'}`}>{d}</button>)}
                       </div>
                     </div>
                    </>
                 )}

                 <div>
                   <label className="text-sm text-gray-400">Ventilation via</label>
                   <div className="flex gap-2 mt-2">
                     {['BVM', 'Oxylator'].map(v => <button key={v} onClick={()=>setVentMethod(v)} className={`flex-1 py-3 rounded-lg border font-bold ${ventMethod===v ? 'bg-blue-600 border-blue-400':'bg-gray-700 border-gray-600'}`}>{v}</button>)}
                   </div>
                 </div>
                 
                 <button onClick={() => { 
                     const detail = airwayDevice === 'ETT' 
                        ? `ETT No.${ettSize} dept.${ettDepth}cms via ${ventMethod}`
                        : `LMA via ${ventMethod}`;
                     dispatch({type:'SECURE_AIRWAY', detail}); 
                     setActiveModal('NONE'); 
                 }} className="w-full py-3 bg-green-600 rounded-xl font-bold mt-2">
                    Confirm {airwayDevice}
                 </button>
              </div>
            )}

            {/* IV/IO MODAL */}
            {activeModal === 'IV_ACCESS' && (
               <div className="space-y-4">
                 <div className="grid grid-cols-2 gap-2">
                    <button onClick={()=>setIvSite('IV')} className={`p-4 rounded-xl border font-bold ${ivSite==='IV'?'bg-blue-600 border-blue-400':'bg-gray-700 border-gray-600'}`}>Peripheral IV</button>
                    <button onClick={()=>setIvSite('IO')} className={`p-4 rounded-xl border font-bold ${ivSite==='IO'?'bg-orange-600 border-orange-400':'bg-gray-700 border-gray-600'}`}>IO (Bone)</button>
                 </div>
                 <div className="grid grid-cols-2 gap-2">
                    <button onClick={()=>setIvType('NSS 0.9%')} className={`p-2 rounded-lg border font-bold text-sm ${ivType==='NSS 0.9%'?'bg-blue-600 border-blue-400':'bg-gray-700 border-gray-600'}`}>NSS 0.9%</button>
                    <button onClick={()=>setIvType('Acetar')} className={`p-2 rounded-lg border font-bold text-sm ${ivType==='Acetar'?'bg-blue-600 border-blue-400':'bg-gray-700 border-gray-600'}`}>Acetar</button>
                 </div>
                 <div className="grid grid-cols-2 gap-2">
                    <button onClick={()=>setIvRate('KVO')} className={`p-2 rounded-lg border font-bold text-sm ${ivRate==='KVO'?'bg-blue-600 border-blue-400':'bg-gray-700 border-gray-600'}`}>KVO</button>
                    <button onClick={()=>setIvRate('Free Flow')} className={`p-2 rounded-lg border font-bold text-sm ${ivRate==='Free Flow'?'bg-blue-600 border-blue-400':'bg-gray-700 border-gray-600'}`}>Free Flow</button>
                 </div>
                 <button onClick={() => { dispatch({type:'ESTABLISH_IV', detail:`${ivSite} ${ivType} (${ivRate})`}); setActiveModal('NONE'); }} className="w-full py-3 bg-green-600 rounded-xl font-bold">Confirm</button>
               </div>
            )}

            {/* OTHER MEDS */}
            {activeModal === 'OTHER_MEDS' && (
               <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => { dispatch({type:'ADMINISTER_MED', medName:'Atropine'}); setActiveModal('NONE'); }} className="p-4 bg-gray-700 rounded-xl border border-gray-600">
                    <div className="text-lg font-bold text-yellow-400">Atropine</div>
                    <div className="text-[10px] text-gray-400">0.5mg</div>
                  </button>
                  <button onClick={() => { dispatch({type:'ADMINISTER_MED', medName:'Magnesium Sulfate'}); setActiveModal('NONE'); }} className="p-4 bg-gray-700 rounded-xl border border-gray-600">
                    <div className="text-lg font-bold text-purple-400">Magnesium</div>
                    <div className="text-[10px] text-gray-400">2g Diluted</div>
                  </button>
                  <button onClick={() => { dispatch({type:'ADMINISTER_MED', medName:'Sodium Bicarbonate'}); setActiveModal('NONE'); }} className="p-4 bg-gray-700 rounded-xl border border-gray-600">
                    <div className="text-lg font-bold text-blue-400">Sod. Bicarb</div>
                    <div className="text-[10px] text-gray-400">50 mEq</div>
                  </button>
                  <button onClick={() => { dispatch({type:'ADMINISTER_MED', medName:'Lidocaine'}); setActiveModal('NONE'); }} className="p-4 bg-gray-700 rounded-xl border border-gray-600">
                    <div className="text-lg font-bold text-cyan-400">Lidocaine</div>
                    <div className="text-[10px] text-gray-400">1-1.5 mg/kg</div>
                  </button>
                  <button onClick={() => { dispatch({type:'ADMINISTER_MED', medName:'Dopamine'}); setActiveModal('NONE'); }} className="p-4 bg-red-900/30 rounded-xl border border-red-800">
                    <div className="text-lg font-bold text-red-300">Dopamine</div>
                    <div className="text-[10px] text-red-200">Start Drip</div>
                  </button>
                  <button onClick={() => { dispatch({type:'ADMINISTER_MED', medName:'Calcium Gluconate'}); setActiveModal('NONE'); }} className="p-4 bg-gray-700 rounded-xl border border-gray-600">
                    <div className="text-lg font-bold text-white">Calcium</div>
                    <div className="text-[10px] text-gray-400">10%</div>
                  </button>
               </div>
            )}
            
            {/* LABS SELECTION MODAL */}
            {activeModal === 'LABS' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 mb-2">
                        {LAB_OPTIONS.map(lab => (
                            <button key={lab} onClick={() => toggleLabSelection(lab)} className={`p-3 rounded-lg font-bold flex items-center gap-2 ${selectedLabs.includes(lab) ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                                {selectedLabs.includes(lab) ? <CheckSquare size={18} /> : <Square size={18} className="opacity-50" />}
                                {lab}
                            </button>
                        ))}
                    </div>

                    {/* DTX Numpad - Shown when DTX is selected */}
                    {selectedLabs.includes('DTX') && (
                        <div className="bg-gray-700/50 p-3 rounded-xl border border-gray-600 animate-in fade-in zoom-in-95 duration-200">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm text-pink-300 font-bold">DTX Value:</span>
                                <span className="text-xl font-mono bg-black/40 px-3 py-1 rounded min-w-[80px] text-right">{dtxValue || '-'}</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1">
                                {[1,2,3,4,5].map(n => (
                                    <button key={n} onClick={()=>setDtxValue(p=>p+n.toString())} className="bg-gray-600 p-3 rounded text-lg font-bold hover:bg-gray-500 active:bg-gray-400">{n}</button>
                                ))}
                                {[6,7,8,9,0].map(n => (
                                    <button key={n} onClick={()=>setDtxValue(p=>p+n.toString())} className="bg-gray-600 p-3 rounded text-lg font-bold hover:bg-gray-500 active:bg-gray-400">{n}</button>
                                ))}
                                <button onClick={()=>setDtxValue('')} className="bg-red-900/50 hover:bg-red-800 text-red-200 text-xs rounded font-bold">CLR</button>
                                <button onClick={()=>setDtxValue(p=>p+'00')} className="bg-gray-600 hover:bg-gray-500 text-xs rounded font-bold">00</button>
                                <button onClick={()=>setDtxValue(p=>p+'.')} className="bg-gray-600 hover:bg-gray-500 text-lg rounded font-bold">.</button>
                                <button onClick={submitLabs} className="col-span-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded flex items-center justify-center">OK</button>
                            </div>
                        </div>
                    )}

                    <div className="flex gap-2">
                        <input type="text" value={customLab} onChange={(e) => setCustomLab(e.target.value)} className="bg-gray-700 border-gray-600 rounded p-2 flex-1" placeholder="Other..." />
                        <button onClick={submitLabs} className="bg-indigo-600 px-4 rounded font-bold">Add</button>
                    </div>
                    <button onClick={toggleSelectAllLabs} className="text-xs text-indigo-400 w-full text-right">Select All</button>
                </div>
            )}

            {/* PROCEDURES MODAL */}
            {activeModal === 'PROCEDURES' && (
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => { dispatch({type:'ADD_LOG', category:'PROCEDURE', action:'FAST Scan'}); setActiveModal('NONE'); }} className="bg-gray-700 p-3 rounded-xl font-bold">FAST Scan</button>
                    <button onClick={() => { dispatch({type:'ADD_LOG', category:'PROCEDURE', action:'Needle Decompress'}); setActiveModal('NONE'); }} className="bg-gray-700 p-3 rounded-xl font-bold">Needle Decompress</button>
                    <button onClick={() => { dispatch({type:'ADD_LOG', category:'PROCEDURE', action:'ICD Placement'}); setActiveModal('NONE'); }} className="bg-gray-700 p-3 rounded-xl font-bold">ICD Placement</button>
                    <button onClick={() => { dispatch({type:'ADD_LOG', category:'PROCEDURE', action:'Pericardiocentesis'}); setActiveModal('NONE'); }} className="bg-gray-700 p-3 rounded-xl font-bold text-xs">Pericardiocentesis</button>
                    <button onClick={() => { dispatch({type:'ADD_LOG', category:'PROCEDURE', action:'Consult MED'}); setActiveModal('NONE'); }} className="bg-blue-800 p-3 rounded-xl font-bold">Consult MED</button>
                    <button onClick={() => { dispatch({type:'ADD_LOG', category:'PROCEDURE', action:'Consult Sx'}); setActiveModal('NONE'); }} className="bg-blue-800 p-3 rounded-xl font-bold">Consult Sx</button>
                </div>
            )}
            
            {/* ROSC CHECKLIST MODAL */}
            {activeModal === 'ROSC_CHECKLIST' && (
                <div className="space-y-3">
                    <h4 className="text-green-400 font-bold text-center">Post-Resuscitation Care</h4>
                    {Object.entries(roscChecklist).map(([key, checked]) => (
                      <div key={key} onClick={() => handleRoscCheck(key)} className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer ${checked ? 'bg-green-900/40 border-green-500' : 'bg-gray-700 border-gray-600'}`}>
                          <div className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-green-500 border-green-500' : 'border-gray-500'}`}>
                              {checked && <CheckCircle size={14} className="text-white"/>}
                          </div>
                          <p className={`font-bold text-xs ${checked ? 'text-green-200' : 'text-gray-300'}`}>{ROSC_CHECKLIST_LABELS[key] || key}</p>
                      </div>
                    ))}
                </div>
            )}
            
            {/* TOR MODAL */}
            {activeModal === 'TOR' && (
              <div className="space-y-4">
                <h3 className="text-red-500 font-bold text-center text-xl">Termination of Resuscitation</h3>
                <div className="bg-red-900/20 p-4 rounded-xl border border-red-800">
                    <p className="text-gray-300 text-sm font-bold mb-2">Consider termination if:</p>
                    <ul className="list-disc pl-5 text-sm text-gray-300 space-y-1">
                      <li>Unwitnessed arrest</li>
                      <li>No bystander CPR</li>
                      <li>No ROSC after full ACLS</li>
                      <li>No shocks delivered</li>
                    </ul>
                </div>
                <button onClick={() => { dispatch({type:'ADD_LOG', category:'INFO', action:'DECISION', detail:'Terminate Resuscitation'}); setActiveModal('NONE'); }} className="w-full py-4 bg-red-800 hover:bg-red-700 border border-red-600 rounded-xl font-bold mt-2 shadow-lg flex items-center justify-center gap-2">
                  <Skull size={20}/> Confirm Termination
                </button>
              </div>
            )}
            
            {/* RHYTHM SELECT */}
            {activeModal === 'RHYTHM_SELECT' && (
               <div className="space-y-4">
                  <div>
                    <h4 className="text-red-400 font-bold text-sm uppercase mb-2">Shockable</h4>
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={()=>{dispatch({type:'CHANGE_RHYTHM', rhythm:'VF'}); setActiveModal('NONE')}} className="p-4 bg-red-900/50 border border-red-600 hover:bg-red-800 rounded-xl font-bold flex flex-col items-center"><Zap size={24} className="mb-1"/> VF</button>
                        <button onClick={()=>{dispatch({type:'CHANGE_RHYTHM', rhythm:'pVT'}); setActiveModal('NONE')}} className="p-4 bg-red-900/50 border border-red-600 hover:bg-red-800 rounded-xl font-bold flex flex-col items-center"><Activity size={24} className="mb-1"/> pVT</button>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-blue-400 font-bold text-sm uppercase mb-2">Non-Shockable</h4>
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={()=>{dispatch({type:'CHANGE_RHYTHM', rhythm:'Asystole'}); setActiveModal('NONE')}} className="p-4 bg-slate-800 border border-slate-600 hover:bg-slate-700 rounded-xl font-bold text-gray-300">Asystole</button>
                        <button onClick={()=>{dispatch({type:'CHANGE_RHYTHM', rhythm:'PEA'}); setActiveModal('NONE')}} className="p-4 bg-slate-800 border border-slate-600 hover:bg-slate-700 rounded-xl font-bold text-gray-300">PEA</button>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-gray-700">
                     <button onClick={()=>{dispatch({type:'CHANGE_RHYTHM', rhythm:'ROSC'}); setActiveModal('ROSC_CHECKLIST')}} className="w-full p-4 bg-green-800 border border-green-600 hover:bg-green-700 rounded-xl font-bold text-white flex items-center justify-center gap-2"><CheckCircle size={20}/> ROSC (Pulse Palpable)</button>
                  </div>
               </div>
            )}
          </div>
        </div>
      )}

      {/* --- START WIZARD (HN Input) --- */}
      {(state.viewMode === 'WIZARD') && (
        <div className="absolute inset-0 z-40 bg-gray-900 flex flex-col justify-center items-center p-6 space-y-6 overflow-y-auto">
           <div className="text-center">
             <Activity className="w-20 h-20 text-red-500 mx-auto mb-4 animate-pulse" />
             <h1 className="text-4xl font-bold text-white">Digital ACLS 2025</h1>
             <p className="text-gray-400 mt-2">Smart Recorder</p>
           </div>
           <div className="w-full bg-gray-800 p-6 rounded-3xl border border-gray-700 space-y-4">
              <input type="text" className="w-full bg-gray-900 p-3 rounded-xl border border-gray-600 text-white placeholder-gray-400" value={patient.hn} onChange={e=>setPatient({...patient, hn:e.target.value})} placeholder="HN / ID" />
              <input type="text" className="w-full bg-gray-900 p-3 rounded-xl border border-gray-600 text-white placeholder-gray-400" value={patient.name} onChange={e=>setPatient({...patient, name:e.target.value})} placeholder="Name" />
              <input type="text" className="w-full bg-gray-900 p-3 rounded-xl border border-gray-600 text-white placeholder-gray-400" value={patient.leaderName} onChange={e=>setPatient({...patient, leaderName:e.target.value})} placeholder="Leader Name" />
              <p className="text-xs text-gray-500 text-center pt-2">* สามารถกดข้ามเพื่อเริ่มทันที และใส่ข้อมูลย้อนหลังได้</p>
           </div>
           <div className="w-full grid grid-cols-2 gap-4">
              <button onClick={()=>handleStart('VF')} className="p-6 bg-red-700 hover:bg-red-600 rounded-3xl font-bold text-lg flex flex-col items-center gap-2 border-2 border-red-500 transition-colors"><Zap size={36}/> VF / pVT</button>
              <button onClick={()=>handleStart('Asystole')} className="p-6 bg-slate-800 hover:bg-slate-700 rounded-3xl font-bold text-lg flex flex-col items-center gap-2 border-2 border-slate-600 text-gray-300 transition-colors"><Activity size={36}/> Asystole</button>
           </div>
           {/* Back to Survey option if user wants to go back */}
           <button onClick={() => dispatch({type:'UPDATE_SURVEY', field:'avpu', value: state.survey.avpu ? state.survey.avpu : 'A'})} className="text-gray-500 text-sm">Back to Survey (Reset view)</button>
        </div>
      )}

      {/* --- HEADER TIMERS (Clean & Big) + CCF --- */}
      {state.viewMode === 'RECORDER' && (
      <>
        <div className="bg-gray-800 p-4 border-b border-gray-700 shadow-lg z-10 grid grid-cols-3 gap-2 sticky top-0 items-center">
           <div className="text-center border-r border-gray-600 pr-2">
              <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Total Time</span>
              <div className="text-2xl font-mono font-bold text-white mt-1">{formatTime(state.totalSeconds)}</div>
           </div>
           <div className="text-center border-r border-gray-600 pr-2 flex flex-col items-center">
              <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold flex items-center gap-1"><Gauge size={10}/> CCF</span>
              <div className={`text-2xl font-mono font-bold mt-1 ${state.ccfPercentage >= 80 ? 'text-green-400' : 'text-yellow-400'}`}>{state.ccfPercentage}%</div>
           </div>
           <div className={`text-center rounded-xl transition-all duration-500 flex flex-col items-center justify-center ${state.cycleSeconds > 110 ? 'bg-red-900/90 animate-pulse' : ''}`}>
              <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold flex items-center gap-1"><Clock size={10}/> CPR</span>
              <div className={`text-2xl font-mono font-bold mt-1 ${state.cycleSeconds > 110 ? 'text-red-100':'text-green-400'}`}>{formatTime(state.cycleSeconds)}</div>
           </div>
        </div>

      <div className="flex-1 overflow-y-auto p-4 pb-32">
         
         {/* STATUS BAR */}
         <div className="grid grid-cols-2 gap-3 mb-4">
            <button className="bg-gray-800 p-3 rounded-2xl border border-gray-700 relative overflow-hidden active:scale-95" onClick={() => setActiveModal('RHYTHM_SELECT')}>
               <span className="text-[10px] text-gray-400 uppercase font-bold">Rhythm</span>
               <div className={`text-xl font-bold truncate ${isShockable ? 'text-red-400' : 'text-white'}`}>{state.currentRhythm}</div>
               <Activity className="absolute right-2 bottom-2 text-gray-600 opacity-20" size={32}/>
            </button>
            <button onClick={() => dispatch({type:'TOGGLE_AUTO_CPR'})} className={`p-2 rounded-2xl border flex items-center justify-between px-4 relative transition-all ${state.isAutoCPR ? 'bg-blue-900/50 border-blue-400':'bg-gray-800 border-gray-700'}`}>
               <div className="text-left">
                  <span className="block text-[10px] font-bold uppercase text-gray-400">Mechanical</span>
                  <span className={`block text-xl font-bold ${state.isAutoCPR?'text-blue-100':'text-gray-500'}`}>{state.isAutoCPR ? 'ON' : 'OFF'}</span>
               </div>
               <HeartPulse size={24} className={state.isAutoCPR ? 'text-blue-400 animate-pulse':'text-gray-600'}/>
            </button>
         </div>

         {/* --- MAIN GRID (Less crowded, badges added) --- */}
         <div className="grid grid-cols-2 gap-3">
            
            {/* SHOCK - Disabled if non-shockable */}
            <button 
                onClick={() => {
                   if (isShockable) {
                       setEnergy('200');
                       setActiveModal('SHOCK_ENERGY');
                   }
                }} 
                disabled={!isShockable}
                className={`relative p-4 rounded-2xl font-black text-xl flex flex-col items-center justify-center gap-1 shadow-lg transition-all ${isShockable ? 'bg-yellow-500 hover:bg-yellow-400 text-black active:scale-95' : 'bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed grayscale opacity-50'}`}
            >
               {isShockable && <Badge count={state.shockCount} color="bg-black text-yellow-500" />}
               <Zap size={28} fill={isShockable ? "black" : "none"}/> 
               <span>SHOCK</span>
               <span className="text-xs font-normal opacity-70">{isShockable ? 'Select Energy' : 'Not Indicated'}</span>
            </button>

            {/* RESET */}
             <button onClick={()=>dispatch({type:'RESET_CYCLE'})} className="bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-2xl font-bold text-xl flex flex-col items-center justify-center gap-1 shadow-lg active:scale-95 transition-all">
               <RotateCcw size={28}/> 
               <span>RESET</span>
               <span className="text-xs font-normal opacity-70">New Cycle</span>
            </button>
            
            {/* ADRENALINE (BIG RED) */}
            <button onClick={() => dispatch({type:'ADMINISTER_MED', medName:'Adrenaline'})} className={`col-span-2 relative p-5 rounded-2xl font-bold flex flex-col items-center justify-center border-2 transition-all active:scale-95 ${isEpiReady() ? 'bg-red-900/40 border-red-600 hover:bg-red-900/60' : 'bg-gray-800 border-gray-700 opacity-60 cursor-not-allowed'}`}>
               <Badge count={state.epiDoseCount} />
               <div className="flex items-center gap-3">
                 <Syringe size={32} className={isEpiReady()?'text-red-400':'text-gray-500'}/>
                 <div className="text-center">
                    <span className="text-2xl text-white block">ADRENALINE</span>
                    <span className={`text-sm font-normal ${isEpiReady() ? 'text-green-400':'text-red-400'}`}>{isEpiReady() ? '1mg IV/IO Ready' : 'Wait (Cooldown)'}</span>
                 </div>
               </div>
            </button>
            
            {/* AMIODARONE */}
            <button 
                onClick={() => dispatch({type:'ADMINISTER_MED', medName:'Amiodarone'})} 
                disabled={state.amioDoseCount >= 2 || !isShockable} 
                className={`relative p-4 rounded-2xl font-bold flex flex-col items-center bg-purple-900/30 border border-purple-700 active:scale-95 transition-all ${(state.amioDoseCount >= 2 || !isShockable) && 'opacity-30 grayscale cursor-not-allowed'}`}
            >
               <Badge count={state.amioDoseCount} color="bg-purple-500" />
               <Syringe size={24} className="text-purple-300"/>
               <span className="mt-1 text-lg">AMIODARONE</span>
               <span className="text-xs text-gray-400 font-normal">
                   {!isShockable ? 'Not Indicated' : (state.amioDoseCount === 0 ? '300mg' : '150mg')}
               </span>
            </button>

            {/* AIRWAY */}
            <button onClick={() => setActiveModal('ETT')} className={`p-4 rounded-2xl font-bold flex flex-col items-center border active:scale-95 transition-all ${state.airwaySecure ? 'bg-teal-900/40 border-teal-500 text-teal-100' : 'bg-gray-800 border-gray-700 text-gray-300'}`}>
               <Stethoscope size={24} className={state.airwaySecure ? "text-teal-400" : "text-gray-500"}/>
               <span className="mt-1 text-lg">AIRWAY</span>
               <span className="text-xs opacity-70 font-normal">{state.airwaySecure ? 'Secured' : 'BVM / ETT'}</span>
            </button>

            {/* SECONDARY ROW */}
            <div className="col-span-2 grid grid-cols-4 gap-2 mt-2">
               {/* Summary Button replacing Undo */}
               <button 
                 onClick={() => setActiveModal('SUMMARY')}
                 onDoubleClick={() => dispatch({type: 'UNDO'})} 
                 className="bg-gray-800 border border-gray-700 p-2 rounded-xl flex flex-col items-center justify-center gap-1 active:bg-gray-700"
               >
                 <Undo2 size={18} className="text-gray-300"/>
                 <span className="text-[9px] text-gray-300">SUMMARY</span>
               </button>

               <button onClick={()=>setActiveModal('IV_ACCESS')} className={`${state.ivAccessEstablished ? 'bg-cyan-900/40 border-cyan-500' : 'bg-gray-800 border-gray-700'} border p-2 rounded-xl flex flex-col items-center justify-center gap-1 active:bg-gray-700`}>
                  <Droplet size={18} className={state.ivAccessEstablished ? "text-cyan-200" : "text-cyan-400"}/>
                  <span className={`text-[9px] ${state.ivAccessEstablished ? "text-cyan-100" : "text-gray-400"}`}>IV/IO</span>
               </button>
               <button onClick={()=>setActiveModal('VS_NOTE')} className="bg-gray-800 border border-gray-700 p-2 rounded-xl flex flex-col items-center justify-center gap-1 active:bg-gray-700"><MessageSquare size={18} className="text-yellow-400"/><span className="text-[9px] text-gray-400">VS / NOTE</span></button>
               <button onClick={()=>setActiveModal('LABS')} className={`${state.labsSent ? 'bg-indigo-900/40 border-indigo-500' : 'bg-gray-800 border-gray-700'} border p-2 rounded-xl flex flex-col items-center justify-center gap-1 active:bg-gray-700`}>
                  <TestTube size={18} className={state.labsSent ? "text-indigo-200" : "text-purple-400"}/>
                  <span className={`text-[9px] ${state.labsSent ? "text-indigo-100" : "text-gray-400"}`}>LABS</span>
               </button>
            </div>
            
            {/* PROCEDURES & ROSC & TOR & 6H6T */}
            <div className="col-span-2 grid grid-cols-4 gap-2">
               <button onClick={()=>setActiveModal('PROCEDURES')} className="bg-gray-800 border border-gray-700 p-3 rounded-xl flex flex-col items-center justify-center gap-1 active:bg-gray-700 font-bold text-sm text-gray-300"><ClipboardList size={16}/> <span className="text-[10px]">PROCS</span></button>
               <button onClick={()=>setActiveModal('DIAGNOSIS')} className="bg-gray-800 border border-gray-700 p-3 rounded-xl flex flex-col items-center justify-center gap-1 active:bg-gray-700 font-bold text-sm text-yellow-500"><HelpCircle size={16}/> <span className="text-[10px]">6H 6T</span></button>
               <button onClick={()=>setActiveModal('ROSC_CHECKLIST')} className="bg-gray-800 border border-gray-700 p-3 rounded-xl flex flex-col items-center justify-center gap-1 active:bg-gray-700 font-bold text-sm text-green-400"><CheckCircle size={16}/> <span className="text-[10px]">ROSC</span></button>
               <button onClick={()=>setActiveModal('TOR')} className="bg-gray-800 border border-gray-700 p-3 rounded-xl flex flex-col items-center justify-center gap-1 active:bg-gray-700 font-bold text-sm text-red-400"><Skull size={16}/> <span className="text-[10px]">TOR</span></button>
            </div>
         </div>
      </div>
      </>
      )}

      {/* 6. BOTTOM BAR (CPR Flow & Summary) */}
      {state.viewMode === 'RECORDER' && (
      <div className="bg-gray-900 border-t border-gray-800 p-4 sticky bottom-0 safe-area-bottom z-20 shadow-[0_-5px_15px_rgba(0,0,0,0.5)] flex gap-3">
         <button onClick={() => setActiveModal('SUMMARY')} className="flex-1 flex items-center justify-center gap-2 px-2 py-4 bg-gray-800 text-white rounded-2xl hover:bg-gray-700 transition-colors font-bold text-sm active:scale-95 border border-gray-700">
             <FileText size={16} className="text-gray-400"/> SUMMARY
         </button>
         <button onClick={() => alert('Navigating to CPR Flow')} className="flex-[3] flex items-center justify-center gap-2 px-4 py-4 bg-gray-800 text-white rounded-2xl hover:bg-gray-700 transition-colors font-bold text-lg active:scale-95 border border-gray-700">
             CPR FLOW VIEW
         </button>
      </div>
      )}

    </div>
  );
}