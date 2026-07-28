import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  RECOMMENDATION_CACHE_MAX_AGE_MS,
  RECOMMENDATION_CACHE_VERSION,
  RECOMMENDATION_STALE_TIME_MS,
} from "@chimap/app-core";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  focusManager,
  onlineManager,
  QueryClient,
  type Query,
} from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import NetInfo from "@react-native-community/netinfo";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import {
  shouldPersistRecommendation,
  shouldRefetchRecommendationOnForeground,
} from "./query-persistence-policy";

function persistentRecommendation(query: Query): boolean {
  return shouldPersistRecommendation({
    status: query.state.status,
    persistRecommendation: query.meta?.persistRecommendation === true,
  });
}

const QueryPersistenceContext = createContext<(() => Promise<void>) | null>(null);

function ForegroundRefresh({ queryClient }: { queryClient: QueryClient }) {
  const previous = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    onlineManager.setEventListener((setOnline) =>
      NetInfo.addEventListener((state) => setOnline(state.isConnected === true)),
    );
    const subscription = AppState.addEventListener("change", (next) => {
      const becameActive = previous.current !== "active" && next === "active";
      previous.current = next;
      focusManager.setFocused(next === "active");
      for (const query of queryClient.getQueryCache().findAll({
        type: "active",
        predicate: persistentRecommendation,
      })) {
        if (shouldRefetchRecommendationOnForeground({
          becameActive,
          online: onlineManager.isOnline() !== false,
          now: Date.now(),
          query: {
            status: query.state.status,
            fetchStatus: query.state.fetchStatus,
            dataUpdatedAt: query.state.dataUpdatedAt,
            persistRecommendation:
              query.meta?.persistRecommendation === true,
            requestSavedAt: query.meta?.requestSavedAt,
          },
        })) {
          void query.fetch().catch(() => undefined);
        }
      }
    });
    return () => subscription.remove();
  }, [queryClient]);
  return null;
}

export function RecommendationQueryProvider({
  queryStorageKey,
  children,
}: PropsWithChildren<{ queryStorageKey: string }>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: RECOMMENDATION_CACHE_MAX_AGE_MS,
            staleTime: RECOMMENDATION_STALE_TIME_MS,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      }),
  );
  const [persister] = useState(() =>
    createAsyncStoragePersister({
      storage: AsyncStorage,
      key: queryStorageKey,
      throttleTime: 1_000,
    }),
  );
  const clearPersistedQueries = useCallback(async () => {
    queryClient.clear();
    await persister.removeClient();
  }, [persister, queryClient]);

  return (
    <QueryPersistenceContext.Provider value={clearPersistedQueries}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          buster: `chimap-mobile-recommendation-${RECOMMENDATION_CACHE_VERSION}`,
          maxAge: RECOMMENDATION_CACHE_MAX_AGE_MS,
          persister,
          dehydrateOptions: { shouldDehydrateQuery: persistentRecommendation },
        }}
      >
        <ForegroundRefresh queryClient={queryClient} />
        {children}
      </PersistQueryClientProvider>
    </QueryPersistenceContext.Provider>
  );
}

export function useClearPersistedRecommendationQueries(): () => Promise<void> {
  const clear = useContext(QueryPersistenceContext);
  if (clear === null) {
    throw new Error("RecommendationQueryProvider가 필요합니다.");
  }
  return clear;
}

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: {
      persistRecommendation?: boolean;
      requestSavedAt?: string | null;
    };
  }
}
