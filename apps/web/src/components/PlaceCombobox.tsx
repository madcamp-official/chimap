import type { Coordinate, Place } from "@chimap/contracts";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Search } from "lucide-react";
import {
  type KeyboardEvent,
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
  const debouncedQuery = useDebouncedValue(query.trim(), 300);

  useEffect(() => {
    setQuery(value?.name ?? "");
  }, [value]);

  const searchQuery = useQuery({
    queryKey: [
      "places",
      debouncedQuery,
      center?.lng,
      center?.lat,
    ],
    enabled: open && debouncedQuery.length >= 2,
    queryFn: ({ signal }) =>
      searchPlaces({
        query: debouncedQuery,
        ...(center === undefined ? {} : { center }),
        signal,
      }),
    staleTime: 60 * 60 * 1000,
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
    if (debouncedQuery.length >= 2 && items.length === 0) {
      return "검색 결과가 없어요. 다른 이름이나 주소로 찾아보세요.";
    }
    return "";
  }, [
    debouncedQuery.length,
    items.length,
    open,
    query,
    searchQuery.isError,
    searchQuery.isFetching,
  ]);

  function selectPlace(place: Place): void {
    onChange(place);
    setQuery(place.name);
    setOpen(false);
    setActiveIndex(-1);
  }

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
        <Search aria-hidden="true" size={18} />
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
