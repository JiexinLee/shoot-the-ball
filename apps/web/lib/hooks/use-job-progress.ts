import { useEffect, useState } from "react";

export function useJobProgress(jobId: string | null | undefined) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<
    "idle" | "running" | "completed" | "failed"
  >("idle");
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!jobId) {
      setProgress(0);
      setStage(undefined);
      setStatus("idle");
      setError(undefined);
      return;
    }

    setStatus("running");
  }, [jobId]);

  return { progress, stage, status, error };
}

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (value: T | ((prev: T) => T)) => {
    try {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch {
      /* ignore write errors */
    }
  };

  return [storedValue, setValue] as const;
}
