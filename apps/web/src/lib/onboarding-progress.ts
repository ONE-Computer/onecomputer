const STORAGE_KEY = "oc_onboarding_progress";

export type OnboardingStep =
  | "invite-users"
  | "review-roles"
  | "package-gate"
  | "first-sandbox"
  | "approval-policy"
  | "cyber-console";

export interface OnboardingProgress {
  completed: OnboardingStep[];
}

const isClient = typeof window !== "undefined";

export const getProgress = (): OnboardingProgress => {
  if (!isClient) return { completed: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { completed: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "completed" in parsed &&
      Array.isArray((parsed as { completed: unknown }).completed)
    ) {
      return parsed as OnboardingProgress;
    }
  } catch {
    // corrupt storage — reset silently
  }
  return { completed: [] };
};

export const markStepComplete = (step: OnboardingStep): OnboardingProgress => {
  const progress = getProgress();
  if (!progress.completed.includes(step)) {
    progress.completed = [...progress.completed, step];
  }
  if (isClient) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }
  return progress;
};

export const resetProgress = (): void => {
  if (isClient) {
    localStorage.removeItem(STORAGE_KEY);
  }
};
