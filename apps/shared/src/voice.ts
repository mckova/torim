import { useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Recognition = any;

function ctor(): (new () => Recognition) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Speech-to-text through the browser's speech recognition (Chrome, Edge, Safari). */
export function useDictation(onText: (text: string, final: boolean) => void, lang = "en-US") {
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  const supported = typeof window !== "undefined" && !!ctor();

  useEffect(
    () => () => {
      rec.current?.abort?.();
    },
    [],
  );

  function start() {
    const C = ctor();
    if (!C || listening) return;
    const r = new C();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e: any) => {
      let text = "";
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        final = final || e.results[i].isFinal;
      }
      cb.current(text, final);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }

  function stop() {
    rec.current?.stop?.();
  }

  return { supported, listening, start, stop };
}
