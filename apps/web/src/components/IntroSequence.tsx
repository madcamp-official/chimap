import { Navigation } from "lucide-react";
import { useEffect } from "react";

export const INTRO_SESSION_KEY = "chimap:intro-seen-v1";

function reducedMotionRequested(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function wasIntroSeen(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberIntro(): void {
  try {
    window.sessionStorage.setItem(INTRO_SESSION_KEY, "1");
  } catch {
    // 저장소가 차단돼도 인트로 종료와 앱 사용에는 영향을 주지 않는다.
  }
}

export function shouldPlayIntro(): boolean {
  return (
    typeof window !== "undefined" &&
    !reducedMotionRequested() &&
    !wasIntroSeen()
  );
}

export function IntroSequence({
  onReveal,
  onComplete,
}: {
  onReveal: () => void;
  onComplete: () => void;
}) {
  useEffect(() => {
    const revealTimer = window.setTimeout(onReveal, 2_200);
    const completeTimer = window.setTimeout(() => {
      rememberIntro();
      onComplete();
    }, 3_000);
    const motionPreference =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : undefined;
    const handleMotionChange = (event: MediaQueryListEvent): void => {
      if (event.matches) {
        skip();
      }
    };
    motionPreference?.addEventListener("change", handleMotionChange);
    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(completeTimer);
      motionPreference?.removeEventListener("change", handleMotionChange);
    };
  }, [onComplete, onReveal]);

  function skip(): void {
    rememberIntro();
    onReveal();
    onComplete();
  }

  return (
    <section
      className="intro-sequence"
      role="dialog"
      aria-modal="true"
      aria-label="CHIMap 시작 화면"
    >
      <svg
        className="intro-contours"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <path d="M-80 180C170 40 330 300 548 151S904-28 1150 122s132 330 374 225" />
        <path d="M-120 360c245-123 389 96 596 16s225-268 479-184 210 287 509 205" />
        <path d="M-90 650c207-221 425 33 625-91s313-47 467 92 279 13 518-96" />
        <path d="M142 970c-73-292 293-306 483-172s277 22 433-90 280-37 476 103" />
      </svg>

      <div className="intro-noise" aria-hidden="true" />
      <div className="intro-meta intro-meta-left" aria-hidden="true">
        <span>CHIMap / ROUTE 001</span>
        <span>36.3723° N · 127.3604° E</span>
      </div>
      <div className="intro-meta intro-meta-right" aria-hidden="true">
        <span>HEALTHY TRANSIT</span>
        <span>SEOUL · KST</span>
      </div>

      <div className="intro-center">
        <span className="intro-compass" aria-hidden="true">
          <Navigation />
        </span>
        <p className="intro-kicker">LOAD HEALTHY ROUTE</p>
        <h1 className="intro-wordmark" aria-label="CHIMap">
          <span>CHI</span>
          <span>MAP</span>
        </h1>
        <p className="intro-tagline">
          목적지는 그대로
          <span aria-hidden="true">/</span>
          가는 길은 더 건강하게
        </p>
      </div>

      <svg
        className="intro-route"
        viewBox="0 0 760 160"
        aria-hidden="true"
      >
        <path
          className="intro-route-shadow"
          d="M20 118C137 22 245 145 348 79S566 8 740 52"
        />
        <path
          className="intro-route-line"
          pathLength="1"
          d="M20 118C137 22 245 145 348 79S566 8 740 52"
        />
        <circle className="intro-route-origin" cx="20" cy="118" r="8" />
        <circle className="intro-route-destination" cx="740" cy="52" r="8" />
      </svg>

      <div className="intro-progress" aria-hidden="true">
        <span>출발 준비</span>
        <i>
          <b />
        </i>
        <span>100</span>
      </div>

      <button type="button" className="intro-skip" onClick={skip}>
        인트로 건너뛰기
        <span aria-hidden="true">↗</span>
      </button>
    </section>
  );
}
