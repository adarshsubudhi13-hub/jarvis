import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const FUZZY_ALIASES = ["jarvis", "javis", "jarvas", "jervis", "jarves", "travis", "charvis"];

function findWake(text: string, wakeWord: string) {
  const lower = text.toLowerCase();
  const candidates =
    wakeWord.toLowerCase() === "jarvis" ? FUZZY_ALIASES : [wakeWord.toLowerCase()];
  let best: { index: number; length: number } | null = null;
  for (const word of candidates) {
    const index = lower.indexOf(word);
    if (index !== -1 && (!best || index < best.index)) best = { index, length: word.length };
  }
  return best;
}

const INTERRUPT_RE = /\b(stop|wait|shut up|hold on|cancel|quiet|nevermind|never mind|enough)\b/i;

export function useVoice(options: {
  onFinalTranscript: (text: string) => void;
  onWake?: () => void;
  onInterrupt?: () => void;
  busy?: boolean;
  wakeWord?: string;
  wakeWordRequired?: boolean;
  speechRate?: number;
  micDeviceId?: string;
}) {
  const {
    onFinalTranscript,
    onWake,
    onInterrupt,
    busy = false,
    wakeWord = "jarvis",
    wakeWordRequired = true,
    speechRate = 1.03,
    micDeviceId = "",
  } = options;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [wakeMode, setWakeMode] = useState(false);
  const [awake, setAwake] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeModeRef = useRef(false);
  const armedUntilRef = useRef(0);
  const requireWakeRef = useRef(wakeWordRequired);
  requireWakeRef.current = wakeWordRequired;
  const rateRef = useRef(speechRate);
  rateRef.current = speechRate;
  const micRef = useRef(micDeviceId);
  micRef.current = micDeviceId;
  const callbackRef = useRef(onFinalTranscript);
  callbackRef.current = onFinalTranscript;
  const wakeCallbackRef = useRef(onWake);
  wakeCallbackRef.current = onWake;
  const interruptCallbackRef = useRef(onInterrupt);
  interruptCallbackRef.current = onInterrupt;
  const speakingRef = useRef(false);
  const forceWakeRef = useRef(false);
  const manualStopRef = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const maybeInterrupt = (text: string) => {
    if (!speakingRef.current && !busyRef.current) return false;
    if (!INTERRUPT_RE.test(text)) return false;
    speakingRef.current = false;
    setSpeaking(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    // Disarm: after an interrupt the wake word must be said again.
    armedUntilRef.current = 0;
    setAwake(false);
    forceWakeRef.current = true;
    interruptCallbackRef.current?.();
    return true;
  };
  const interruptRef = useRef(maybeInterrupt);
  interruptRef.current = maybeInterrupt;



  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript as string;
        if (event.results[i].isFinal) finalText += chunk;
        else interimText += chunk;
      }
      setInterim(interimText);
      if (interimText.trim() && interruptRef.current(interimText)) {
        setInterim("");
        return;
      }
      const cleaned = finalText.trim();
      if (!cleaned) return;
      setInterim("");
      if (interruptRef.current(cleaned)) return;

      if (wakeModeRef.current && (requireWakeRef.current || forceWakeRef.current)) {
        const hit = findWake(cleaned, wakeWord);
        if (hit) {
          const command = cleaned.slice(hit.index + hit.length).replace(/^[,.\s!?]+/, "").trim();
          forceWakeRef.current = false;
          if (command) {
            armedUntilRef.current = 0;
            setAwake(false);
            callbackRef.current(command);
          } else {
            // Wake word alone — acknowledge and listen for the follow-up command.
            armedUntilRef.current = Date.now() + 15000;
            setAwake(true);
            wakeCallbackRef.current?.();
          }
          return;
        }
        if (Date.now() < armedUntilRef.current) {
          armedUntilRef.current = 0;
          setAwake(false);
          callbackRef.current(cleaned);
        }
        return;
      }

      callbackRef.current(cleaned);

    };

    recognition.onerror = (event: any) => {
      if (event?.error === "not-allowed") setError("Microphone permission denied.");
      else if (event?.error === "no-speech") setError(null);
      else if (event?.error) setError("Speech recognition unavailable.");
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim("");
      if (wakeModeRef.current && !manualStopRef.current) {
        try {
          recognition.start();
          setListening(true);
        } catch {
          /* already started */
        }
      }
    };

    recognitionRef.current = recognition;
    return () => {
      wakeModeRef.current = false;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        /* noop */
      }
    };
  }, [wakeWord]);

  // Temporarily accept a command (e.g. "yes"/"no") without the wake word.
  const arm = useCallback((ms = 30000) => {
    forceWakeRef.current = false;
    armedUntilRef.current = Date.now() + ms;
    setAwake(true);
  }, []);

  const start = useCallback(() => {
    manualStopRef.current = false;
    setError(null);
    // Prime the chosen input device so the browser routes capture through it.
    if (micRef.current && typeof navigator !== "undefined" && navigator.mediaDevices) {
      navigator.mediaDevices
        .getUserMedia({ audio: { deviceId: { exact: micRef.current } } })
        .then((stream) => stream.getTracks().forEach((t) => t.stop()))
        .catch(() => setError("Selected microphone unavailable."));
    }
    try {
      recognitionRef.current?.start();
      setListening(true);
    } catch {
      /* already listening */
    }
  }, []);


  const stop = useCallback(() => {
    // Intentional stop: stay off until the user explicitly starts again.
    manualStopRef.current = true;
    wakeModeRef.current = false;
    setWakeMode(false);
    armedUntilRef.current = 0;
    setAwake(false);
    try {
      // abort() ends capture immediately (stop() can wait for a final result).
      recognitionRef.current?.abort();
    } catch {
      /* noop */
    }
    setListening(false);
  }, []);

  const startWakeMode = useCallback(() => {
    if (wakeModeRef.current) return;
    manualStopRef.current = false;
    wakeModeRef.current = true;
    setWakeMode(true);
    armedUntilRef.current = 0;
    forceWakeRef.current = false;
    setAwake(false);
    start();
  }, [start]);

  const toggleWakeMode = useCallback(() => {
    if (wakeModeRef.current) stop();
    else startWakeMode();
  }, [startWakeMode, stop]);


  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const clean = text
      .replace(/```[\s\S]*?```/g, " code block ")
      .replace(/[*_`#>]/g, "")
      .trim();
    if (!clean) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = rateRef.current;
    utterance.pitch = 0.9;
    const preferred = window.speechSynthesis
      .getVoices()
      .find((v) => /daniel|google uk english male|male/i.test(v.name) && v.lang.startsWith("en"));
    if (preferred) utterance.voice = preferred;
    utterance.onstart = () => {
      speakingRef.current = true;
      setSpeaking(true);
    };
    utterance.onend = () => {
      speakingRef.current = false;
      setSpeaking(false);
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      setSpeaking(false);
    };
    window.speechSynthesis.speak(utterance);
  }, []);

  const shutUp = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  return {
    supported,
    listening,
    speaking,
    wakeMode,
    awake,
    interim,
    error,

    start,
    stop,
    startWakeMode,
    toggleWakeMode,
    speak,
    shutUp,
    arm,
  };
}
