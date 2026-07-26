import { recommendationQueryKey } from "@chimap/app-core";
import {
  recommendationResponseSchema,
  type RecommendationRequest,
} from "@chimap/contracts";
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useEffect } from "react";

import { useRouteStore } from "./route-store-context";
import { mobileClientHeaders } from "../api/client-metadata";
import { fetchWithTimeout } from "../api/fetch-with-timeout";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function hashRecommendationRequest(
  request: RecommendationRequest,
): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalJson(request),
  );
}

export function useRecommendationQuery(input: {
  apiBaseUrl: string;
  accessToken: string;
  request: RecommendationRequest | null;
  requestHash: string | null;
  requestSavedAt: string | null;
}) {
  const hydrated = useRouteStore((state) => state.hydrated);
  const reconcileRecommendations = useRouteStore(
    (state) => state.reconcileRecommendations,
  );
  const query = useQuery({
    queryKey: recommendationQueryKey(input.requestHash ?? "not-ready"),
    enabled: input.request !== null && input.requestHash !== null,
    meta: {
      persistRecommendation: true,
      requestSavedAt: input.requestSavedAt,
    },
    select: (data) => recommendationResponseSchema.parse(data),
    queryFn: async () => {
      if (input.request === null) {
        throw new Error("추천 요청이 준비되지 않았습니다.");
      }
      const response = await fetchWithTimeout(
        `${input.apiBaseUrl}/api/v1/recommendations`,
        {
          method: "POST",
          headers: mobileClientHeaders({
            ...(input.accessToken.length === 0
              ? {}
              : { Authorization: `Bearer ${input.accessToken}` }),
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(input.request),
        },
        25_000,
      );
      if (!response.ok) {
        throw new Error("추천 경로를 갱신하지 못했습니다.");
      }
      return recommendationResponseSchema.parse(await response.json());
    },
  });
  useEffect(() => {
    if (hydrated && query.data !== undefined) {
      reconcileRecommendations(query.data);
    }
  }, [hydrated, query.data, reconcileRecommendations]);
  return query;
}
