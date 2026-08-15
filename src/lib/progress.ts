import { createCollection, localStorageCollectionOptions } from "@tanstack/react-db";

export type LessonProgress = {
  id: string;
  completedAt: string;
};

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
