import type { WalkingProfile } from "@chimap/contracts";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  readWalkingProfile,
  removeWalkingProfile,
  type SavedWalkingProfile,
  writeWalkingProfile,
} from "./walking-profile-storage";

type WalkingProfileContextValue = {
  loading: boolean;
  value: SavedWalkingProfile | null;
  save(profile: WalkingProfile, dailyGoalSteps: number): Promise<void>;
  clear(): Promise<void>;
};

const WalkingProfileContext =
  createContext<WalkingProfileContextValue | null>(null);

export function WalkingProfileProvider({
  storageKey,
  children,
}: PropsWithChildren<{ storageKey: string }>) {
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState<SavedWalkingProfile | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void readWalkingProfile(storageKey)
      .then((stored) => {
        if (mounted) {
          setValue(stored);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [storageKey]);

  const save = useCallback(
    async (profile: WalkingProfile, dailyGoalSteps: number) => {
      setValue(await writeWalkingProfile(storageKey, profile, dailyGoalSteps));
    },
    [storageKey],
  );
  const clear = useCallback(async () => {
    await removeWalkingProfile(storageKey);
    setValue(null);
  }, [storageKey]);
  const context = useMemo(
    () => ({ loading, value, save, clear }),
    [clear, loading, save, value],
  );
  return (
    <WalkingProfileContext.Provider value={context}>
      {children}
    </WalkingProfileContext.Provider>
  );
}

export function useWalkingProfile(): WalkingProfileContextValue {
  const context = useContext(WalkingProfileContext);
  if (context === null) {
    throw new Error("WalkingProfileProvider가 필요합니다.");
  }
  return context;
}
