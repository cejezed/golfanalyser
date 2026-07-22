"use client";

import {
  Activity,
  BarChart3,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Dumbbell,
  ExternalLink,
  Gauge,
  ListChecks,
  Pause,
  Play,
  RefreshCcw,
  Repeat2,
  RotateCcw,
  Save,
  ScanLine,
  Scissors,
  Smartphone,
  Square,
  Star,
  Target,
  Timer,
  Upload,
  Video,
  Waves
} from "lucide-react";
import {
  ChangeEvent,
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

type Handedness = "right" | "left";
type TargetSide = "left" | "right";
type CameraView = "face-on" | "down-the-line";
type MetricStatus = "good" | "warn" | "bad";
type VideoOrientation = "landscape" | "portrait" | "square";
type VideoLoadState = "empty" | "selected" | "loading" | "metadata" | "ready" | "error";
type ShotResult = "unknown" | "brilliant" | "straight" | "fat" | "thin" | "push" | "pull" | "slice";

type Landmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
};

type PoseResult = {
  landmarks?: Landmark[][];
  worldLandmarks?: Landmark[][];
};

type PoseLandmarkerLike = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => PoseResult;
  close?: () => void;
};

type SwingMetric = {
  id: string;
  label: string;
  value: string;
  detail: string;
  score: number;
  status: MetricStatus;
  icon: "head" | "arm" | "connection" | "shoulder" | "center";
};

type SessionEntry = {
  id: string;
  date: string;
  club: string;
  score: number;
  focus: string;
  shot: ShotResult;
  cameraView: CameraView;
  confidence: number;
  cue?: string;
};

type SwingWindow = {
  start: number;
  end: number;
  peak: number;
};

type BestSwing = {
  name: string;
  url: string;
  savedAt: string;
  score: number;
  focus: string;
  window: SwingWindow | null;
};

type BestSwingRecord = Omit<BestSwing, "url"> & {
  id: "best";
  blob: Blob;
};

type SwingPhase = {
  id: "address" | "takeaway" | "top" | "impact" | "finish";
  label: string;
  time: number;
  cue: string;
};

type MotionPoint = {
  time: number;
  head: {
    x: number;
    y: number;
  };
  center: {
    x: number;
    y: number;
  };
  shoulderWidth: number;
};

type MotionSummary = {
  samples: number;
  headSwayPct: number;
  headVerticalPct: number;
  centerAwayPct: number;
  centerTargetPct: number;
  headScore: number;
  centerScore: number;
};

const SAGUTO_VIDEO_ID = "kA3VdS-LcQU";
const FRAME_STEP_SECONDS = 1 / 30;
const STORAGE_KEY = "saguto-swing-session-v1";
const BEST_SWING_DB = "saguto-swing-best-db";
const BEST_SWING_STORE = "swings";

const poseConnections = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28]
] as const;

const checkpoints = [
  {
    id: "setup",
    label: "Setup",
    cue: "Lead-side druk, handen licht voor de bal",
    target: "Smalle head box, sternum boven bal, rustige gripdruk"
  },
  {
    id: "takeaway",
    label: "Takeaway",
    cue: "Handen naar binnen, borst draait mee",
    target: "Geen losse arm-lift, club blijft voor de borst"
  },
  {
    id: "top",
    label: "Top",
    cue: "Lead shoulder down, trail leg iets langer",
    target: "Hoofd stabiel, lead arm lang, geen trail-side sway"
  },
  {
    id: "impact",
    label: "Impact",
    cue: "Body blijft draaien, handle wint van clubhead",
    target: "Borst stopt niet, armen blijven verbonden"
  }
];

const shotResults: Array<{ id: ShotResult; label: string }> = [
  { id: "unknown", label: "Geen" },
  { id: "brilliant", label: "Briljant" },
  { id: "straight", label: "Straight" },
  { id: "fat", label: "Fat" },
  { id: "thin", label: "Thin" },
  { id: "push", label: "Push" },
  { id: "pull", label: "Pull" },
  { id: "slice", label: "Slice" }
];

const referencePrinciples = [
  {
    title: "Weight forward",
    text: "Je centrum blijft stabiel of beweegt licht target-side, niet weg van de bal."
  },
  {
    title: "Shoulder down",
    text: "De lead shoulder werkt omlaag/in tijdens de backswing in plaats van vlak opzij."
  },
  {
    title: "Hands in",
    text: "De handen worden dieper door rotatie, niet door een losse arm-takeaway."
  },
  {
    title: "Arms straight",
    text: "Lead arm blijft lang genoeg om radius en laagste punt voorspelbaar te houden."
  },
  {
    title: "Body release",
    text: "Door impact blijft borst/heup doorroteren; de club rolt niet vroeg over de handen."
  }
];

const iconMap = {
  head: ScanLine,
  arm: Waves,
  connection: Activity,
  shoulder: Gauge,
  center: Target
};

const VIDEO_FILE_ACCEPT = [
  "video/*",
  ".mp4",
  ".m4v",
  ".mov",
  ".qt",
  ".webm",
  ".ogv",
  ".ogg",
  ".3gp",
  ".3gpp",
  ".avi",
  ".mkv"
].join(",");

const getFileExtension = (name: string) => {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
};

const describeSelectedFileType = (file: File) => {
  const extension = getFileExtension(file.name);
  if (file.type && extension) return `${file.type}, ${extension}`;
  if (file.type) return file.type;
  if (extension) return `${extension} bestand`;
  return "onbekend type";
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const formatPhaseTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00.0";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, "0")}.${tenths}`;
};

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "onbekende grootte";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const describeVideoError = (video: HTMLVideoElement | null) => {
  const error = video?.error;
  if (!error) return "Video kon niet worden geladen.";

  switch (error.code) {
    case 1:
      return "Video laden is afgebroken.";
    case 2:
      return "Netwerk- of bestandsfout tijdens het laden van de video.";
    case 3:
      return "De browser kan deze video niet decoderen. Probeer MP4 met H.264.";
    case 4:
      return "De browser kon dit videobestand niet afspelen. Probeer MP4/H.264, MOV/H.264 of WebM; iPhone HEVC/H.265 werkt niet op elk apparaat.";
    default:
      return error.message || "Video kon niet worden geladen.";
  }
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const scoreStatus = (score: number): MetricStatus => {
  if (score >= 78) return "good";
  if (score >= 56) return "warn";
  return "bad";
};

const distance = (a?: Landmark, b?: Landmark) => {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
};

const midpoint = (a?: Landmark, b?: Landmark): Landmark | undefined => {
  if (!a || !b) return undefined;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2
  };
};

const angle = (a?: Landmark, b?: Landmark, c?: Landmark) => {
  if (!a || !b || !c) return 0;
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!mag) return 0;
  const radians = Math.acos(clamp(dot / mag, -1, 1));
  return (radians * 180) / Math.PI;
};

const pointLineDistance = (point?: Landmark, lineA?: Landmark, lineB?: Landmark) => {
  if (!point || !lineA || !lineB) return 0;
  const numerator = Math.abs(
    (lineB.y - lineA.y) * point.x -
      (lineB.x - lineA.x) * point.y +
      lineB.x * lineA.y -
      lineB.y * lineA.x
  );
  const denominator = Math.hypot(lineB.y - lineA.y, lineB.x - lineA.x);
  return denominator ? numerator / denominator : 0;
};

const lineAngle = (a?: Landmark, b?: Landmark) => {
  if (!a || !b) return 0;
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
};

const extractMotionPoint = (landmarks: Landmark[], time: number): MotionPoint | null => {
  const head = landmarks[0];
  const shoulderMid = midpoint(landmarks[11], landmarks[12]);
  const hipMid = midpoint(landmarks[23], landmarks[24]);
  const center = midpoint(shoulderMid, hipMid);
  const shoulderWidth = distance(landmarks[11], landmarks[12]);

  if (!head || !center || !shoulderWidth) return null;

  return {
    time,
    head: {
      x: head.x,
      y: head.y
    },
    center: {
      x: center.x,
      y: center.y
    },
    shoulderWidth: Math.max(shoulderWidth, 0.08)
  };
};

const summarizeMotion = (
  trace: MotionPoint[],
  baselinePoint: MotionPoint | null,
  targetSide: TargetSide
): MotionSummary | null => {
  if (!trace.length) return null;

  const origin = baselinePoint ?? trace[0];
  const shoulderWidth = origin.shoulderWidth || trace[0].shoulderWidth || 0.08;
  const targetSign = targetSide === "left" ? -1 : 1;
  const centerMoves = trace.map(
    (point) => ((point.center.x - origin.center.x) * targetSign * 100) / shoulderWidth
  );

  const headSwayPct = Math.max(
    ...trace.map((point) => (Math.abs(point.head.x - origin.head.x) * 100) / shoulderWidth)
  );
  const headVerticalPct = Math.max(
    ...trace.map((point) => (Math.abs(point.head.y - origin.head.y) * 100) / shoulderWidth)
  );
  const centerAwayPct = Math.abs(Math.min(0, ...centerMoves));
  const centerTargetPct = Math.max(0, ...centerMoves);

  return {
    samples: trace.length,
    headSwayPct,
    headVerticalPct,
    centerAwayPct,
    centerTargetPct,
    headScore: clamp(105 - headSwayPct * 3.2),
    centerScore: clamp(102 - centerAwayPct * 4.2)
  };
};

const buildMotionPath = (
  trace: MotionPoint[],
  origin: MotionPoint | null,
  selector: (point: MotionPoint) => { x: number; y: number }
) => {
  if (!trace.length || !origin) return "";
  const shoulderWidth = origin.shoulderWidth || trace[0].shoulderWidth || 0.08;
  const originPoint = selector(origin);

  return trace
    .map((point, index) => {
      const selected = selector(point);
      const x = clamp(50 + ((selected.x - originPoint.x) * 44) / shoulderWidth, 4, 96);
      const y = clamp(26 + ((selected.y - originPoint.y) * 44) / shoulderWidth, 4, 48);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
};

const waitForSeek = (video: HTMLVideoElement, time: number) =>
  new Promise<void>((resolve, reject) => {
    const maxSeekTime = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.02) : time;
    const targetTime = clamp(time, 0, maxSeekTime);
    let timeoutId: number | null = null;
    const cleanup = () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Video seek mislukt."));
    };

    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Video seek duurde te lang."));
    }, 3000);

    if (Math.abs(video.currentTime - targetTime) < 0.02 && video.readyState >= 2) {
      cleanup();
      window.setTimeout(resolve, 0);
      return;
    }

    video.currentTime = targetTime;
  });

const motionEnergy = (previous: Landmark[] | null, current: Landmark[]) => {
  if (!previous) return 0;

  const shoulderWidth = Math.max(distance(current[11], current[12]), 0.08);
  const points = [
    { index: 0, weight: 0.8 },
    { index: 11, weight: 1 },
    { index: 12, weight: 1 },
    { index: 15, weight: 1.8 },
    { index: 16, weight: 1.8 },
    { index: 23, weight: 1.1 },
    { index: 24, weight: 1.1 },
    { index: 27, weight: 0.7 },
    { index: 28, weight: 0.7 }
  ];

  const totalWeight = points.reduce((total, point) => total + point.weight, 0);
  const total = points.reduce((sum, point) => {
    const from = previous[point.index];
    const to = current[point.index];
    if (!from || !to) return sum;
    return sum + (distance(from, to) / shoulderWidth) * point.weight;
  }, 0);

  return total / totalWeight;
};

const detectSwingWindow = (
  samples: Array<{ time: number; energy: number }>,
  duration: number
): SwingWindow | null => {
  const activeSamples = samples.filter((sample) => Number.isFinite(sample.energy));
  if (activeSamples.length < 3 || !duration) return null;

  const peakSample = activeSamples.reduce((best, sample) =>
    sample.energy > best.energy ? sample : best
  );
  const sortedEnergy = [...activeSamples].map((sample) => sample.energy).sort((a, b) => a - b);
  const median = sortedEnergy[Math.floor(sortedEnergy.length / 2)] ?? 0;
  const meaningfulSamples = activeSamples.filter((sample) => sample.energy >= 0.012);
  if (peakSample.energy < 0.012 || meaningfulSamples.length < 3) return null;
  const threshold = Math.max(peakSample.energy * 0.26, median * 1.75, 0.012);
  const peakIndex = samples.findIndex((sample) => sample.time === peakSample.time);

  let startIndex = peakIndex;
  let endIndex = peakIndex;
  while (startIndex > 0 && samples[startIndex - 1].energy >= threshold) startIndex -= 1;
  while (endIndex < samples.length - 1 && samples[endIndex + 1].energy >= threshold) endIndex += 1;

  let start = Math.max(0, samples[startIndex].time - 0.55);
  let end = Math.min(duration, samples[endIndex].time + 0.75);

  if (end - start < 1.45) {
    start = Math.max(0, peakSample.time - 0.85);
    end = Math.min(duration, peakSample.time + 0.9);
  }

  if (end - start > 4.8) {
    start = Math.max(0, peakSample.time - 1.7);
    end = Math.min(duration, peakSample.time + 2.0);
  }

  return {
    start,
    end,
    peak: peakSample.time
  };
};

const buildSwingPhases = (window: SwingWindow, cameraView: CameraView): SwingPhase[] => {
  const backswingSpan = Math.max(window.peak - window.start, 0.25);
  const topTime = clamp(window.start + backswingSpan * 0.72, window.start, window.end);
  const takeawayTime = clamp(window.start + backswingSpan * 0.34, window.start, window.end);
  const impactTime = clamp(window.peak, window.start, window.end);

  return [
    {
      id: "address",
      label: "Address",
      time: window.start,
      cue: cameraView === "face-on" ? "Stack center en head box" : "Posture en afstand tot bal"
    },
    {
      id: "takeaway",
      label: "Takeaway",
      time: takeawayTime,
      cue: cameraView === "face-on" ? "Handen naar binnen" : "Hand path wordt dieper"
    },
    {
      id: "top",
      label: "Top",
      time: topTime,
      cue: cameraView === "face-on" ? "Geen sway weg van target" : "Posture blijft in lijn"
    },
    {
      id: "impact",
      label: "Impact",
      time: impactTime,
      cue: cameraView === "face-on" ? "Center target-side" : "Heupdiepte blijft behouden"
    },
    {
      id: "finish",
      label: "Finish",
      time: window.end,
      cue: "Balans en body release"
    }
  ];
};

const poseCoverageScore = (landmarks: Landmark[] | null) => {
  if (!landmarks) return 0;
  const indexes = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const visible = indexes.filter((index) => {
    const point = landmarks[index];
    return point && (point.visibility ?? point.presence ?? 1) > 0.35;
  }).length;

  return visible / indexes.length;
};

const openBestSwingDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(BEST_SWING_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BEST_SWING_STORE)) {
        db.createObjectStore(BEST_SWING_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB kon niet openen."));
  });

const saveBestSwingRecord = async (record: BestSwingRecord) => {
  const db = await openBestSwingDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(BEST_SWING_STORE, "readwrite");
    transaction.objectStore(BEST_SWING_STORE).put(record);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Beste swing kon niet worden opgeslagen."));
    };
  });
};

const loadBestSwingRecord = async () => {
  const db = await openBestSwingDb();
  return new Promise<BestSwingRecord | null>((resolve, reject) => {
    const transaction = db.transaction(BEST_SWING_STORE, "readonly");
    const request = transaction.objectStore(BEST_SWING_STORE).get("best");
    request.onsuccess = () => resolve((request.result as BestSwingRecord | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Beste swing kon niet laden."));
    transaction.oncomplete = () => db.close();
  });
};

const deleteBestSwingRecord = async () => {
  const db = await openBestSwingDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(BEST_SWING_STORE, "readwrite");
    transaction.objectStore(BEST_SWING_STORE).delete("best");
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Beste swing kon niet worden gewist."));
    };
  });
};

const buildMetrics = (
  current: Landmark[] | null,
  baseline: Landmark[] | null,
  handedness: Handedness,
  targetSide: TargetSide,
  cameraView: CameraView
): SwingMetric[] => {
  if (!current) {
    return [
      {
        id: "head-box",
        label: "Head box",
        value: "-",
        detail: "Analyseer een frame om sway zichtbaar te maken.",
        score: 0,
        status: "warn",
        icon: "head"
      },
      {
        id: "lead-arm",
        label: "Lead-arm radius",
        value: "-",
        detail: "Lead elbow, shoulder en wrist worden gemeten.",
        score: 0,
        status: "warn",
        icon: "arm"
      },
      {
        id: "connection",
        label: "Arm-body connection",
        value: "-",
        detail: "Meet hoeveel de lead arm loskomt van je torso.",
        score: 0,
        status: "warn",
        icon: "connection"
      },
      {
        id: "shoulder",
        label: "Lead shoulder down",
        value: "-",
        detail: "Vergelijkt lead shoulder met trail shoulder.",
        score: 0,
        status: "warn",
        icon: "shoulder"
      },
      {
        id: "center",
        label: "Stack center",
        value: "-",
        detail: "Kalibreer setup om center-drift te beoordelen.",
        score: 0,
        status: "warn",
        icon: "center"
      }
    ];
  }

  if (cameraView === "down-the-line") {
    const leftShoulder = current[11];
    const rightShoulder = current[12];
    const leftElbow = current[13];
    const rightElbow = current[14];
    const leftWrist = current[15];
    const rightWrist = current[16];
    const leftHip = current[23];
    const rightHip = current[24];
    const leadShoulder = handedness === "right" ? leftShoulder : rightShoulder;
    const leadElbow = handedness === "right" ? leftElbow : rightElbow;
    const leadHip = handedness === "right" ? leftHip : rightHip;
    const shoulderMid = midpoint(leftShoulder, rightShoulder);
    const hipMid = midpoint(leftHip, rightHip);
    const wristMid = midpoint(leftWrist, rightWrist);
    const baselineShoulderMid = baseline ? midpoint(baseline[11], baseline[12]) : undefined;
    const baselineHipMid = baseline ? midpoint(baseline[23], baseline[24]) : undefined;
    const baselineWristMid = baseline ? midpoint(baseline[15], baseline[16]) : undefined;
    const shoulderWidth = Math.max(distance(leftShoulder, rightShoulder), 0.08);
    const baselineShoulderWidth = baseline
      ? Math.max(distance(baseline[11], baseline[12]), 0.08)
      : shoulderWidth;

    const headVerticalPct = baseline
      ? (Math.abs(current[0].y - baseline[0].y) / baselineShoulderWidth) * 100
      : 0;
    const headScore = baseline ? clamp(105 - headVerticalPct * 3.2) : 58;

    const postureAngle = lineAngle(shoulderMid, hipMid);
    const baselinePostureAngle =
      baselineShoulderMid && baselineHipMid ? lineAngle(baselineShoulderMid, baselineHipMid) : postureAngle;
    const postureChange = Math.abs(postureAngle - baselinePostureAngle);
    const postureScore = baseline ? clamp(104 - postureChange * 4.5) : 58;

    const hipDepthPct =
      baseline && hipMid && baselineHipMid
        ? (Math.abs(hipMid.x - baselineHipMid.x) / baselineShoulderWidth) * 100
        : 0;
    const hipScore = baseline ? clamp(102 - hipDepthPct * 3.4) : 58;

    const handDepthPct =
      baseline && wristMid && baselineWristMid
        ? (Math.abs(wristMid.x - baselineWristMid.x) / baselineShoulderWidth) * 100
        : 0;
    const handScore = baseline ? clamp(42 + Math.min(handDepthPct * 2.8, 58)) : 58;

    const connectionRatio =
      pointLineDistance(leadElbow, leadShoulder, leadHip) / shoulderWidth;
    const connectionScore = clamp(112 - connectionRatio * 118);

    return [
      {
        id: "dtl-head",
        label: "Head level",
        value: baseline ? `${headVerticalPct.toFixed(0)}% SW` : "setup nodig",
        detail: baseline
          ? headVerticalPct <= 10
            ? "Hoofdhoogte blijft rustig door de swing."
            : "Veel op/neer beweging; contact en posture worden dan wisselvallig."
          : "Kalibreer address voor head-level analyse.",
        score: Math.round(headScore),
        status: scoreStatus(headScore),
        icon: "head"
      },
      {
        id: "dtl-posture",
        label: "Posture behoud",
        value: baseline ? `${postureChange.toFixed(0)} deg` : "setup nodig",
        detail: baseline
          ? postureChange <= 8
            ? "Spine/posture lijn blijft dicht bij setup."
            : "Posture verandert veel; dit lijkt op opkomen of early-extension risico."
          : "Kalibreer address om spine angle te vergelijken.",
        score: Math.round(postureScore),
        status: scoreStatus(postureScore),
        icon: "shoulder"
      },
      {
        id: "dtl-hip-depth",
        label: "Hip depth",
        value: baseline ? `${hipDepthPct.toFixed(0)}% SW` : "setup nodig",
        detail: baseline
          ? hipDepthPct <= 12
            ? "Heupcentrum blijft redelijk in dezelfde diepte."
            : "Heupen bewegen sterk horizontaal; check early extension of wegduwen van de bal."
          : "Kalibreer address voor heupdiepte.",
        score: Math.round(hipScore),
        status: scoreStatus(hipScore),
        icon: "center"
      },
      {
        id: "dtl-hands",
        label: "Hand path depth",
        value: baseline ? `${handDepthPct.toFixed(0)}% SW` : "setup nodig",
        detail: baseline
          ? handDepthPct >= 10
            ? "Handen veranderen zichtbaar van diepte; controleer of dit uit borstturn komt."
            : "Weinig hand-depth zichtbaar; takeaway kan te recht/armsy worden."
          : "Kalibreer setup en analyseer takeaway/top.",
        score: Math.round(handScore),
        status: scoreStatus(handScore),
        icon: "connection"
      },
      {
        id: "dtl-connection",
        label: "Arm-body connection",
        value: `${connectionRatio.toFixed(2)} SW`,
        detail:
          connectionRatio <= 0.45
            ? "Lead arm blijft dicht bij de torso-lijn."
            : "Lead arm komt los van de torso; zijkant-video toont dit vaak duidelijk.",
        score: Math.round(connectionScore),
        status: scoreStatus(connectionScore),
        icon: "arm"
      }
    ];
  }

  const leftShoulder = current[11];
  const rightShoulder = current[12];
  const leftElbow = current[13];
  const rightElbow = current[14];
  const leftWrist = current[15];
  const rightWrist = current[16];
  const leftHip = current[23];
  const rightHip = current[24];
  const leadShoulder = handedness === "right" ? leftShoulder : rightShoulder;
  const trailShoulder = handedness === "right" ? rightShoulder : leftShoulder;
  const leadElbow = handedness === "right" ? leftElbow : rightElbow;
  const leadWrist = handedness === "right" ? leftWrist : rightWrist;
  const leadHip = handedness === "right" ? leftHip : rightHip;
  const nose = current[0];
  const shoulderWidth = Math.max(distance(leftShoulder, rightShoulder), 0.08);

  const baselineShoulderWidth = baseline
    ? Math.max(distance(baseline[11], baseline[12]), 0.08)
    : shoulderWidth;
  const headSwayPct = baseline
    ? (Math.abs(nose.x - baseline[0].x) / baselineShoulderWidth) * 100
    : 0;
  const headScore = baseline ? clamp(104 - headSwayPct * 3.1) : 58;

  const leadArmAngle = angle(leadShoulder, leadElbow, leadWrist);
  const armScore = clamp(((leadArmAngle - 132) / 34) * 100);

  const connectionRatio =
    pointLineDistance(leadElbow, leadShoulder, leadHip) / shoulderWidth;
  const connectionScore = clamp(112 - connectionRatio * 118);

  const shoulderDropPx = leadShoulder.y - trailShoulder.y;
  const shoulderDropPct = (shoulderDropPx / shoulderWidth) * 100;
  const shoulderScore = clamp(54 + shoulderDropPct * 3.9);

  const targetSign = targetSide === "left" ? -1 : 1;
  const currentCenter = midpoint(midpoint(leftShoulder, rightShoulder), midpoint(leftHip, rightHip));
  const baselineCenter = baseline
    ? midpoint(midpoint(baseline[11], baseline[12]), midpoint(baseline[23], baseline[24]))
    : undefined;
  const centerMovePct =
    currentCenter && baselineCenter
      ? (((currentCenter.x - baselineCenter.x) * targetSign) / baselineShoulderWidth) * 100
      : 0;
  const centerScore = baseline ? clamp(72 + centerMovePct * 2.6) : 58;

  const shoulderTurn = baseline
    ? Math.abs(lineAngle(leftShoulder, rightShoulder) - lineAngle(baseline[11], baseline[12]))
    : 0;
  const connectionDetail =
    shoulderTurn > 12
      ? "Torso-lijn verandert mee; let op dat armen niet los liften."
      : "Weinig zichtbare torso-turn in dit frame; controleer takeaway/top.";

  return [
    {
      id: "head-box",
      label: "Head box",
      value: baseline ? `${headSwayPct.toFixed(0)}% SW` : "setup nodig",
      detail: baseline
        ? headSwayPct <= 12
          ? "Hoofd blijft binnen een bruikbare corridor."
          : "Te veel laterale drift; dit voelt vaak als terugzwaaien met armen."
        : "Klik bij address op Kalibreer voordat je backswing/impact analyseert.",
      score: Math.round(headScore),
      status: scoreStatus(headScore),
      icon: "head"
    },
    {
      id: "lead-arm",
      label: "Lead-arm radius",
      value: `${leadArmAngle.toFixed(0)} deg`,
      detail:
        leadArmAngle >= 155
          ? "Lead arm blijft lang genoeg voor voorspelbaar contact."
          : "Lead arm vouwt te vroeg; maak eerst kortere connected swings.",
      score: Math.round(armScore),
      status: scoreStatus(armScore),
      icon: "arm"
    },
    {
      id: "connection",
      label: "Arm-body connection",
      value: `${connectionRatio.toFixed(2)} SW`,
      detail:
        connectionRatio <= 0.45
          ? "Lead arm blijft dicht bij de torso-lijn."
          : `Lead arm komt los van je torso. ${connectionDetail}`,
      score: Math.round(connectionScore),
      status: scoreStatus(connectionScore),
      icon: "connection"
    },
    {
      id: "shoulder",
      label: "Lead shoulder down",
      value: `${shoulderDropPct.toFixed(0)}% SW`,
      detail:
        shoulderDropPct > 2
          ? "Lead shoulder werkt omlaag; dit past bij de Saguto/Stack-tilt feel."
          : "Lead shoulder blijft vlak of omhoog; maak de borstturn steiler.",
      score: Math.round(shoulderScore),
      status: scoreStatus(shoulderScore),
      icon: "shoulder"
    },
    {
      id: "center",
      label: "Stack center",
      value: baseline ? `${centerMovePct.toFixed(0)}% target` : "setup nodig",
      detail: baseline
        ? centerMovePct >= -4
          ? "Center blijft stabiel of target-side."
          : "Center beweegt van target af; contactpunt wordt dan moeilijker."
        : "Kalibreer setup voor center-drift en lead-side stack.",
      score: Math.round(centerScore),
      status: scoreStatus(centerScore),
      icon: "center"
    }
  ];
};

const drawPose = (
  canvas: HTMLCanvasElement | null,
  landmarks: Landmark[] | null,
  baseline: Landmark[] | null,
  trace: MotionPoint[] = []
) => {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const x = (point: Landmark) => point.x * rect.width;
  const y = (point: Landmark) => point.y * rect.height;

  if (baseline?.[0] && baseline[11] && baseline[12]) {
    const shoulderWidth = distance(baseline[11], baseline[12]);
    const boxW = shoulderWidth * rect.width * 0.34;
    const boxH = shoulderWidth * rect.height * 0.42;
    ctx.strokeStyle = "rgba(255, 210, 92, 0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.strokeRect(x(baseline[0]) - boxW / 2, y(baseline[0]) - boxH / 2, boxW, boxH);
    ctx.setLineDash([]);
  }

  if (!landmarks) return;

  if (trace.length > 1) {
    ctx.strokeStyle = "rgba(255, 149, 55, 0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    trace.forEach((point, index) => {
      const px = point.head.x * rect.width;
      const py = point.head.y * rect.height;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.strokeStyle = "rgba(88, 166, 255, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    trace.forEach((point, index) => {
      const px = point.center.x * rect.width;
      const py = point.center.y * rect.height;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(92, 190, 124, 0.95)";
  ctx.lineWidth = 3;
  for (const [a, b] of poseConnections) {
    if (!landmarks[a] || !landmarks[b]) continue;
    ctx.beginPath();
    ctx.moveTo(x(landmarks[a]), y(landmarks[a]));
    ctx.lineTo(x(landmarks[b]), y(landmarks[b]));
    ctx.stroke();
  }

  for (const index of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const point = landmarks[index];
    if (!point) continue;
    ctx.fillStyle = index === 0 ? "#ffd25c" : "#ffffff";
    ctx.strokeStyle = "rgba(47, 125, 79, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x(point), y(point), index === 0 ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const shoulderMid = midpoint(landmarks[11], landmarks[12]);
  const hipMid = midpoint(landmarks[23], landmarks[24]);
  if (shoulderMid && hipMid) {
    ctx.strokeStyle = "rgba(88, 166, 255, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x(shoulderMid), y(shoulderMid));
    ctx.lineTo(x(hipMid), y(hipMid));
    ctx.stroke();
  }
};

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const captureRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const recordStopRef = useRef<number | null>(null);
  const poseRef = useRef<PoseLandmarkerLike | null>(null);

  const [videoUrl, setVideoUrl] = useState("");
  const [videoName, setVideoName] = useState("");
  const [currentVideoBlob, setCurrentVideoBlob] = useState<Blob | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoOrientation, setVideoOrientation] = useState<VideoOrientation>("landscape");
  const [videoLoadState, setVideoLoadState] = useState<VideoLoadState>("empty");
  const [videoLoadMessage, setVideoLoadMessage] = useState("Geen video geladen.");
  const [speed, setSpeed] = useState(0.5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [handedness, setHandedness] = useState<Handedness>("right");
  const [targetSide, setTargetSide] = useState<TargetSide>("left");
  const [cameraView, setCameraView] = useState<CameraView>("face-on");
  const [club, setClub] = useState("7 iron");
  const [notes, setNotes] = useState("");
  const [shotResult, setShotResult] = useState<ShotResult>("unknown");
  const [activeCheckpoint, setActiveCheckpoint] = useState(checkpoints[0].id);
  const [analyzedCheckpoint, setAnalyzedCheckpoint] = useState<string | null>(null);
  const [poseStatus, setPoseStatus] = useState("Pose model nog niet geladen.");
  const [isPoseLoading, setIsPoseLoading] = useState(false);
  const [poseReady, setPoseReady] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);
  const [trackProgress, setTrackProgress] = useState(0);
  const [trimProgress, setTrimProgress] = useState(0);
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [baseline, setBaseline] = useState<Landmark[] | null>(null);
  const [motionTrace, setMotionTrace] = useState<MotionPoint[]>([]);
  const [swingWindow, setSwingWindow] = useState<SwingWindow | null>(null);
  const [swingPhases, setSwingPhases] = useState<SwingPhase[]>([]);
  const [isLoopingWindow, setIsLoopingWindow] = useState(true);
  const [bestSwing, setBestSwing] = useState<BestSwing | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  const metrics = useMemo(
    () => buildMetrics(landmarks, baseline, handedness, targetSide, cameraView),
    [baseline, cameraView, handedness, landmarks, targetSide]
  );
  const baselineMotion = useMemo(
    () => (baseline ? extractMotionPoint(baseline, 0) : null),
    [baseline]
  );
  const motionSummary = useMemo(
    () => summarizeMotion(motionTrace, baselineMotion, targetSide),
    [baselineMotion, motionTrace, targetSide]
  );
  const motionOrigin = baselineMotion ?? motionTrace[0] ?? null;
  const headPath = useMemo(
    () => buildMotionPath(motionTrace, motionOrigin, (point) => point.head),
    [motionOrigin, motionTrace]
  );
  const centerPath = useMemo(
    () => buildMotionPath(motionTrace, motionOrigin, (point) => point.center),
    [motionOrigin, motionTrace]
  );
  const poseCoverage = poseCoverageScore(landmarks);
  const analysisQualityScore = landmarks ? Math.round(poseCoverage * 100) : 0;
  const analysisQualityLabel =
    analysisQualityScore >= 85
      ? "Goed beeld"
      : analysisQualityScore >= 70
        ? "Bruikbaar beeld"
        : landmarks
          ? "Onvoldoende beeld"
          : "Nog niet gemeten";
  const activeCheckpointData =
    checkpoints.find((checkpoint) => checkpoint.id === activeCheckpoint) ?? checkpoints[0];
  const isUploadedVideoReady = Boolean(videoUrl && videoLoadState === "ready" && duration);
  const canUseVideo = Boolean(cameraStream || isUploadedVideoReady);
  const canScanRecordedVideo = Boolean(videoUrl && videoLoadState === "ready" && duration);
  const analysisReady = Boolean(
    landmarks &&
      baseline &&
      analyzedCheckpoint === activeCheckpoint &&
      activeCheckpoint !== "setup" &&
      poseCoverage >= 0.7
  );
  const phaseMetricIds = useMemo(() => {
    if (cameraView === "down-the-line") {
      if (activeCheckpoint === "takeaway") {
        return ["dtl-head", "dtl-posture", "dtl-hands", "dtl-connection"];
      }
      if (activeCheckpoint === "impact") {
        return ["dtl-head", "dtl-posture", "dtl-hip-depth", "dtl-connection"];
      }
      return ["dtl-head", "dtl-posture", "dtl-hip-depth", "dtl-hands", "dtl-connection"];
    }

    if (activeCheckpoint === "takeaway") {
      return ["head-box", "connection", "shoulder", "center"];
    }
    if (activeCheckpoint === "impact") {
      return ["head-box", "lead-arm", "connection", "center"];
    }
    return ["head-box", "lead-arm", "connection", "shoulder", "center"];
  }, [activeCheckpoint, cameraView]);
  const analyzedMetrics = analysisReady
    ? metrics.filter((metric) => metric.score > 0 && phaseMetricIds.includes(metric.id))
    : [];
  const swingScore = analyzedMetrics.length
    ? Math.round(
        analyzedMetrics.reduce((total, metric) => total + metric.score, 0) /
          analyzedMetrics.length
      )
    : 0;
  const weakestMetric = [...analyzedMetrics].sort((a, b) => a.score - b.score)[0];
  const selectedFocusMetric = weakestMetric;
  const displayedMetrics = analyzedMetrics;
  const bestDelta = bestSwing && swingScore && bestSwing.score ? swingScore - bestSwing.score : null;
  const flowStep = !canUseVideo ? 1 : !baseline ? 2 : !analysisReady ? 3 : 4;

  const scoreLabel =
    swingScore >= 82
      ? "Sterke fase"
      : swingScore >= 65
        ? "Redelijke basis"
        : swingScore > 0
          ? "Duidelijk werkpunt"
          : "Nog niet gemeten";

  const focusDrill = useMemo(() => {
    switch (selectedFocusMetric?.id) {
      case "head-box":
      case "dtl-head":
        return {
          title: "90% weight-forward reps",
          detail:
            cameraView === "face-on"
              ? "Maak 5 half swings met extra lead-side druk en stop bovenin zonder head-box breach."
              : "Maak 5 rustige half swings en houd je hoofdhoogte constant tot na impact."
        };
      case "lead-arm":
        return {
          title: "Short-radius punch",
          detail: "Sla 6 korte shots met lead arm lang en finish laag, zonder full backswing."
        };
      case "connection":
      case "dtl-connection":
        return {
          title: "Towel connection",
          detail: "Klem een towel onder beide oksels en maak 8 half swings met borst en armen samen."
        };
      case "shoulder":
        return {
          title: "Club-over-borst turn",
          detail: "Draai de lead shoulder omlaag tot het grip-end naar de bal wijst."
        };
      case "center":
      case "dtl-hip-depth":
        return {
          title: "Pause-at-top sequence",
          detail: "Pauzeer 1 seconde bovenin en start omlaag met heup/borst, niet met handen."
        };
      case "dtl-posture":
        return {
          title: "Posture hold reps",
          detail: "Maak 6 langzame swings tot impact terwijl je heupdiepte en borsthoek behoudt."
        };
      case "dtl-hands":
        return {
          title: "Hands-deep takeaway",
          detail: "Maak 8 takeaways waarbij handen dieper worden door borstturn, niet door losse armen."
        };
      default:
        return {
          title: "Setup calibratie",
          detail: "Zet de video op address, kalibreer, ga naar top/impact en analyseer opnieuw."
        };
    }
  }, [cameraView, selectedFocusMetric]);

  const setVideoSource = useCallback((
    url: string,
    name: string,
    blob: Blob | null = null,
    loadMessage = "Video geselecteerd. Metadata laden..."
  ) => {
    setCameraStream((stream) => {
      stream?.getTracks().forEach((track) => track.stop());
      return null;
    });
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recordStopRef.current) {
      window.clearTimeout(recordStopRef.current);
      recordStopRef.current = null;
    }
    setVideoUrl(url);
    setVideoName(name);
    setCurrentVideoBlob(blob);
    setVideoLoadState("selected");
    setVideoLoadMessage(loadMessage);
    setIsRecording(false);
    setIsAnalyzing(false);
    setIsTracking(false);
    setIsTrimming(false);
    setRecordingSeconds(0);
    setDuration(0);
    setCurrentTime(0);
    setVideoOrientation("landscape");
    setIsPlaying(false);
    setActiveCheckpoint("setup");
    setAnalyzedCheckpoint(null);
    setLandmarks(null);
    setAnalyzedCheckpoint(null);
    setActiveCheckpoint("setup");
    setBaseline(null);
    setMotionTrace([]);
    setSwingWindow(null);
    setSwingPhases([]);
    setTrackProgress(0);
    setTrimProgress(0);
    drawPose(canvasRef.current, null, null);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as SessionEntry[];
      setSessions(parsed.slice(0, 8));
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!window.indexedDB) return;

    let cancelled = false;
    void loadBestSwingRecord()
      .then((record) => {
        if (!record || cancelled) return;
        const url = URL.createObjectURL(record.blob);
        setBestSwing({
          name: record.name,
          url,
          savedAt: record.savedAt,
          score: record.score,
          focus: record.focus,
          window: record.window
        });
      })
      .catch(() => {
        setPoseStatus("Beste swing kon niet uit lokale opslag worden geladen.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (bestSwing?.url.startsWith("blob:")) URL.revokeObjectURL(bestSwing.url);
    };
  }, [bestSwing]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recordStopRef.current) window.clearTimeout(recordStopRef.current);
      poseRef.current?.close?.();
      poseRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = cameraStream;
    if (cameraStream) {
      video.muted = true;
      setVideoLoadState("loading");
      setVideoLoadMessage("Live camera starten...");
      void video.play();
    } else {
      video.muted = false;
    }
  }, [cameraStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || cameraStream || !videoUrl) return;
    video.load();
  }, [cameraStream, videoUrl]);

  const loadPose = useCallback(async () => {
    if (poseRef.current) return poseRef.current;
    setIsPoseLoading(true);
    setPoseStatus("Pose model laden...");
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm"
      );

      const createOptions = (delegate: "GPU" | "CPU") => ({
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
          delegate
        },
        runningMode: "VIDEO" as const,
        numPoses: 1,
        minPoseDetectionConfidence: 0.45,
        minPosePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45
      });

      try {
        poseRef.current = (await vision.PoseLandmarker.createFromOptions(
          filesetResolver,
          createOptions("GPU")
        )) as PoseLandmarkerLike;
      } catch {
        poseRef.current = (await vision.PoseLandmarker.createFromOptions(
          filesetResolver,
          createOptions("CPU")
        )) as PoseLandmarkerLike;
      }

      setPoseReady(true);
      setPoseStatus("Pose model klaar.");
      return poseRef.current;
    } catch (error) {
      setPoseStatus(
        error instanceof Error
          ? `Pose model kon niet laden: ${error.message}`
          : "Pose model kon niet laden."
      );
      return null;
    } finally {
      setIsPoseLoading(false);
    }
  }, []);

  const analyzeFrame = useCallback(
    async (showBusy = true) => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        setPoseStatus("Geen bruikbaar videoframe gevonden.");
        return null;
      }
      if (showBusy) setIsAnalyzing(true);
      const pose = await loadPose();
      if (!pose) {
        if (showBusy) setIsAnalyzing(false);
        return null;
      }

      try {
        const result = pose.detectForVideo(video, performance.now());
        const firstPose = result.landmarks?.[0] ?? null;
        setLandmarks(firstPose);
        setAnalyzedCheckpoint(firstPose ? activeCheckpoint : null);
        drawPose(canvasRef.current, firstPose, baseline, motionTrace);
        setPoseStatus(
          firstPose
            ? `${activeCheckpointData.label} geanalyseerd op ${formatPhaseTime(video.currentTime)}.`
            : "Geen lichaam gevonden. Zorg dat hoofd, handen, heupen en voeten volledig in beeld zijn."
        );
        return firstPose;
      } catch (error) {
        setPoseStatus(
          error instanceof Error ? `Analyse mislukt: ${error.message}` : "Analyse mislukt."
        );
        return null;
      } finally {
        if (showBusy) setIsAnalyzing(false);
      }
    },
    [activeCheckpoint, activeCheckpointData.label, baseline, loadPose, motionTrace]
  );

  const trackSwingMotion = useCallback(async () => {
    const video = videoRef.current;
    if (!video || cameraStream || !duration || video.readyState < 2) {
      setPoseStatus("Laad eerst een opgenomen of geuploade video om beweging te tracken.");
      return;
    }

    setIsTracking(true);
    setAnalyzedCheckpoint(null);
    setTrackProgress(0);
    const pose = await loadPose();
    if (!pose) {
      setIsTracking(false);
      return;
    }

    const originalTime = video.currentTime;
    video.pause();
    setIsPlaying(false);

    try {
      const sampleCount = Math.min(96, Math.max(18, Math.ceil(duration * 10)));
      const step = sampleCount > 1 ? duration / (sampleCount - 1) : duration;
      const nextTrace: MotionPoint[] = [];
      let lastPose: Landmark[] | null = null;

      for (let index = 0; index < sampleCount; index += 1) {
        const time = Math.min(duration, index * step);
        await waitForSeek(video, time);
        const result = pose.detectForVideo(video, performance.now());
        const firstPose = result.landmarks?.[0] ?? null;
        const point = firstPose ? extractMotionPoint(firstPose, time) : null;

        if (firstPose && point) {
          nextTrace.push(point);
          lastPose = firstPose;
        }

        if (index % 2 === 0 || index === sampleCount - 1) {
          setTrackProgress(Math.round(((index + 1) / sampleCount) * 100));
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
      }

      setMotionTrace(nextTrace);

      await waitForSeek(video, originalTime);
      setCurrentTime(originalTime);
      const restoredResult = pose.detectForVideo(video, performance.now());
      const restoredPose = restoredResult.landmarks?.[0] ?? lastPose;
      if (restoredPose) setLandmarks(restoredPose);
      drawPose(canvasRef.current, restoredPose, baseline, nextTrace);

      setPoseStatus(
        nextTrace.length
          ? `Beweging getrackt met ${nextTrace.length} samples. Oranje = hoofdpad, blauw = center.`
          : "Geen bruikbare pose gevonden tijdens de bewegingstracking."
      );
    } catch (error) {
      setPoseStatus(
        error instanceof Error ? `Tracking mislukt: ${error.message}` : "Tracking mislukt."
      );
    } finally {
      setIsTracking(false);
    }
  }, [baseline, cameraStream, duration, loadPose]);

  const autoTrimSwing = useCallback(async () => {
    const video = videoRef.current;
    if (!video || cameraStream || !duration || video.readyState < 2) {
      setPoseStatus("Laad eerst een opgenomen of geuploade video om automatisch te trimmen.");
      return;
    }

    setIsTrimming(true);
    setAnalyzedCheckpoint(null);
    setTrimProgress(0);
    const pose = await loadPose();
    if (!pose) {
      setIsTrimming(false);
      return;
    }

    const originalTime = video.currentTime;
    video.pause();
    setIsPlaying(false);

    try {
      const sampleCount = Math.min(120, Math.max(24, Math.ceil(duration * 12)));
      const step = sampleCount > 1 ? duration / (sampleCount - 1) : duration;
      const energySamples: Array<{ time: number; energy: number }> = [];
      const nextTrace: MotionPoint[] = [];
      let previousPose: Landmark[] | null = null;
      let lastPose: Landmark[] | null = null;

      for (let index = 0; index < sampleCount; index += 1) {
        const time = Math.min(duration, index * step);
        await waitForSeek(video, time);
        const result = pose.detectForVideo(video, performance.now());
        const firstPose = result.landmarks?.[0] ?? null;

        if (firstPose) {
          energySamples.push({
            time,
            energy: motionEnergy(previousPose, firstPose)
          });
          const point = extractMotionPoint(firstPose, time);
          if (point) nextTrace.push(point);
          previousPose = firstPose;
          lastPose = firstPose;
        } else {
          energySamples.push({ time, energy: 0 });
        }

        if (index % 2 === 0 || index === sampleCount - 1) {
          setTrimProgress(Math.round(((index + 1) / sampleCount) * 100));
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
      }

      const minimumPoseSamples = Math.max(8, Math.ceil(sampleCount * 0.35));
      const detectedWindow =
        nextTrace.length >= minimumPoseSamples ? detectSwingWindow(energySamples, duration) : null;
      setMotionTrace(nextTrace);

      if (!detectedWindow) {
        await waitForSeek(video, originalTime);
        setCurrentTime(originalTime);
        setPoseStatus(
          nextTrace.length < minimumPoseSamples
            ? "Fases niet gevonden: het lichaam was in te weinig frames volledig zichtbaar."
            : "Fases niet gevonden: er was te weinig duidelijke swingbeweging. Film een korte swing."
        );
        drawPose(canvasRef.current, lastPose, baseline, nextTrace);
        return;
      }

      setSwingWindow(detectedWindow);
      setSwingPhases(buildSwingPhases(detectedWindow, cameraView));
      setIsLoopingWindow(true);
      setSpeed(0.5);
      await waitForSeek(video, detectedWindow.start);
      setCurrentTime(detectedWindow.start);
      const restoredResult = pose.detectForVideo(video, performance.now());
      const restoredPose = restoredResult.landmarks?.[0] ?? lastPose;
      if (restoredPose) setLandmarks(restoredPose);
      drawPose(canvasRef.current, restoredPose, baseline, nextTrace);

      setPoseStatus(
        `Fases gevonden: ${formatPhaseTime(detectedWindow.start)}-${formatPhaseTime(
          detectedWindow.end
        )}. De herhaal-lus staat aan.`
      );
    } catch (error) {
      setPoseStatus(
        error instanceof Error ? `Auto-trim mislukt: ${error.message}` : "Auto-trim mislukt."
      );
    } finally {
      setIsTrimming(false);
    }
  }, [baseline, cameraStream, cameraView, duration, loadPose]);

  const saveBestSwing = useCallback(async () => {
    if (!currentVideoBlob || !videoUrl || !analysisReady || !swingScore) {
      setPoseStatus("Analyseer eerst een geldige swingfase voordat je deze als beste opslaat.");
      return;
    }

    const record: BestSwingRecord = {
      id: "best",
      blob: currentVideoBlob,
      name: videoName || "Beste swing",
      savedAt: new Date().toLocaleString("nl-NL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }),
      score: swingScore,
      focus: weakestMetric?.label ?? activeCheckpointData.label,
      window: swingWindow
    };

    const nextBest: BestSwing = {
      name: record.name,
      url: URL.createObjectURL(currentVideoBlob),
      savedAt: record.savedAt,
      score: record.score,
      focus: record.focus,
      window: record.window
    };

    setBestSwing(nextBest);
    setPoseStatus("Beste swing opgeslagen als lokale referentie.");

    if (window.indexedDB) {
      try {
        await saveBestSwingRecord(record);
      } catch {
        setPoseStatus("Beste swing staat klaar, maar kon niet persistent worden opgeslagen.");
      }
    }
  }, [
    activeCheckpointData.label,
    analysisReady,
    currentVideoBlob,
    swingScore,
    swingWindow,
    videoName,
    videoUrl,
    weakestMetric?.label
  ]);

  const clearBestSwing = useCallback(async () => {
    setBestSwing(null);
    setPoseStatus("Beste swing referentie gewist.");

    if (window.indexedDB) {
      try {
        await deleteBestSwingRecord();
      } catch {
        setPoseStatus("Beste swing is uit de UI gewist, maar lokale opslag kon niet worden opgeschoond.");
      }
    }
  }, []);

  useEffect(() => {
    if (!isPlaying || !poseReady) return;
    const interval = window.setInterval(() => {
      void analyzeFrame(false);
    }, 420);
    return () => window.clearInterval(interval);
  }, [analyzeFrame, isPlaying, poseReady]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const support = file.type ? document.createElement("video").canPlayType(file.type) : "";
    const compatibilityNote =
      file.type && !support
        ? " Browser meldt geen directe support voor dit formaat; als hij zwart blijft, exporteer als MP4/H.264 of WebM."
        : "";
    const fileType = describeSelectedFileType(file);
    const loadMessage = `${file.name} (${fileType}, ${formatFileSize(
      file.size
    )}) geselecteerd. Metadata laden...${compatibilityNote}`;

    setVideoSource(URL.createObjectURL(file), file.name, file, loadMessage);
    event.target.value = "";
    setPoseStatus("Video geselecteerd. De app leest nu metadata en het eerste frame.");
  };

  const handleVideoLoadStart = () => {
    if (!videoUrl && !cameraStream) return;
    setVideoLoadState("loading");
    setVideoLoadMessage(
      cameraStream ? "Live camera laden..." : "Video laden; metadata en eerste frame worden gelezen..."
    );
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextDuration = Number.isFinite(video.duration) ? video.duration : 0;
    setDuration(nextDuration);
    setCurrentTime(video.currentTime || 0);
    const aspectRatio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1.6;
    setVideoOrientation(
      aspectRatio < 0.88 ? "portrait" : aspectRatio > 1.12 ? "landscape" : "square"
    );
    video.playbackRate = speed;
    setVideoLoadState("metadata");
    setVideoLoadMessage(
      `Metadata gelezen: ${video.videoWidth || "?"}x${video.videoHeight || "?"}, ${formatTime(
        nextDuration
      )}. Eerste frame laden...`
    );
    setPoseStatus("Video metadata gelezen. Wacht tot het eerste frame zichtbaar is.");
  };

  const handleVideoReady = () => {
    const video = videoRef.current;
    if (!video) return;
    const becameReady = videoLoadState !== "ready";
    const nextDuration = Number.isFinite(video.duration) ? video.duration : duration;
    setDuration(nextDuration || 0);
    setCurrentTime(video.currentTime || 0);
    setVideoLoadState("ready");
    setVideoLoadMessage(
      `Video klaar: ${formatTime(nextDuration || 0)}. Zet de tijdlijn op address en kies Dit is mijn address.`
    );
    if (becameReady) {
      setPoseStatus("Video klaar. Zet de tijdlijn op address en leg dat frame vast.");
    }
  };

  const handleVideoWaiting = () => {
    if (!videoUrl && !cameraStream) return;
    if (videoLoadState === "ready") return;
    setVideoLoadState("loading");
    setVideoLoadMessage("Video wacht op data of codec-decoding...");
  };

  const handleVideoError = () => {
    const message = describeVideoError(videoRef.current);
    setVideoLoadState("error");
    setVideoLoadMessage(message);
    setPoseStatus(message);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    if (
      swingWindow &&
      isLoopingWindow &&
      !isTracking &&
      !isTrimming &&
      !video.paused &&
      video.currentTime >= swingWindow.end
    ) {
      video.currentTime = swingWindow.start;
      setCurrentTime(swingWindow.start);
      return;
    }

    setCurrentTime(video.currentTime);
  };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video || !canUseVideo) return;
    if (video.paused) {
      if (
        swingWindow &&
        (video.currentTime < swingWindow.start || video.currentTime >= swingWindow.end - 0.04)
      ) {
        video.currentTime = swingWindow.start;
      } else if (!swingWindow && duration && video.currentTime >= duration - 0.04) {
        video.currentTime = 0;
        setCurrentTime(0);
      }
      await video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(duration)) return;
    video.currentTime = clamp(time, 0, duration);
    setCurrentTime(video.currentTime);
    setAnalyzedCheckpoint(null);
  };

  const stepFrame = (direction: -1 | 1) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setIsPlaying(false);
    seekTo(video.currentTime + FRAME_STEP_SECONDS * direction);
  };

  const jumpToPhase = (phase: SwingPhase) => {
    const checkpointId =
      phase.id === "address" ? "setup" : phase.id === "finish" ? "impact" : phase.id;
    setActiveCheckpoint(checkpointId);
    setAnalyzedCheckpoint(null);
    seekTo(phase.time);
  };

  const chooseCheckpoint = (checkpointId: string) => {
    setActiveCheckpoint(checkpointId);
    setAnalyzedCheckpoint(null);
    const phase = swingPhases.find((item) => item.id === checkpointId);
    if (phase) {
      jumpToPhase(phase);
      setPoseStatus(`${phase.label} geselecteerd op ${formatPhaseTime(phase.time)}. Analyseer dit frame.`);
      return;
    }
    const checkpoint = checkpoints.find((item) => item.id === checkpointId);
    setPoseStatus(
      `Zet de video handmatig op ${checkpoint?.label ?? checkpointId} en kies Analyseer frame.`
    );
  };

  const openMobileCamera = () => {
    setPoseStatus("Gebruik bij voorkeur landscape, face-on, volledig lichaam en club in beeld.");
    captureRef.current?.click();
  };

  const startRecording = async (limitSeconds?: number) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPoseStatus("Live opname wordt niet ondersteund; mobiele camera-upload wordt geopend.");
      captureRef.current?.click();
      return;
    }
    if (!window.isSecureContext) {
      setPoseStatus("Live opname vraagt HTTPS. Mobiele camera-upload werkt wel en wordt geopend.");
      captureRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60 }
        },
        audio: false
      });
      const mimeType = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4"
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (recordStopRef.current) window.clearTimeout(recordStopRef.current);
        const blob = new Blob(chunksRef.current, {
          type: mimeType?.includes("mp4") ? "video/mp4" : "video/webm"
        });
        const url = URL.createObjectURL(blob);
        setVideoSource(url, `swing-${new Date().toISOString().slice(0, 19)}.webm`, blob);
        stream.getTracks().forEach((track) => track.stop());
        setCameraStream(null);
        setIsRecording(false);
        setRecordingSeconds(0);
        if (timerRef.current) window.clearInterval(timerRef.current);
      };
      recorderRef.current = recorder;
      setCameraStream(stream);
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((value) => value + 1);
      }, 1000);
      recorder.start();
      if (limitSeconds) {
        recordStopRef.current = window.setTimeout(() => {
          if (recorder.state === "recording") recorder.stop();
        }, limitSeconds * 1000);
      }
      setPoseStatus(limitSeconds ? `Opname loopt ${limitSeconds} seconden.` : "Opname loopt.");
    } catch (error) {
      setPoseStatus(
        error instanceof Error ? `Camera niet beschikbaar: ${error.message}` : "Camera niet beschikbaar."
      );
    }
  };

  const stopRecording = () => {
    if (recordStopRef.current) window.clearTimeout(recordStopRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setPoseStatus("Opname verwerken...");
    }
  };

  const calibrateSetup = async () => {
    const detectedPose = landmarks ?? (await analyzeFrame());
    if (!detectedPose || poseCoverageScore(detectedPose) < 0.7) {
      setPoseStatus(
        "Address niet betrouwbaar herkend. Zorg dat hoofd, handen, heupen en voeten zichtbaar zijn."
      );
      return;
    }
    setLandmarks(detectedPose);
    setAnalyzedCheckpoint(null);
    setBaseline(detectedPose);
    setActiveCheckpoint("takeaway");
    drawPose(canvasRef.current, detectedPose, detectedPose, motionTrace);
    setPoseStatus(
      "Address staat vast. Kies Takeaway, Top of Impact, zet de video op dat moment en analyseer."
    );
  };

  const resetAnalysis = () => {
    setLandmarks(null);
    setAnalyzedCheckpoint(null);
    setActiveCheckpoint("setup");
    setBaseline(null);
    setMotionTrace([]);
    setSwingWindow(null);
    setSwingPhases([]);
    setTrackProgress(0);
    setTrimProgress(0);
    setPoseStatus("Analyse gereset.");
    drawPose(canvasRef.current, null, null);
  };

  const saveSession = () => {
    if (!swingScore) return;
    const entry: SessionEntry = {
      id: crypto.randomUUID(),
      date: new Date().toLocaleString("nl-NL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }),
      club,
      score: swingScore,
      focus: selectedFocusMetric?.label ?? activeCheckpointData.label,
      shot: shotResult,
      cameraView,
      confidence: analysisQualityScore,
      cue: notes.trim() || undefined
    };
    const next = [entry, ...sessions].slice(0, 8);
    setSessions(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setNotes("");
    setShotResult("unknown");
    setPoseStatus("Trainingsmoment lokaal opgeslagen.");
  };

  const clearSessions = () => {
    setSessions([]);
    window.localStorage.removeItem(STORAGE_KEY);
  };

  const scoreStyle = { "--score": `${swingScore}%` } as CSSProperties;

return (
    <main className="app-shell coach-app">
      <input
        ref={fileRef}
        className="file-input"
        type="file"
        accept={VIDEO_FILE_ACCEPT}
        onChange={handleFileChange}
      />
      <input
        ref={captureRef}
        className="file-input"
        type="file"
        accept={VIDEO_FILE_ACCEPT}
        capture="environment"
        onChange={handleFileChange}
      />

      <header className="topbar coach-topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Target size={19} />
          </div>
          <div className="brand-copy">
            <h1 className="brand-title">Mijn Swingcoach</h1>
            <p className="brand-subtitle">Begrijp wat je lichaam doet en train een verbetering tegelijk</p>
          </div>
        </div>
        <div className="top-actions">
          <button className="btn btn-primary" type="button" onClick={openMobileCamera}>
            <Smartphone size={16} />
            Film swing
          </button>
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>
            <Upload size={16} />
            Kies video
          </button>
          {isRecording ? (
            <button className="btn btn-danger" type="button" onClick={stopRecording}>
              <Square size={16} />
              Stop {formatTime(recordingSeconds)}
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => void startRecording(7)}>
              <Timer size={16} />
              Live 7 sec
            </button>
          )}
        </div>
      </header>

      <div className="flow-shell">
        <nav className="flow-progress" aria-label="Analysevoortgang">
          {[
            { number: 1, label: "Video" },
            { number: 2, label: "Address" },
            { number: 3, label: "Swingfase" },
            { number: 4, label: "Oefenen" }
          ].map((item) => (
            <div
              className={`flow-progress-item ${flowStep === item.number ? "is-active" : ""} ${
                flowStep > item.number ? "is-done" : ""
              }`}
              key={item.number}
              aria-current={flowStep === item.number ? "step" : undefined}
            >
              <span>{flowStep > item.number ? <CheckCircle2 size={16} /> : item.number}</span>
              <strong>{item.label}</strong>
            </div>
          ))}
        </nav>

        <div className="coach-grid">
          <section className="panel video-panel">
            <div className="panel-header">
              <div className="panel-title">
                <Video size={18} />
                <div>
                  <h2>Jouw swing</h2>
                  <p>{videoName || "Begin met een korte video van een swing"}</p>
                </div>
              </div>
              {poseReady ? <span className="pill pill-good">Lichaamsdetectie klaar</span> : null}
            </div>

            <div className="panel-body guided-video-body">
              <div className={`video-frame video-frame-${videoOrientation}`}>
                <video
                  ref={videoRef}
                  src={!cameraStream && videoUrl ? videoUrl : undefined}
                  preload="auto"
                  playsInline
                  onLoadStart={handleVideoLoadStart}
                  onLoadedMetadata={handleLoadedMetadata}
                  onLoadedData={handleVideoReady}
                  onCanPlay={handleVideoReady}
                  onWaiting={handleVideoWaiting}
                  onStalled={handleVideoWaiting}
                  onError={handleVideoError}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  style={{ display: videoUrl || cameraStream ? "block" : "none" }}
                />
                <canvas ref={canvasRef} className="overlay-canvas" />
                {(videoUrl || cameraStream) && videoLoadState !== "ready" ? (
                  <div className={`video-load-overlay video-load-${videoLoadState}`}>
                    <div>
                      <strong>{videoLoadState === "error" ? "Video kan niet afspelen" : "Video laden"}</strong>
                      <span>{videoLoadMessage}</span>
                    </div>
                  </div>
                ) : null}
                {!videoUrl && !cameraStream ? (
                  <div className="empty-video coach-empty-video">
                    <div>
                      <Camera size={28} />
                      <strong>Film een swing of kies een bestaande video</strong>
                      <span>Je video blijft op dit apparaat en wordt niet geupload.</span>
                      <div className="empty-video-actions">
                        <button className="btn btn-primary" type="button" onClick={openMobileCamera}>
                          <Smartphone size={16} />
                          Film swing
                        </button>
                        <button className="btn" type="button" onClick={() => fileRef.current?.click()}>
                          <Upload size={16} />
                          Kies video
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {videoUrl || cameraStream ? (
                <div className={`coach-status video-load-${videoLoadState}`} role="status">
                  <span className="video-status-dot" aria-hidden="true" />
                  <div>
                    <strong>{videoLoadState === "ready" ? "Video klaar" : videoLoadState === "error" ? "Videofout" : "Even wachten"}</strong>
                    <span>{videoLoadMessage}</span>
                  </div>
                </div>
              ) : (
                <div className="capture-guide">
                  <div><CheckCircle2 size={16} /><span>Volledig lichaam, handen en voeten in beeld</span></div>
                  <div><CheckCircle2 size={16} /><span>Telefoon stil op heup- tot handhoogte</span></div>
                  <div><CheckCircle2 size={16} /><span>Film face-on of recht down-the-line</span></div>
                </div>
              )}

              {canUseVideo ? (
                <>
                  <div className="controls-strip coach-controls">
                    <div className="toolbar">
                      <button className="btn icon-btn" type="button" onClick={togglePlay} title="Play/pause">
                        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <button className="btn icon-btn" type="button" onClick={() => stepFrame(-1)} title="Frame terug">
                        <ChevronLeft size={16} />
                      </button>
                      <button className="btn icon-btn" type="button" onClick={() => stepFrame(1)} title="Frame vooruit">
                        <ChevronRight size={16} />
                      </button>
                    </div>
                    <input
                      className="scrubber"
                      type="range"
                      min="0"
                      max={duration || 0}
                      step="0.01"
                      value={currentTime}
                      onChange={(event) => seekTo(Number(event.target.value))}
                      aria-label="Video scrubber"
                    />
                    <div className="speed-control">
                      <span>{formatPhaseTime(currentTime)} / {formatTime(duration)}</span>
                      <select
                        className="select"
                        value={speed}
                        onChange={(event) => setSpeed(Number(event.target.value))}
                        aria-label="Afspeelsnelheid"
                      >
                        <option value={0.25}>0.25x</option>
                        <option value={0.5}>0.5x</option>
                        <option value={1}>1x</option>
                      </select>
                    </div>
                  </div>

                  <div className="preflight-grid">
                    <div className="field">
                      <label htmlFor="camera-view">Camerastandpunt</label>
                      <select
                        id="camera-view"
                        className="select"
                        value={cameraView}
                        onChange={(event) => {
                          setCameraView(event.target.value as CameraView);
                          resetAnalysis();
                        }}
                      >
                        <option value="face-on">Face-on</option>
                        <option value="down-the-line">Down the line</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="handedness">Je speelt</label>
                      <select
                        id="handedness"
                        className="select"
                        value={handedness}
                        onChange={(event) => setHandedness(event.target.value as Handedness)}
                      >
                        <option value="right">Rechtshandig</option>
                        <option value="left">Linkshandig</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="target-side">Target in beeld</label>
                      <select
                        id="target-side"
                        className="select"
                        value={targetSide}
                        onChange={(event) => setTargetSide(event.target.value as TargetSide)}
                      >
                        <option value="left">Links</option>
                        <option value="right">Rechts</option>
                      </select>
                    </div>
                  </div>

                  <section className="next-action-card" aria-labelledby="next-action-title">
                    {flowStep === 2 ? (
                      <>
                        <span className="step-kicker">Stap 2 van 4</span>
                        <h3 id="next-action-title">Zet de video op je address</h3>
                        <p>Gebruik de tijdlijn of frameknoppen. Kies het moment vlak voordat je club begint te bewegen.</p>
                        <button className="btn btn-primary btn-large" type="button" onClick={() => void calibrateSetup()}>
                          <Target size={17} />
                          Dit is mijn address
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="step-kicker">Stap {analysisReady ? 4 : 3} van 4</span>
                        <h3 id="next-action-title">
                          {analysisReady ? `${activeCheckpointData.label} is geanalyseerd` : "Kies het swingmoment dat je wilt begrijpen"}
                        </h3>
                        <div className="checkpoint-picker" aria-label="Swingfase">
                          {checkpoints.filter((checkpoint) => checkpoint.id !== "setup").map((checkpoint) => (
                            <button
                              className="checkpoint-choice"
                              type="button"
                              key={checkpoint.id}
                              aria-pressed={activeCheckpoint === checkpoint.id}
                              onClick={() => chooseCheckpoint(checkpoint.id)}
                            >
                              <strong>{checkpoint.label}</strong>
                              <span>{checkpoint.cue}</span>
                            </button>
                          ))}
                        </div>
                        <div className="primary-action-row">
                          <button
                            className="btn btn-primary btn-large"
                            type="button"
                            onClick={() => void analyzeFrame()}
                            disabled={isAnalyzing || isPoseLoading || isTracking || isTrimming}
                          >
                            <ScanLine size={17} />
                            {isAnalyzing || isPoseLoading ? "Lichaam herkennen..." : `Analyseer ${activeCheckpointData.label}`}
                          </button>
                          {canScanRecordedVideo ? (
                            <button
                              className="btn"
                              type="button"
                              onClick={() => void autoTrimSwing()}
                              disabled={isTrimming || isTracking || isPoseLoading}
                            >
                              <Scissors size={16} />
                              {isTrimming ? `Fases zoeken ${trimProgress}%` : "Fases automatisch zoeken"}
                            </button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </section>

                  <div className={`analysis-message ${poseStatus.includes("niet") || poseStatus.includes("mislukt") || poseStatus.includes("Geen") ? "is-warning" : ""}`} role="status">
                    <CircleAlert size={17} />
                    <span>{poseStatus}</span>
                  </div>

                  <details className="advanced-tools">
                    <summary>Extra videohulpmiddelen</summary>
                    <div className="advanced-tools-body">
                      <div className="toolbar">
                        {canScanRecordedVideo ? (
                          <button className="btn" type="button" onClick={() => void trackSwingMotion()} disabled={isTracking || isTrimming || isPoseLoading}>
                            <Activity size={16} />
                            {isTracking ? `Beweging meten ${trackProgress}%` : "Meet hele beweging"}
                          </button>
                        ) : null}
                        <button className="btn" type="button" onClick={() => setIsLoopingWindow((value) => !value)} disabled={!swingWindow}>
                          <Repeat2 size={16} />
                          {isLoopingWindow ? "Herhalen aan" : "Herhalen uit"}
                        </button>
                        <button className="btn" type="button" onClick={resetAnalysis}>
                          <RotateCcw size={16} />
                          Nieuwe analyse
                        </button>
                      </div>
                      {swingPhases.length ? (
                        <div className="phase-jump-strip">
                          {swingPhases.map((phase) => (
                            <button className="phase-jump-btn" type="button" key={phase.id} onClick={() => jumpToPhase(phase)}>
                              <strong>{phase.label}</strong>
                              <span>{formatPhaseTime(phase.time)}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="helper-copy">Automatische fases zijn optioneel. Handmatig naar een frame gaan is vaak nauwkeuriger.</p>
                      )}
                    </div>
                  </details>
                </>
              ) : null}
            </div>
          </section>

          <aside className="side-stack coach-feedback">
            <section className="panel feedback-panel">
              <div className="panel-header">
                <div className="panel-title">
                  <BarChart3 size={18} />
                  <div>
                    <h2>Jouw feedback</h2>
                    <p>Een swingmoment, een werkpunt, een oefening</p>
                  </div>
                </div>
                {analysisReady ? <span className="pill pill-good">2D-indicatie</span> : null}
              </div>
              <div className="panel-body">
                {!canUseVideo ? (
                  <div className="coach-welcome">
                    <span className="welcome-icon"><Dumbbell size={24} /></span>
                    <h3>Geen technisch dashboard, maar een persoonlijke oefenlus</h3>
                    <p>Na je video zie je per swingfase wat je lichaam doet en welk punt nu het meeste oplevert.</p>
                    <div className="welcome-points">
                      <div><strong>1</strong><span>Address vastzetten</span></div>
                      <div><strong>2</strong><span>Takeaway, top of impact kiezen</span></div>
                      <div><strong>3</strong><span>Een gerichte drill uitvoeren</span></div>
                    </div>
                  </div>
                ) : !baseline ? (
                  <div className="pending-feedback">
                    <Target size={30} />
                    <h3>Eerst een betrouwbaar nulpunt</h3>
                    <p>Je address wordt de vergelijking voor hoofd, schouders, armen en lichaamscentrum.</p>
                  </div>
                ) : !analysisReady ? (
                  <div className="pending-feedback">
                    <ScanLine size={30} />
                    <h3>Analyseer nu {activeCheckpointData.label.toLowerCase()}</h3>
                    <p>{activeCheckpointData.target}. Zet de video goed en kies daarna Analyseer {activeCheckpointData.label}.</p>
                    {landmarks && analysisQualityScore < 70 ? (
                      <div className="quality-warning">Te weinig lichaamsdelen betrouwbaar zichtbaar. Pas het frame of de opname aan.</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="result-stack">
                    <div className="score-band result-score-band">
                      <div className="score-ring" style={scoreStyle}>
                        <div>
                          <strong>{swingScore}</strong>
                          <span>fase-indicatie</span>
                        </div>
                      </div>
                      <div className="score-copy">
                        <span className="step-kicker">{activeCheckpointData.label}</span>
                        <h3>{scoreLabel}</h3>
                        <p>Deze score is alleen bedoeld om jouw eigen herhaalde opnames onder vergelijkbare omstandigheden te vergelijken.</p>
                        {bestDelta !== null ? <p className="delta-line">{bestDelta >= 0 ? "+" : ""}{bestDelta} versus je opgeslagen beste swing</p> : null}
                      </div>
                    </div>

                    <div className="quality-strip">
                      <div>
                        <strong>{analysisQualityLabel}</strong>
                        <span>{analysisQualityScore}% van de benodigde lichaamsdelen zichtbaar</span>
                      </div>
                      <div className="confidence-meter" aria-label={`Beeldkwaliteit ${analysisQualityScore}`}>
                        <span style={{ "--value": `${analysisQualityScore}%` } as CSSProperties} />
                      </div>
                    </div>

                    {selectedFocusMetric ? (
                      <div className={`focus-coach-card metric-${selectedFocusMetric.status}`}>
                        <div className="focus-coach-head">
                          <span><Target size={18} /></span>
                          <div>
                            <small>Jouw belangrijkste werkpunt</small>
                            <h3>{selectedFocusMetric.label}</h3>
                          </div>
                          <strong>{selectedFocusMetric.value}</strong>
                        </div>
                        <p>{selectedFocusMetric.detail}</p>
                        <div className="drill-callout">
                          <Dumbbell size={18} />
                          <div>
                            <strong>{focusDrill.title}</strong>
                            <span>{focusDrill.detail}</span>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <details className="metric-details">
                      <summary>Bekijk alle metingen voor {activeCheckpointData.label.toLowerCase()}</summary>
                      <div className="metric-list">
                        {displayedMetrics.map((metric) => {
                          const MetricIcon = iconMap[metric.icon];
                          return (
                            <div className="metric-row" key={metric.id}>
                              <span className="metric-icon"><MetricIcon size={17} /></span>
                              <div className="metric-main">
                                <strong>{metric.label} - {metric.value}</strong>
                                <span>{metric.detail}</span>
                              </div>
                              <div className="meter" aria-label={`${metric.label} indicatie ${metric.score}`}>
                                <span style={{ "--value": `${metric.score}%` } as CSSProperties} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>

                    <div className="session-capture">
                      <div className="session-capture-head">
                        <div>
                          <h3>Bewaar dit trainingsmoment</h3>
                          <p>Voeg balvlucht en je gevoel toe om later patronen te herkennen.</p>
                        </div>
                        <button className="btn" type="button" onClick={() => void saveBestSwing()}>
                          <Star size={16} />
                          Maak beste swing
                        </button>
                      </div>
                      <div className="session-fields">
                        <div className="field">
                          <label htmlFor="club">Club</label>
                          <input id="club" className="input" value={club} onChange={(event) => setClub(event.target.value)} />
                        </div>
                        <div className="field">
                          <label htmlFor="notes">Swinggevoel</label>
                          <input id="notes" className="input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Bijv. borst blijft draaien" />
                        </div>
                      </div>
                      <div className="shot-result-grid compact-shot-grid">
                        {shotResults.map((result) => (
                          <button className="shot-btn" type="button" key={result.id} aria-pressed={shotResult === result.id} onClick={() => setShotResult(result.id)}>
                            {result.label}
                          </button>
                        ))}
                      </div>
                      <button className="btn btn-primary btn-large" type="button" onClick={saveSession}>
                        <Save size={16} />
                        Sla trainingsmoment op
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {canScanRecordedVideo ? (
              <details className="panel disclosure-panel" open={motionTrace.length > 0}>
                <summary className="panel-header disclosure-summary">
                  <div className="panel-title">
                    <Activity size={18} />
                    <div><h3>Beweging door de hele swing</h3><p>Optioneel: hoofd- en lichaamscentrum volgen</p></div>
                  </div>
                  <ChevronRight size={18} />
                </summary>
                <div className="panel-body">
                  {!motionTrace.length ? (
                    <div className="optional-action">
                      <p>Gebruik dit als je wilt zien hoeveel je hoofd en lichaamscentrum door de volledige swing bewegen.</p>
                      <button className="btn" type="button" onClick={() => void trackSwingMotion()} disabled={isTracking || isTrimming || isPoseLoading}>
                        <Activity size={16} />
                        {isTracking ? `Meten ${trackProgress}%` : "Meet volledige swing"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="motion-chart">
                        <svg viewBox="0 0 100 52" role="img" aria-label="Bewegingspad">
                          <line className="motion-axis" x1="50" y1="3" x2="50" y2="49" />
                          <line className="motion-axis" x1="3" y1="26" x2="97" y2="26" />
                          {headPath ? <path className="motion-head" d={headPath} /> : null}
                          {centerPath ? <path className="motion-center" d={centerPath} /> : null}
                          <circle className="motion-origin" cx="50" cy="26" r="2.2" />
                        </svg>
                      </div>
                      <div className="motion-grid">
                        <div className="motion-card"><strong>{motionSummary ? `${motionSummary.headSwayPct.toFixed(0)}%` : "--"}</strong><span>max hoofd zijwaarts</span></div>
                        <div className="motion-card"><strong>{motionSummary ? `${motionSummary.headVerticalPct.toFixed(0)}%` : "--"}</strong><span>hoofd op/neer</span></div>
                        <div className="motion-card"><strong>{motionSummary ? `${motionSummary.centerAwayPct.toFixed(0)}%` : "--"}</strong><span>centrum weg van target</span></div>
                        <div className="motion-card"><strong>{motionSummary ? `${motionSummary.centerTargetPct.toFixed(0)}%` : "--"}</strong><span>centrum naar target</span></div>
                      </div>
                    </>
                  )}
                </div>
              </details>
            ) : null}

            <details className="panel disclosure-panel" open={Boolean(bestSwing || sessions.length)}>
              <summary className="panel-header disclosure-summary">
                <div className="panel-title">
                  <Star size={18} />
                  <div><h3>Vergelijken en voortgang</h3><p>Alleen jouw eigen swings, lokaal bewaard</p></div>
                </div>
                <ChevronRight size={18} />
              </summary>
              <div className="panel-body history-stack">
                {bestSwing ? (
                  <div className="best-swing-card">
                    <video src={bestSwing.url} controls playsInline />
                    <div className="best-meta">
                      <strong>{bestSwing.name}</strong>
                      <span>{bestSwing.savedAt} - indicatie {bestSwing.score || "--"} - focus {bestSwing.focus}</span>
                      <button className="btn" type="button" onClick={() => void clearBestSwing()}><RefreshCcw size={16} />Wis beste swing</button>
                    </div>
                  </div>
                ) : <p className="helper-copy">Nog geen beste swing opgeslagen.</p>}

                {sessions.length ? (
                  <div className="reference-list">
                    {sessions.map((session) => (
                      <div className="reference-item" key={session.id}>
                        <span className="reference-number">{session.score}</span>
                        <div>
                          <strong>{session.club} - {session.date}</strong>
                          <span>{session.focus} - {shotResults.find((result) => result.id === session.shot)?.label ?? "Geen"}{session.cue ? ` - ${session.cue}` : ""}</span>
                        </div>
                      </div>
                    ))}
                    <button className="btn" type="button" onClick={clearSessions}>Wis trainingslog</button>
                  </div>
                ) : <p className="helper-copy">Na een geldige analyse kun je hier trainingsmomenten bewaren.</p>}
              </div>
            </details>

            <details className="panel disclosure-panel">
              <summary className="panel-header disclosure-summary">
                <div className="panel-title">
                  <ListChecks size={18} />
                  <div><h3>Coachprincipes en referentie</h3><p>Uitleg achter de metingen</p></div>
                </div>
                <ChevronRight size={18} />
              </summary>
              <div className="panel-body">
                <div className="reference-list">
                  {referencePrinciples.map((principle, index) => (
                    <div className="reference-item" key={principle.title}>
                      <span className="reference-number">{index + 1}</span>
                      <div><strong>{principle.title}</strong><span>{principle.text}</span></div>
                    </div>
                  ))}
                </div>
                <a className="btn reference-link" href={`https://www.youtube.com/watch?v=${SAGUTO_VIDEO_ID}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} />Bekijk de gebruikte coachreferentie op YouTube
                </a>
                <p className="disclaimer">Deze app geeft een experimentele 2D-indicatie voor eigen training. Camerahoek, kleding en licht kunnen de meting beinvloeden.</p>
              </div>
            </details>
          </aside>
        </div>
      </div>
    </main>
  );
}