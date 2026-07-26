import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import { useStore } from "zustand";

import {
  createRouteStore,
  type RouteStore,
  type RouteStoreState,
} from "./route-store";

const RouteStoreContext = createContext<RouteStore | null>(null);

export function RouteStoreProvider({
  storageKey,
  children,
}: PropsWithChildren<{ storageKey: string }>) {
  const [store] = useState(() => createRouteStore(storageKey));
  useEffect(() => {
    void store.persist.rehydrate();
  }, [store]);
  return (
    <RouteStoreContext.Provider value={store}>
      {children}
    </RouteStoreContext.Provider>
  );
}

export function useRouteStore<T>(selector: (state: RouteStoreState) => T): T {
  const store = useContext(RouteStoreContext);
  if (store === null) {
    throw new Error("RouteStoreProvider가 필요합니다.");
  }
  return useStore(store, selector);
}

export function useRouteStoreApi(): RouteStore {
  const store = useContext(RouteStoreContext);
  if (store === null) {
    throw new Error("RouteStoreProvider가 필요합니다.");
  }
  return store;
}
