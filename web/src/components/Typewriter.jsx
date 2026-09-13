import { useEffect, useRef, useState } from 'react';

/**
 * Types a line of text out one character at a time, then holds it.
 *
 * The full text is always present for screen readers and for anyone who has
 * asked for reduced motion; only the visible characters are animated. The
 * element also reserves its final height from the first paint, so the page
 * does not reflow while the line grows.
 */
export function Typewriter({
  text = '',
  speed = 55,
  startDelay = 350,
  className = '',
  as: Tag = 'span',
}) {
  const full = String(text);
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const [shown, setShown] = useState(reduced ? full.length : 0);
  const timer = useRef(null);

  useEffect(() => {
    if (reduced) {
      setShown(full.length);
      return undefined;
    }

    setShown(0);
    let i = 0;
    const tick = () => {
      i += 1;
      setShown(i);
      if (i < full.length) timer.current = setTimeout(tick, speed);
    };
    timer.current = setTimeout(tick, startDelay);

    return () => clearTimeout(timer.current);
  }, [full, speed, startDelay, reduced]);

  const done = shown >= full.length;

  return (
    <Tag className={`typewriter ${className}`.trim()}>
      {/* The finished line, invisible but laid out, so the box never grows. */}
      <span className="typewriter-ghost" aria-hidden="true">
        {full}
      </span>
      <span className="typewriter-live" aria-hidden="true">
        {full.slice(0, shown)}
        {!reduced && <span className={`typewriter-caret ${done ? 'blink' : ''}`} />}
      </span>
      <span className="sr-only">{full}</span>
    </Tag>
  );
}
