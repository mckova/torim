import { ReactNode, useEffect, useRef, useState } from "react";
import { translateError } from "./api";
import { Icon } from "./Icon";
import { useDictation } from "./voice";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  extra?: ReactNode;
}

/** Minimal chat surface shared by the receptionist (client app) and the copilot (provider app). */
export function ChatPanel({
  intro,
  suggestions,
  send,
  placeholder,
  height = 460,
}: {
  intro: string;
  suggestions: string[];
  send: (text: string) => Promise<{ reply: string; extra?: ReactNode }>;
  placeholder: string;
  height?: number | string;
}) {
  const [items, setItems] = useState<ChatMessage[]>([{ role: "assistant", text: intro }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const voice = useDictation((text, final) => {
    setDraft(text);
    if (final) submit(text);
  });

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [items, busy]);

  async function submit(text: string) {
    if (!text.trim() || busy) return;
    setItems((x) => [...x, { role: "user", text }]);
    setDraft("");
    setBusy(true);
    try {
      const r = await send(text);
      setItems((x) => [...x, { role: "assistant", text: r.reply, extra: r.extra }]);
    } catch (e) {
      setItems((x) => [...x, { role: "assistant", text: "⚠️ " + translateError(e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat card" style={{ height }}>
      <div className="chat-log" aria-live="polite">
        {items.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`} dir="auto">
            <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
            {m.extra}
          </div>
        ))}
        {busy && (
          <div className="bubble assistant typing">
            <span />
            <span />
            <span />
          </div>
        )}
        {items.length === 1 && (
          <div className="row wrap" style={{ marginTop: "0.5rem" }}>
            {suggestions.map((s) => (
              <button key={s} className="chip" onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <label className="sr-only" htmlFor="chat-draft">
          {placeholder}
        </label>
        <input id="chat-draft" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={voice.listening ? "מקשיבה…" : placeholder} disabled={busy} autoComplete="off" />
        {voice.supported && (
          <button
            type="button"
            className={`btn ghost icon-only mic ${voice.listening ? "live" : ""}`}
            onClick={() => (voice.listening ? voice.stop() : voice.start())}
            aria-label={voice.listening ? "עצירת הקלטה" : "דיבור במקום הקלדה"}
            aria-pressed={voice.listening}
            disabled={busy}
          >
            <Icon name="mic" />
          </button>
        )}
        <button className="btn icon-only" disabled={busy || !draft.trim()} aria-label="שליחה">
          <Icon name="send" className="flip-rtl" />
        </button>
      </form>
    </div>
  );
}
