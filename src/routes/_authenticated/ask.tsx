// Ask your mill: type a question in Khmer or English, get an answer computed
// from the live data the signed-in user is allowed to see.
//
// All the thinking happens in the `ask` edge function — it snapshots the
// caller's data under their own RLS and sends it to the AI gateway. This page
// is just the conversation: question in, answer out, nothing stored.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Check, Copy, Loader2, MessageCircleQuestion, Mic, MicOff, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ask")({
  component: AskPage,
});

type Turn = { role: "user" | "assistant"; text: string };

// The gateway models decorate with markdown even when told not to; the page
// renders plain text, so strip the common markers rather than render them raw.
const stripMarkdown = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "• ");

// Chips double as documentation of what the feature can do — one per data
// area, half Khmer half English so the bilingual answering is discoverable.
const SUGGESTIONS = [
  "How much paddy was delivered this month?",
  "Which deliveries failed a moisture test?",
  "តើកសិករណាខ្លះនៅខេត្តកំពង់ធំ?",
  "តើឡូតិ៍ណាខ្លះកំពុងបើក ហើយស្រូវប៉ុន្មានគីឡូ?",
  "Which farms are at risk right now?",
];

// Answers take 10-20s (snapshot + gateway round-trip). A single frozen
// "Thinking…" reads as a hang on stage; rotating stage copy reads as work.
const WORKING: Record<"en" | "km", string[]> = {
  en: [
    "Reading your deliveries…",
    "Checking quality tests…",
    "Looking at contracts and batches…",
    "Checking alerts and field records…",
    "Writing the answer…",
  ],
  km: [
    "កំពុងអានការដឹកជញ្ជូន…",
    "កំពុងពិនិត្យតេស្តគុណភាព…",
    "កំពុងមើលកិច្ចសន្យា និងឡូតិ៍…",
    "កំពុងពិនិត្យការជូនដំណឹង…",
    "កំពុងសរសេរចម្លើយ…",
  ],
};

function AskPage() {
  const { t, lang } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [workingStep, setWorkingStep] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  // Web Speech API — Chrome only in practice. Khmer (km-KH) when the UI is
  // Khmer, else English. Hidden entirely where the browser has no recogniser.
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const speechCtor =
    typeof window !== "undefined"
      ? ((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition)
      : undefined;
  const toggleListening = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    if (!speechCtor) return;
    type Rec = {
      lang: string; interimResults: boolean; maxAlternatives: number;
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void;
    };
    const rec = new (speechCtor as new () => Rec)();
    rec.lang = lang === "km" ? "km-KH" : "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0]?.transcript ?? "").join(" ").trim();
      if (text) setQuestion((q) => (q ? `${q} ${text}` : text));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!busy) return;
    setWorkingStep(0);
    const id = setInterval(
      () => setWorkingStep((s) => Math.min(s + 1, WORKING.en.length - 1)),
      3000,
    );
    return () => clearInterval(id);
  }, [busy]);

  const copyAnswer = async (text: string, i: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    } catch {
      /* clipboard unavailable (http/permissions) — silently skip */
    }
  };

  const ask = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setQuestion("");
    setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
    const { data, error } = await supabase.functions.invoke("ask", {
      body: { question: trimmed },
    });
    const answer = error
      ? t("ask.error")
      : data?.answer ?? data?.error ?? t("ask.error");
    setTurns((prev) => [...prev, { role: "assistant", text: stripMarkdown(answer) }]);
    setBusy(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("ask.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("ask.subtitle")}</p>
      </div>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <Button key={s} variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => ask(s)}>
              {s}
            </Button>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto">
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                {turn.text}
              </div>
            </div>
          ) : (
            <Card key={i} className="group">
              <CardContent className="flex gap-2 p-3">
                <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{turn.text}</div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => copyAnswer(turn.text, i)}
                  aria-label="Copy answer"
                >
                  {copied === i ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </CardContent>
            </Card>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {(WORKING[lang] ?? WORKING.en)[workingStep]}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
          placeholder={t("ask.placeholder")}
          rows={2}
          className="resize-none"
        />
        {speechCtor ? (
          <Button
            type="button"
            variant={listening ? "default" : "outline"}
            size="icon"
            className="shrink-0"
            onClick={toggleListening}
            aria-label={listening ? "Stop listening" : lang === "km" ? "និយាយសំណួរ" : "Speak your question"}
            title={lang === "km" ? "និយាយជាភាសាខ្មែរ" : "Speak (English)"}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        ) : null}
        <Button type="submit" disabled={busy || !question.trim()} size="icon" className="shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
