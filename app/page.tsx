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
  FileVideo,
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

type SetupItem = {
  label: string;
  text: string;
  done: boolean;
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
    const leadWrist = handedness === "right" ? leftWrist : rightWrist;
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
  const [focusMetricId, setFocusMetricId] = useState("auto");
  const [activeCheckpoint, setActiveCheckpoint] = useState(checkpoints[0].id);
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
  const [referenceMode, setReferenceMode] = useState<"saguto" | "best">("saguto");
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
  const confidenceScore = Math.round(
    clamp(
      (videoUrl || cameraStream ? 16 : 0) +
        (landmarks ? 20 : 0) +
        poseCoverage * 14 +
        (baseline ? 18 : 0) +
        (motionTrace.length >= 12 ? 16 : motionTrace.length ? 8 : 0) +
        (swingWindow ? 10 : 0) +
        (videoOrientation === "portrait" || videoOrientation === "landscape" ? 6 : 3)
    )
  );
  const confidenceLabel =
    confidenceScore >= 78 ? "Hoog" : confidenceScore >= 50 ? "Middel" : "Laag";
  const setupItems: SetupItem[] = useMemo(
    () => [
      {
        label: "Hoek",
        text:
          cameraView === "face-on"
            ? "Face-on: target links/rechts instellen en volledige body zien."
            : "Down-the-line: camera langs handlijn of teenlijn, bal en houding zichtbaar.",
        done: true
      },
      {
        label: "Framing",
        text:
          videoOrientation === "portrait"
            ? "Portrait gedetecteerd; zorg dat club, handen en finish in beeld blijven."
            : "Landscape/square gedetecteerd; voldoende ruimte rond club en finish houden.",
        done: Boolean(videoUrl || cameraStream)
      },
      {
        label: "Address",
        text: baseline ? "Setup gekalibreerd." : "Zet op address, analyseer frame en tik target-icoon.",
        done: Boolean(baseline)
      },
      {
        label: "Replay",
        text: swingWindow ? "Auto-trim en loop klaar." : "Gebruik Auto trim voor fases en instant replay.",
        done: Boolean(swingWindow)
      }
    ],
    [baseline, cameraStream, cameraView, swingWindow, videoOrientation, videoUrl]
  );
  const analyzedMetrics = metrics.filter((metric) => metric.score > 0);
  const swingScore = analyzedMetrics.length
    ? Math.round(
        analyzedMetrics.reduce((total, metric) => total + metric.score, 0) /
          analyzedMetrics.length
      )
    : 0;
  const weakestMetric = analyzedMetrics
    .filter((metric) => metric.score > 0)
    .sort((a, b) => a.score - b.score)[0];
  const selectedFocusMetric =
    focusMetricId === "auto"
      ? weakestMetric
      : metrics.find((metric) => metric.id === focusMetricId) ?? weakestMetric;
  const displayedMetrics =
    focusMetricId === "auto" ? metrics : metrics.filter((metric) => metric.id === focusMetricId);
  const bestDelta =
    bestSwing && swingScore ? swingScore - bestSwing.score : null;
  const activeCheckpointData =
    checkpoints.find((checkpoint) => checkpoint.id === activeCheckpoint) ?? checkpoints[0];
  const isUploadedVideoReady = Boolean(videoUrl && videoLoadState === "ready" && duration);
  const canUseVideo = Boolean(cameraStream || isUploadedVideoReady);
  const canScanRecordedVideo = Boolean(videoUrl && videoLoadState === "ready" && duration);

  const scoreLabel =
    swingScore >= 78
      ? "Connected"
      : swingScore >= 56
        ? "Werkbaar"
        : swingScore > 0
          ? "Armsy risico"
          : "Nog geen score";

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
    setLandmarks(null);
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
        return;
      }
      if (showBusy) setIsAnalyzing(true);
      const pose = await loadPose();
      if (!pose) {
        if (showBusy) setIsAnalyzing(false);
        return;
      }

      try {
        const result = pose.detectForVideo(video, performance.now());
        const firstPose = result.landmarks?.[0] ?? null;
        setLandmarks(firstPose);
        drawPose(canvasRef.current, firstPose, baseline, motionTrace);
        setPoseStatus(
          firstPose
            ? `Frame geanalyseerd op ${formatTime(video.currentTime)}.`
            : "Geen lichaam gevonden; gebruik face-on video met volledig lichaam in beeld."
        );
      } catch (error) {
        setPoseStatus(
          error instanceof Error ? `Analyse mislukt: ${error.message}` : "Analyse mislukt."
        );
      } finally {
        if (showBusy) setIsAnalyzing(false);
      }
    },
    [baseline, loadPose, motionTrace]
  );

  const trackSwingMotion = useCallback(async () => {
    const video = videoRef.current;
    if (!video || cameraStream || !duration || video.readyState < 2) {
      setPoseStatus("Laad eerst een opgenomen of geuploade video om beweging te tracken.");
      return;
    }

    setIsTracking(true);
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

      const detectedWindow = detectSwingWindow(energySamples, duration);
      setMotionTrace(nextTrace);

      if (!detectedWindow) {
        await waitForSeek(video, originalTime);
        setCurrentTime(originalTime);
        setPoseStatus("Auto-trim vond geen duidelijke swingbeweging. Probeer korter te filmen.");
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
        `Auto-trim klaar: ${formatTime(detectedWindow.start)}-${formatTime(
          detectedWindow.end
        )}. Loop staat aan voor instant replay.`
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
    if (!currentVideoBlob || !videoUrl) {
      setPoseStatus("Geen lokale video beschikbaar om als beste swing op te slaan.");
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
    setReferenceMode("best");
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
    currentVideoBlob,
    swingScore,
    swingWindow,
    videoName,
    videoUrl,
    weakestMetric?.label
  ]);

  const clearBestSwing = useCallback(async () => {
    setBestSwing(null);
    setReferenceMode("saguto");
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
      `Video klaar: ${formatTime(nextDuration || 0)}. Zet hem op address, klik Analyseer en kalibreer setup.`
    );
    if (becameReady) {
      setPoseStatus("Video klaar. Zet naar address, klik Analyseer en kalibreer setup.");
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
    window.setTimeout(() => void analyzeFrame(false), 80);
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
    seekTo(phase.time);
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

  const calibrateSetup = () => {
    if (!landmarks) {
      void analyzeFrame().then(() => {
        setBaseline((previous) => previous);
      });
      setPoseStatus("Analyseer eerst het address-frame en kalibreer daarna.");
      return;
    }
    setBaseline(landmarks);
    drawPose(canvasRef.current, landmarks, landmarks, motionTrace);
    setPoseStatus("Setup gekalibreerd. Ga nu naar top of impact en analyseer opnieuw.");
  };

  const resetAnalysis = () => {
    setLandmarks(null);
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
      confidence: confidenceScore,
      cue: notes.trim() || undefined
    };
    const next = [entry, ...sessions].slice(0, 8);
    setSessions(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const clearSessions = () => {
    setSessions([]);
    window.localStorage.removeItem(STORAGE_KEY);
  };

  const scoreStyle = { "--score": `${swingScore}%` } as CSSProperties;

  return (
    <main className="app-shell">
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
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Target size={19} />
          </div>
          <div className="brand-copy">
            <h1 className="brand-title">Saguto Swing Analyzer</h1>
            <p className="brand-subtitle">Stack/Tilt practice loop voor minder armsy slaan</p>
          </div>
        </div>
        <div className="top-actions">
          <button className="btn btn-primary" type="button" onClick={openMobileCamera}>
            <Smartphone size={16} />
            Film mobiel
          </button>
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>
            <Upload size={16} />
            Upload
          </button>
          {isRecording ? (
            <button className="btn btn-danger" type="button" onClick={stopRecording}>
              <Square size={16} />
              Stop {formatTime(recordingSeconds)}
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => void startRecording(7)}>
              <Timer size={16} />
              7s live
            </button>
          )}
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void analyzeFrame()}
            disabled={isAnalyzing || isPoseLoading || isTracking || isTrimming || !canUseVideo}
          >
            <ScanLine size={16} />
            {isAnalyzing || isPoseLoading ? "Analyseren" : "Analyseer"}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void autoTrimSwing()}
            disabled={isTrimming || isTracking || isPoseLoading || !canScanRecordedVideo}
          >
            <Scissors size={16} />
            {isTrimming ? `${trimProgress}%` : "Auto trim"}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void trackSwingMotion()}
            disabled={isTracking || isTrimming || isPoseLoading || !canScanRecordedVideo}
          >
            <Activity size={16} />
            {isTracking ? `${trackProgress}%` : "Track beweging"}
          </button>
        </div>
      </header>

      <div className="main-grid">
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <Video size={18} />
              <div>
                <h2>Video lab</h2>
                <p>{videoName || "Geen lokale swing geladen"}</p>
              </div>
            </div>
            <span className={`pill ${poseReady ? "pill-good" : "pill-warn"}`}>
              {poseReady ? "Pose actief" : "Pose standby"}
            </span>
          </div>
          <div className="panel-body">
            <div className="workbench">
              <div className="video-stage">
                <div className="stage-head">
                  <p className="stage-label">Mijn swing</p>
                  <div className="stage-actions">
                    <button
                      className="btn icon-btn"
                      type="button"
                      onClick={() => void saveBestSwing()}
                      disabled={!currentVideoBlob || videoLoadState === "error"}
                      title="Markeer als beste swing"
                    >
                      <Star size={16} />
                    </button>
                    <button className="btn icon-btn" type="button" onClick={calibrateSetup} title="Kalibreer setup">
                      <Target size={16} />
                    </button>
                    <button className="btn icon-btn" type="button" onClick={resetAnalysis} title="Reset analyse">
                      <RotateCcw size={16} />
                    </button>
                  </div>
                </div>
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
                        <strong>
                          {videoLoadState === "error"
                            ? "Video kan niet afspelen"
                            : videoLoadState === "metadata"
                              ? "Eerste frame laden"
                              : "Video laden"}
                        </strong>
                        <span>{videoLoadMessage}</span>
                      </div>
                    </div>
                  ) : null}
                  {!videoUrl && !cameraStream ? (
                    <div className="empty-video">
                      <div>
                        <strong>Upload of record je swing</strong>
                        <span>Face-on, volledig lichaam in beeld, liefst 60 fps of meer.</span>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className={`video-load-status video-load-${videoLoadState}`}>
                  <span className="video-status-dot" aria-hidden="true" />
                  <div>
                    <strong>
                      {videoLoadState === "ready"
                        ? "Video klaar"
                        : videoLoadState === "error"
                          ? "Video fout"
                          : videoLoadState === "empty"
                            ? "Geen video"
                            : "Video laden"}
                    </strong>
                    <span>{videoLoadMessage}</span>
                  </div>
                </div>
                <div className="controls-strip">
                  <div className="toolbar">
                    <button
                      className="btn icon-btn"
                      type="button"
                      onClick={togglePlay}
                      disabled={!canUseVideo}
                      title="Play/pause"
                    >
                      {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      className="btn icon-btn"
                      type="button"
                      onClick={() => stepFrame(-1)}
                      disabled={!canUseVideo}
                      title="Frame terug"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      className="btn icon-btn"
                      type="button"
                      onClick={() => stepFrame(1)}
                      disabled={!canUseVideo}
                      title="Frame vooruit"
                    >
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
                    disabled={!duration || videoLoadState === "error"}
                  />
                  <div className="speed-control">
                    <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
                    <select
                      className="select"
                      value={speed}
                      onChange={(event) => setSpeed(Number(event.target.value))}
                      aria-label="Playback speed"
                    >
                      <option value={0.25}>0.25x</option>
                      <option value={0.5}>0.5x</option>
                      <option value={1}>1x</option>
                    </select>
                  </div>
                </div>
                <div className="trim-strip">
                  <div className="trim-copy">
                    <strong>{swingWindow ? "Swing window actief" : "Nog geen auto-trim"}</strong>
                    <span>
                      {swingWindow
                        ? `${formatTime(swingWindow.start)}-${formatTime(
                            swingWindow.end
                          )}, piek rond ${formatTime(swingWindow.peak)}`
                        : "Auto trim scant de video en zet direct een herhaalbare replay-loop klaar."}
                    </span>
                  </div>
                  <div className="stage-actions">
                    <button
                      className={`btn ${isLoopingWindow ? "btn-primary" : ""}`}
                      type="button"
                      onClick={() => setIsLoopingWindow((value) => !value)}
                      disabled={!swingWindow}
                    >
                      <Repeat2 size={16} />
                      Loop
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void autoTrimSwing()}
                      disabled={isTrimming || isTracking || isPoseLoading || !canScanRecordedVideo}
                    >
                      <Scissors size={16} />
                      {isTrimming ? `${trimProgress}%` : "Trim"}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void saveBestSwing()}
                      disabled={!currentVideoBlob || videoLoadState === "error"}
                    >
                      <Star size={16} />
                      Beste
                    </button>
                  </div>
                </div>
                {swingPhases.length ? (
                  <div className="phase-jump-strip">
                    {swingPhases.map((phase) => (
                      <button
                        className="phase-jump-btn"
                        type="button"
                        key={phase.id}
                        onClick={() => jumpToPhase(phase)}
                      >
                        <strong>{phase.label}</strong>
                        <span>{formatTime(phase.time)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="video-stage">
                <div className="stage-head">
                  <p className="stage-label">
                    {referenceMode === "best" && bestSwing ? "Mijn beste swing" : "Saguto referentie"}
                  </p>
                  <div className="stage-actions">
                    <div className="segmented" aria-label="Referentie keuze">
                      <button
                        className="segment-btn"
                        type="button"
                        aria-pressed={referenceMode === "saguto"}
                        onClick={() => setReferenceMode("saguto")}
                      >
                        Saguto
                      </button>
                      <button
                        className="segment-btn"
                        type="button"
                        aria-pressed={referenceMode === "best"}
                        onClick={() => setReferenceMode("best")}
                        disabled={!bestSwing}
                      >
                        Beste
                      </button>
                    </div>
                    {referenceMode === "best" && bestSwing ? (
                      <button className="btn icon-btn" type="button" onClick={() => void clearBestSwing()} title="Wis beste swing">
                        <RefreshCcw size={16} />
                      </button>
                    ) : (
                      <a
                        className="btn"
                        href={`https://www.youtube.com/watch?v=${SAGUTO_VIDEO_ID}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={16} />
                        YouTube
                      </a>
                    )}
                  </div>
                </div>
                <div className="video-frame">
                  {referenceMode === "best" && bestSwing ? (
                    <video
                      src={bestSwing.url}
                      controls
                      playsInline
                      onLoadedMetadata={(event) => {
                        if (bestSwing.window) event.currentTarget.currentTime = bestSwing.window.start;
                      }}
                    />
                  ) : referenceMode === "best" ? (
                    <div className="empty-video">
                      <div>
                        <strong>Nog geen beste swing</strong>
                        <span>Laad een goede bal, trim eventueel, en tik op de ster bij Mijn swing.</span>
                      </div>
                    </div>
                  ) : (
                    <iframe
                      title="Saguto reference swing"
                      src={`https://www.youtube.com/embed/${SAGUTO_VIDEO_ID}`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  )}
                </div>
                {referenceMode === "best" && bestSwing ? (
                  <div className="best-meta">
                    <strong>{bestSwing.name}</strong>
                    <span>
                      {bestSwing.savedAt} - score {bestSwing.score || "--"} - focus {bestSwing.focus}
                    </span>
                  </div>
                ) : null}
                <div className="timeline">
                  {checkpoints.map((checkpoint) => (
                    <button
                      className="phase-btn"
                      type="button"
                      key={checkpoint.id}
                      onClick={() => setActiveCheckpoint(checkpoint.id)}
                      aria-pressed={activeCheckpoint === checkpoint.id}
                    >
                      <strong>{checkpoint.label}</strong>
                      <span>{checkpoint.cue}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="settings-grid">
              <div className="field">
                <label htmlFor="handedness">Hand</label>
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
                <label htmlFor="target-side">Target</label>
                <select
                  id="target-side"
                  className="select"
                  value={targetSide}
                  onChange={(event) => setTargetSide(event.target.value as TargetSide)}
                >
                  <option value="left">Links in beeld</option>
                  <option value="right">Rechts in beeld</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="camera-view">Camera</label>
                <select
                  id="camera-view"
                  className="select"
                  value={cameraView}
                  onChange={(event) => setCameraView(event.target.value as CameraView)}
                >
                  <option value="face-on">Face-on</option>
                  <option value="down-the-line">Down the line</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="club">Club</label>
                <input
                  id="club"
                  className="input"
                  value={club}
                  onChange={(event) => setClub(event.target.value)}
                />
              </div>
            </div>
            <div className="setup-wizard">
              {setupItems.map((item) => (
                <div className="setup-item" key={item.label}>
                  <span className={`setup-dot ${item.done ? "setup-dot-done" : ""}`}>
                    {item.done ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.text}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mobile-capture">
              <div>
                <strong>Mobiele opname</strong>
                <span>Gebruik Film mobiel voor de native camera. Dat werkt ook wanneer live recording door HTTP wordt geblokkeerd.</span>
              </div>
              <div>
                <strong>Beste beeld</strong>
                <span>Portrait mag: face-on, telefoon op heup- tot handhoogte, bal, handen en finish volledig in beeld.</span>
              </div>
              <div>
                <strong>Snelle loop</strong>
                <span>Neem 1 swing op, kalibreer address, check top/impact, doe de drill en film opnieuw.</span>
              </div>
            </div>
            <p className={`status-line ${poseStatus.includes("mislukt") ? "error-line" : ""}`}>
              {poseStatus}{" "}
              {cameraView === "down-the-line"
                ? "Down-the-line metrics letten op posture, hip depth en hand path."
                : "Face-on metrics letten op sway, stack center en lead shoulder down."}
            </p>
          </div>
        </section>

        <aside className="side-stack">
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <BarChart3 size={18} />
                <div>
                  <h3>Analyse</h3>
                  <p>{activeCheckpointData.label}: {activeCheckpointData.target}</p>
                </div>
              </div>
              <button
                className="btn icon-btn"
                type="button"
                onClick={saveSession}
                disabled={!swingScore}
                title="Sla sessie op"
              >
                <Save size={16} />
              </button>
            </div>
            <div className="panel-body">
              <div className="score-band">
                <div className="score-ring" style={scoreStyle}>
                  <div>
                    <strong>{swingScore || "--"}</strong>
                    <span>stack score</span>
                  </div>
                </div>
                <div className="score-copy">
                  <h3>{scoreLabel}</h3>
                  <p>
                    Focus nu op <strong>{selectedFocusMetric?.label ?? "setup calibratie"}</strong>. De app stuurt op
                    stabiel centrum, connected arms en body-release door impact.
                  </p>
                  {bestDelta !== null ? (
                    <p className="delta-line">
                      Beste swing vergelijking: {bestDelta >= 0 ? "+" : ""}
                      {bestDelta} punten.
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="confidence-strip">
                <div>
                  <strong>{confidenceLabel}</strong>
                  <span>analyse vertrouwen</span>
                </div>
                <div className="confidence-meter" aria-label={`Analyse vertrouwen ${confidenceScore}`}>
                  <span style={{ "--value": `${confidenceScore}%` } as CSSProperties} />
                </div>
                <small>{confidenceScore}%</small>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <ListChecks size={18} />
                <div>
                  <h3>Checkpoints</h3>
                  <p>Meetbaar per frame</p>
                </div>
              </div>
            </div>
            <div className="panel-body">
              <div className="focus-row">
                <div className="field">
                  <label htmlFor="focus-metric">Focus mode</label>
                  <select
                    id="focus-metric"
                    className="select"
                    value={metrics.some((metric) => metric.id === focusMetricId) ? focusMetricId : "auto"}
                    onChange={(event) => setFocusMetricId(event.target.value)}
                  >
                    <option value="auto">Auto: zwakste punt</option>
                    {metrics.map((metric) => (
                      <option value={metric.id} key={metric.id}>
                        Alleen {metric.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="metric-list">
                {displayedMetrics.map((metric) => {
                  const Icon = iconMap[metric.icon];
                  return (
                    <div className="metric-row" key={metric.id}>
                      <div className="metric-icon">
                        <Icon size={17} />
                      </div>
                      <div className="metric-main">
                        <strong>{metric.label} - {metric.value}</strong>
                        <span>{metric.detail}</span>
                      </div>
                      <div className="meter" aria-label={`${metric.label} score ${metric.score}`}>
                        <span
                          style={{ "--value": `${clamp(metric.score)}%` } as CSSProperties}
                          className={`meter-${metric.status}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Activity size={18} />
                <div>
                  <h3>Bewegingstracking</h3>
                  <p>Hoofdpad en center-drift door de swing</p>
                </div>
              </div>
              <button
                className="btn"
                type="button"
                onClick={() => void trackSwingMotion()}
                disabled={isTracking || isPoseLoading || !canScanRecordedVideo}
              >
                <Activity size={16} />
                {isTracking ? `${trackProgress}%` : "Track"}
              </button>
            </div>
            <div className="panel-body">
              <div className="motion-chart">
                {headPath || centerPath ? (
                  <svg viewBox="0 0 100 52" role="img" aria-label="Bewegingspad">
                    <line x1="50" y1="4" x2="50" y2="48" className="motion-axis" />
                    <line x1="4" y1="26" x2="96" y2="26" className="motion-axis" />
                    {centerPath ? <path d={centerPath} className="motion-center" /> : null}
                    {headPath ? <path d={headPath} className="motion-head" /> : null}
                    <circle cx="50" cy="26" r="2.2" className="motion-origin" />
                  </svg>
                ) : (
                  <div className="motion-empty">
                    <CircleAlert size={18} />
                    <span>Track een opgenomen swing om hoofd- en centerpad te zien.</span>
                  </div>
                )}
              </div>
              <div className="motion-grid">
                <div className="motion-card">
                  <strong>{motionSummary ? `${motionSummary.headSwayPct.toFixed(0)}%` : "--"}</strong>
                  <span>max head sway</span>
                </div>
                <div className="motion-card">
                  <strong>{motionSummary ? `${motionSummary.headVerticalPct.toFixed(0)}%` : "--"}</strong>
                  <span>verticale hoofdbeweging</span>
                </div>
                <div className="motion-card">
                  <strong>{motionSummary ? `${motionSummary.centerAwayPct.toFixed(0)}%` : "--"}</strong>
                  <span>{cameraView === "down-the-line" ? "center horizontaal A" : "center weg van target"}</span>
                </div>
                <div className="motion-card">
                  <strong>{motionSummary ? `${motionSummary.centerTargetPct.toFixed(0)}%` : "--"}</strong>
                  <span>{cameraView === "down-the-line" ? "center horizontaal B" : "center naar target"}</span>
                </div>
              </div>
              <p className="status-line">
                Oranje trackt je hoofd. Blauw trackt borst/heup-center.{" "}
                {cameraView === "down-the-line"
                  ? "Bij zijkant-video gebruik je dit vooral voor posture en early-extension indicatie."
                  : "Voor Saguto wil je vooral weinig drift weg van target zien."}
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Dumbbell size={18} />
                <div>
                  <h3>Practice block</h3>
                  <p>1 issue, 1 drill, opnieuw testen</p>
                </div>
              </div>
              <span className={`pill ${selectedFocusMetric?.status === "bad" ? "pill-bad" : "pill-warn"}`}>
                {selectedFocusMetric?.label ?? "Setup"}
              </span>
            </div>
            <div className="panel-body">
              <div className="coach-plan">
                <div className="coach-step">
                  <span>1</span>
                  <div>
                    <strong>{focusDrill.title}</strong>
                    <small>{focusDrill.detail}</small>
                  </div>
                </div>
                <div className="coach-step">
                  <span>2</span>
                  <div>
                    <strong>5-ball block</strong>
                    <small>Film de laatste bal, zet playback op 0.5x en analyseer hetzelfde checkpoint.</small>
                  </div>
                </div>
                <div className="coach-step">
                  <span>3</span>
                  <div>
                    <strong>Commit swing</strong>
                    <small>Gebruik alleen de beste feel van de drill en sla 3 normale ballen zonder extra gedachten.</small>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <CheckCircle2 size={18} />
                <div>
                  <h3>Saguto model</h3>
                  <p>Referentiepunten voor deze app</p>
                </div>
              </div>
            </div>
            <div className="panel-body">
              <div className="reference-list">
                {referencePrinciples.map((item, index) => (
                  <div className="reference-item" key={item.title}>
                    <span className="reference-number">{index + 1}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <FileVideo size={18} />
                <div>
                  <h3>Sessie log</h3>
                  <p>Lokale voortgang</p>
                </div>
              </div>
              <button className="btn icon-btn" type="button" onClick={clearSessions} title="Wis log">
                <RefreshCcw size={16} />
              </button>
            </div>
            <div className="panel-body">
              <div className="shot-result-grid">
                {shotResults.map((result) => (
                  <button
                    className="shot-btn"
                    type="button"
                    key={result.id}
                    aria-pressed={shotResult === result.id}
                    onClick={() => setShotResult(result.id)}
                  >
                    {result.label}
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="notes">Feel cue</label>
                <input
                  id="notes"
                  className="input"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Bijv. borst blijft draaien"
                />
              </div>
              <div className="reference-list" style={{ marginTop: 10 }}>
                {sessions.length ? (
                  sessions.map((session) => (
                    <div className="reference-item" key={session.id}>
                      <span className="reference-number">{session.score}</span>
                      <div>
                        <strong>{session.club} - {session.date}</strong>
                        <span>
                          Focus: {session.focus} - Shot:{" "}
                          {shotResults.find((result) => result.id === session.shot)?.label ?? "Geen"} -{" "}
                          {session.cameraView === "down-the-line" ? "DTL" : "Face-on"} - vertrouwen{" "}
                          {session.confidence ?? "--"}%
                          {session.cue ? ` - Cue: ${session.cue}` : ""}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="reference-item">
                    <span className="reference-number">0</span>
                    <div>
                      <strong>Nog geen opgeslagen swings</strong>
                      <span>Analyseer een frame en sla de sessie op.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
