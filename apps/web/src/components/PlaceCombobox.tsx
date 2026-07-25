import type { Coordinate, Place } from "@chimap/contracts";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Search } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

import { useDebouncedValue } from "../hooks/use-debounced-value.js";
import { searchPlaces } from "../lib/api.js";

type PlaceComboboxProps = {
  label: string;
  placeholder: string;
  value: Place | undefined;
  center?: Coordinate;
  onChange: (place: Place | undefined) => void;
};

export function PlaceCombobox({
  label,
  placeholder,
  value,
  center,
  onChange,
}: PlaceComboboxProps) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [resolveRequest, setResolveRequest] = useState<{
    query: string;
    sequence: number;
  }>();
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const requestQuery = resolveRequest?.query ?? debouncedQuery;
  const scope = resolveRequest === undefined ? "suggest" : "resolve";

  useEffect(() => {
    setQuery(value?.name ?? "");
  }, [value]);

  const searchQuery = useQuery({
    queryKey: [
      "places",
      requestQuery,
      scope,
      resolveRequest?.sequence,
      center?.lng,
      center?.lat,
    ],
    enabled: open && requestQuery.length >= 2,
    queryFn: ({ signal }) =>
      searchPlaces({
        query: requestQuery,
        scope,
        ...(center === undefined ? {} : { center }),
        signal,
      }),
    staleTime: 10 * 60 * 1000,
  });

  const items = searchQuery.data?.items ?? [];
  const activeId =
    activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined;
  const status = useMemo(() => {
    if (!open) {
      return "";
    }
    if (query.trim().length > 0 && query.trim().length < 2) {
      return "두 글자 이상 입력해 주세요.";
    }
    if (searchQuery.isFetching) {
      return "장소를 찾고 있어요.";
    }
    if (searchQuery.isError) {
      return "장소 검색을 불러오지 못했어요.";
    }
    if (requestQuery.length >= 2 && items.length === 0) {
      return scope === "resolve"
        ? "최종 검색 결과가 없어요. 다른 이름이나 주소로 찾아보세요."
        : "자동완성 결과가 없어요. Enter 또는 검색 버튼으로 주소까지 찾아보세요.";
    }
    return "";
  }, [
    items.length,
    open,
    query,
    requestQuery.length,
    scope,
    searchQuery.isError,
    searchQuery.isFetching,
  ]);

  function selectPlace(place: Place): void {
    onChange(place);
    setQuery(place.name);
    setOpen(false);
    setActiveIndex(-1);
  }

  const resolve = useCallback(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setOpen(true);
      return;
    }
    setOpen(true);
    setActiveIndex(-1);
    setResolveRequest((current) => ({
      query: normalized,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  }, [query]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(items.length - 1, 0)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const place = items[activeIndex];
      if (place !== undefined) {
        selectPlace(place);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      resolve();
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="place-combobox">
      <label className="field-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="place-input-wrap">
        <button
          type="button"
          className="place-search-button"
          aria-label={`${label} 검색`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={resolve}
        >
          <Search aria-hidden="true" size={18} />
        </button>
        <input
          id={inputId}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeId}
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
            setResolveRequest(undefined);
            if (event.target.value !== value?.name) {
              onChange(undefined);
            }
          }}
          onKeyDown={handleKeyDown}
        />
        {searchQuery.isFetching ? (
          <span className="search-spinner" aria-hidden="true" />
        ) : null}
      </div>

      {open && (items.length > 0 || status.length > 0) ? (
        <div className="place-popover">
          {items.length > 0 ? (
            <ul id={listboxId} role="listbox" aria-label={`${label} 검색 결과`}>
              {items.map((place, index) => (
                <li
                  key={place.id}
                  id={`${inputId}-option-${index}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  className={activeIndex === index ? "is-active" : ""}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectPlace(place);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <MapPin aria-hidden="true" size={17} />
                  <span>
                    <strong>{place.name}</strong>
                    <small>
                      {place.roadAddress || place.address || place.category}
                    </small>
                    {place.id.startsWith("naver:") ? (
                      <em className="place-provider">NAVER 주소</em>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="place-status" role="status">
              {status}
            </p>
          )}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
