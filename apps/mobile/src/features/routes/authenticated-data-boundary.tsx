import { type PropsWithChildren, useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";

import {
  storageKeysForUser,
  type MobileStorageKeys,
} from "../../platform/storage/namespace";
import { useMobileSession } from "../auth/mobile-session";
import { WalkingProfileProvider } from "../profile/walking-profile";
import {
  RecommendationQueryProvider,
  useClearPersistedRecommendationQueries,
} from "./query-persistence";
import {
  RouteStoreProvider,
  useRouteStoreApi,
} from "./route-store-context";

function LocalCleanupRegistration({ userId }: { userId: string }) {
  const { registerLocalCleanup } = useMobileSession();
  const clearQueries = useClearPersistedRecommendationQueries();
  const routeStore = useRouteStoreApi();
  useEffect(
    () =>
      registerLocalCleanup(userId, async () => {
        routeStore.getState().reset();
        await Promise.all([
          routeStore.persist.clearStorage(),
          clearQueries(),
        ]);
      }),
    [clearQueries, registerLocalCleanup, routeStore, userId],
  );
  return null;
}

export function AuthenticatedDataBoundary({
  ownerId,
  children,
}: PropsWithChildren<{ ownerId: string }>) {
  const [resolvedStorage, setResolvedStorage] = useState<{
    userId: string;
    keys: MobileStorageKeys;
  } | null>(null);
  useEffect(() => {
    let mounted = true;
    void storageKeysForUser(ownerId).then((resolved) => {
      if (mounted) {
        setResolvedStorage({ userId: ownerId, keys: resolved });
      }
    });
    return () => {
      mounted = false;
    };
  }, [ownerId]);
  if (resolvedStorage?.userId !== ownerId) {
    return <ActivityIndicator accessibilityLabel="저장된 경로 복원 중" />;
  }
  const { keys } = resolvedStorage;
  return (
    <WalkingProfileProvider storageKey={keys.profile}>
      <RecommendationQueryProvider key={keys.query} queryStorageKey={keys.query}>
        <RouteStoreProvider storageKey={keys.route}>
          <LocalCleanupRegistration userId={ownerId} />
          {children}
        </RouteStoreProvider>
      </RecommendationQueryProvider>
    </WalkingProfileProvider>
  );
}
