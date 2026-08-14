import { createCollection, localStorageCollectionOptions } from "@tanstack/react-db";

/**
 * One row per lesson the reader has finished. Absent means "not started" —
 * we never write a row for an unfinished lesson, so the store stays small
 * and "clear my progress" is just a matter of deleting rows.
 */
export type LessonProgress = {
  id: string;
  completedAt: string;
};

/**
 * Progress lives in localStorage: it survives a refresh, syncs across tabs
 * via the storage event, and needs no account or backend. If GoMason ever
 * grows sign-in, this collection swaps for a query collection and the
 * components below do not change.
 */
export const progress = createCollection(
  localStorageCollectionOptions<LessonProgress>({
    id: "lesson-progress",
    storageKey: "gomason:progress:v1",
    getKey: (row) => row.id,
  }),
);

export function markComplete(lessonId: string) {
  progress.insert({ id: lessonId, completedAt: new Date().toISOString() });
}

export function markIncomplete(lessonId: string) {
  progress.delete(lessonId);
}

export function toggleLesson(lessonId: string, isComplete: boolean) {
  if (isComplete) markIncomplete(lessonId);
  else markComplete(lessonId);
}
