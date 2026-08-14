import { useEffect, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { progress, toggleLesson } from "@/lib/progress";

function Button({ done, onClick }: { done: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      onClick={onClick}
      disabled={!onClick}
      className="tick-btn inline-flex items-center gap-2.5 rounded-md border px-4 py-2.5 text-sm font-medium"
      style={{
        borderColor: done ? "var(--brand-cyan)" : "var(--border)",
        backgroundColor: done ? "var(--accent)" : "transparent",
      }}
    >
      <span
        className="tick grid size-[18px] place-items-center rounded-[5px] border"
        data-done={done}
        style={{
          borderColor: done ? "var(--brand-cyan)" : "var(--border)",
          backgroundColor: done ? "var(--brand-cyan)" : "transparent",
        }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16" className="tick-mark size-3" fill="none">
          <path
            d="M3 8.5l3.2 3.2L13 5"
            stroke="var(--background)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {done ? "Completed" : "Mark as complete"}
    </button>
  );
}

function Live({ lessonId }: { lessonId: string }) {
  const { data: rows } = useLiveQuery((q) => q.from({ p: progress }));
  const done = (rows ?? []).some((r) => r.id === lessonId);
  return <Button done={done} onClick={() => toggleLesson(lessonId, done)} />;
}

export default function MarkComplete({ lessonId }: { lessonId: string }) {
  // Same gate as the curriculum island: useLiveQuery has no server snapshot.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated) return <Button done={false} />;
  return <Live lessonId={lessonId} />;
}
