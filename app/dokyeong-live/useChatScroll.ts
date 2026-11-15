"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function useChatScroll(open: boolean, characterId: string, ready: boolean, messages: unknown, partial: string) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const [position, setPosition] = useState({ open, characterId, ready, away: false });
  const sameView = position.open === open && position.characterId === characterId && position.ready === ready;
  if (!sameView) setPosition({ open, characterId, ready, away: false });

  const scrollToLatest = useCallback(() => {
    const area = scrollRef.current;
    pinned.current = true;
    if (area) area.scrollTo({ top: area.scrollHeight, behavior: "instant" });
  }, []);

  const goLatest = useCallback(() => {
    scrollToLatest();
    setPosition({ open, characterId, ready, away: false });
  }, [scrollToLatest, open, characterId, ready]);

  const onScroll = useCallback(() => {
    const area = scrollRef.current;
    if (!area) return;
    const away = area.scrollHeight - area.scrollTop - area.clientHeight > 96;
    if (pinned.current === !away) return;
    pinned.current = !away;
    setPosition({ open, characterId, ready, away });
  }, [open, characterId, ready]);

  // Run again even when reopening the same room with unchanged messages.
  // The ready transition also covers asynchronous history hydration.
  useLayoutEffect(() => { scrollToLatest(); }, [open, characterId, ready, scrollToLatest]);
  useLayoutEffect(() => {
    if (!open) return;
    const area = scrollRef.current;
    const content = contentRef.current;
    if (!area || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Photos, keyboard and viewport resizing must not dislodge a bottom-pinned chat.
      if (pinned.current) scrollToLatest();
      else onScroll();
    });
    observer.observe(area);
    observer.observe(content);
    return () => observer.disconnect();
  }, [open, characterId, scrollToLatest, onScroll]);
  useLayoutEffect(() => {
    if (open && pinned.current) scrollToLatest();
  }, [open, messages, partial, scrollToLatest]);

  return { scrollRef, contentRef, showLatest: open && sameView && position.away, goLatest, onScroll };
}
