"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Message = {
  id: string;
  role: "tutor" | "learner";
  content: string;
  createdAt: string;
};

type Props = {
  lessonId: string;
  courseSlug: string;
  lessonSlug: string;
  initialMessages: Message[];
  isComplete: boolean;
  isCurrent: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  prevSlug: string | null;
  nextSlug: string | null;
};

export function ChatLesson(props: Props) {
  const [messages, setMessages] = useState<Message[]>(props.initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(props.isComplete);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  // Make sure the first tutor line always shows even if the server snapshot was
  // empty (e.g. seed was just run for the first time and the lesson has no
  // messages yet).
  useEffect(() => {
    if (messages.length === 0 && !complete) {
      void seedFirstTurn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  async function seedFirstTurn() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lessons/${props.lessonId}/seed`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Failed to load lesson (${res.status})`);
      const data = (await res.json()) as { message: Message };
      setMessages([data.message]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load lesson");
    } finally {
      setBusy(false);
    }
  }

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const content = input.trim();
    if (!content || busy || complete) return;
    setBusy(true);
    setError(null);
    // Optimistically show the learner turn.
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      role: "learner",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setInput("");
    try {
      const res = await fetch(`/api/lessons/${props.lessonId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const body = await safeJson(res);
        throw new Error(body?.error ?? `Server error (${res.status})`);
      }
      const data = (await res.json()) as {
        learnerMessage: Message;
        tutorMessage: Message;
        isComplete: boolean;
      };
      setMessages((m) => {
        const without = m.filter((x) => x.id !== optimistic.id);
        return [...without, data.learnerMessage, data.tutorMessage];
      });
      if (data.isComplete) setComplete(true);
      // Refresh the server view so progress counts update.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(content);
    } finally {
      setBusy(false);
    }
  }

  async function markComplete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lessons/${props.lessonId}/complete`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await safeJson(res);
        throw new Error(body?.error ?? `Server error (${res.status})`);
      }
      setComplete(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark complete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat-shell">
      {error ? (
        <div className="notice" role="alert" data-testid="chat-error">
          {error}
        </div>
      ) : null}
      {complete ? (
        <div className="notice success" data-testid="lesson-complete">
          Lesson complete. Great work!
        </div>
      ) : null}

      <div
        className="chat-transcript"
        ref={transcriptRef}
        data-testid="chat-transcript"
        aria-live="polite"
      >
        {messages.length === 0 && busy ? (
          <div className="muted">Loading…</div>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`bubble ${m.role}${complete && m.role === "tutor" ? " terminal" : ""}`}
            data-testid={`bubble-${m.role}`}
          >
            {m.content}
          </div>
        ))}
      </div>

      <form className="chat-form" onSubmit={send} data-testid="chat-form">
        <label htmlFor="chat-input" className="muted" style={{ display: "none" }}>
          Your reply
        </label>
        <textarea
          id="chat-input"
          data-testid="chat-input"
          placeholder={
            complete
              ? "This lesson is complete — navigate to the next lesson."
              : "Type your reply…"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy || complete}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(e as unknown as React.FormEvent<HTMLFormElement>);
            }
          }}
        />
        <button
          type="submit"
          data-testid="chat-send"
          disabled={busy || complete || input.trim().length === 0}
        >
          {busy ? <span className="spinner" /> : "Send"}
        </button>
      </form>

      <div className="actions-row">
        <div>
          {props.hasPrev ? (
            <Link
              href={`/courses/${props.courseSlug}/lessons/${props.prevSlug}`}
              className="ghost"
              data-testid="prev-lesson"
            >
              ← Previous
            </Link>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!complete ? (
            <button
              type="button"
              className="ghost"
              data-testid="mark-complete"
              onClick={markComplete}
              disabled={busy}
            >
              Mark complete
            </button>
          ) : null}
          {props.hasNext ? (
            <Link
              href={`/courses/${props.courseSlug}/lessons/${props.nextSlug}`}
              className="ghost"
              data-testid="next-lesson"
            >
              Next lesson →
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

async function safeJson(res: Response): Promise<{ error?: string } | null> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return null;
  }
}