"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function useChatScroll(open: boolean, characterId: string, ready: boolean, messages: unknown, partial: string) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const [showLatest, setShowLatest] = useState(false);

  const goLatest = useCallback(() => {
    const area = scrollRef.current;
    pinned.current = true;
    setShowLatest(false);
    if (area) area.scrollTo({ top: area.scrollHeight, behavior: "instant" });
  }, []);

  const onScroll = useCallback(() => {
    const area = scrollRef.current;
    if (!area) return;
    const away = area.scrollHeight - area.scrollTop - area.clientHeight > 96;
    pinned.current = !away;
    setShowLatest(away);
  }, []);

  // Run again even when reopening the same room with unchanged messages.
  // The ready transition also covers asynchronous history hydration.
  useLayoutEffect(() => { goLatest(); }, [open, characterId, ready, goLatest]);
  useLayoutEffect(() => {
    if (!open) return;
    if (pinned.current) goLatest();
    const area = scrollRef.current;
    const content = contentRef.current;
    if (!area || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Photos, keyboard and viewport resizing must not dislodge a bottom-pinned chat.
      if (pinned.current) goLatest();
      else onScroll();
    });
    observer.observe(area);
    observer.observe(content);
    return () => observer.disconnect();
  }, [open, characterId, goLatest, onScroll]);
  useLayoutEffect(() => {
    if (open && pinned.current) goLatest();
  }, [open, messages, partial, goLatest]);

  return { scrollRef, contentRef, showLatest, goLatest, onScroll };
}
