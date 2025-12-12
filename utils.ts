export const formatTime = (ms: number): string => {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export const getTimestamp = (startTime: number | null): string => {
  if (!startTime) return "00:00";
  return formatTime(Date.now() - startTime);
};

// Simple beep for alarms (Base64 wav)
const BEEP_URL = "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU"; // Truncated for brevity, using console log for "beep" in this environment
export const playAlarm = () => {
    // In a real browser environment, we would use AudioContext or an <audio> tag.
    // implementing a gentle tick
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.value = 0.1;
            osc.start();
            setTimeout(() => osc.stop(), 100);
        }
    } catch (e) {
        console.error("Audio play failed", e);
    }
};