import { useEffect, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { progress, toggleLesson } from "@/lib/progress";

export type Lesson = {
  id: string;
  title: string;
  part: "foundations" | "tools" | "orm";
  order: number;
  summary: string;
  topics: string[];
  minutes: number;
  draft: boolean;
};

export type Part = { id: string; title: string; blurb: string };

type ViewProps = {
  lessons: Lesson[];
  parts: Part[];
  done: Set<string>;
  onToggle?: (id: string, isDone: boolean) => void;
  onReset?: () => void;
};

function Tick({ done }: { done: boolean }) {
  return (
    <span
      className="tick mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-[6px] border"
      data-done={done}
      style={{
        borderColor: done ? "var(--brand-cyan)" : "var(--border)",
        backgroundColor: done ? "var(--brand-cyan)" : "transparent",
      }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" className="tick-mark size-3.5" fill="none">
        <path
          d="M3 8.5l3.2 3.2L13 5"
          stroke="var(--background)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function CurriculumView({ lessons, parts, done, onToggle, onReset }: ViewProps) {
  const available = lessons.filter((l) => !l.draft);
  const upcoming = lessons.length - available.length;

  const completed = available.filter((l) => done.has(l.id)).length;
  const caughtUp = available.length > 0 && completed === available.length;

  const remaining = available
    .filter((l) => !done.has(l.id))
    .reduce((sum, l) => sum + l.minutes, 0);
  const hours = Math.round((remaining / 60) * 10) / 10;

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-mortar">
            {completed === 0
              ? `${available.length} courses ready`
              : caughtUp
                ? "You are up to date"
                : `${completed} of ${available.length} laid`}
          </p>
          <p className="font-mono text-xs tabular-nums text-mortar">
            {caughtUp
              ? upcoming > 0
                ? `${upcoming} more being written`
                : "nothing left to build"
              : `~${hours}h to go`}
          </p>
        </div>

        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={completed}
          aria-valuemin={0}
          aria-valuemax={available.length}
          aria-label="Progress through the published courses"
        >
          <div
            className="progress-fill h-full w-full rounded-full bg-primary"
            style={{
              transform: `scaleX(${available.length ? completed / available.length : 0})`,
            }}
          />
        </div>

        {completed > 0 && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-mortar underline-offset-4 hover:text-foreground hover:underline"
          >
            Reset progress
          </button>
        )}
      </div>

      {parts.map((part) => {
        const items = lessons.filter((l) => l.part === part.id);
        if (!items.length) return null;
        const partAvailable = items.filter((l) => !l.draft);
        const partDone = partAvailable.filter((l) => done.has(l.id)).length;

        return (
          <section key={part.id} className="mt-14">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-2xl tracking-tight">{part.title}</h3>
              <span className="font-mono text-xs tabular-nums text-mortar">
                {partAvailable.length === 0
                  ? `${items.length} being written`
                  : `${partDone}/${partAvailable.length}`}
              </span>
            </div>
            <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">{part.blurb}</p>

            <ol className="mt-6">
              {items.map((lesson, i) => {
                const isDone = done.has(lesson.id);
                return (
                  <li
                    key={lesson.id}
                    data-draft={lesson.draft}
                    className="lesson-row grid grid-cols-[22px_2.25rem_1fr] items-start gap-x-3 border-t border-border py-5 last:border-b"
                    style={{ ["--stagger" as string]: `${Math.min(i * 35, 350)}ms` }}
                  >
                    {lesson.draft ? (
                      <span className="mt-0.5 grid size-[22px] place-items-center" aria-hidden="true">
                        <span className="size-1.5 rounded-full bg-border" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isDone}
                        aria-label={`Mark "${lesson.title}" as ${isDone ? "not done" : "done"}`}
                        onClick={() => onToggle?.(lesson.id, isDone)}
                        className="contents"
                      >
                        <Tick done={isDone} />
                      </button>
                    )}
                    <span className="pt-0.5 font-mono text-sm tabular-nums text-cyan">
                      {String(lesson.order).padStart(2, "0")}
                    </span>
                    <a
                      href={`/courses/${lesson.id}`}
                      className={`lesson-link ${isDone ? "opacity-55" : ""}`}
                    >
                      <span className="flex flex-wrap items-baseline gap-x-3">
                        <span className="font-heading text-lg tracking-tight">
                          {lesson.title}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-mortar">
                          {lesson.minutes} min
                        </span>
                        {lesson.draft && (
                          <span className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.12em] text-mortar">
                            being written
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {lesson.summary}
                      </span>
                      <span className="mt-2 block font-mono text-[11px] uppercase tracking-[0.12em] text-mortar">
                        {lesson.topics.join(" · ")}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </>
  );
}

function LiveCurriculum({ lessons, parts }: { lessons: Lesson[]; parts: Part[] }) {
  const { data: rows } = useLiveQuery((q) => q.from({ p: progress }));
  const done = new Set((rows ?? []).map((r) => r.id));

  return (
    <CurriculumView
      lessons={lessons}
      parts={parts}
      done={done}
      onToggle={toggleLesson}
      onReset={() => done.forEach((id) => toggleLesson(id, true))}
    />
  );
}

export default function Curriculum({ lessons, parts }: { lessons: Lesson[]; parts: Part[] }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (!hydrated) {
    return <CurriculumView lessons={lessons} parts={parts} done={new Set()} />;
  }
  return <LiveCurriculum lessons={lessons} parts={parts} />;
}
