import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

const SHOW_DELAY_MS = 300;
const HIDE_DELAY_MS = 100;

interface InfoTooltipProps {
  content: string;
  /** Wrapper span class (e.g. "ml-1.5 inline-flex align-middle") */
  className?: string;
  /** Info icon class (default: "h-3.5 w-3.5 text-gray-400 cursor-help") */
  iconClassName?: string;
}

/**
 * Cross-platform tooltip for (i) info icons. Uses hover + focus and a portal-rendered
 * tooltip so it works reliably on Windows, macOS, and touch devices (focus on tap).
 * Native HTML title is not used because it is inconsistent across OS/browsers.
 */
export default function InfoTooltip({
  content,
  className = "inline-flex align-middle",
  iconClassName = "h-3.5 w-3.5 text-gray-400 cursor-help",
}: InfoTooltipProps) {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    }
  }, []);

  const scheduleShow = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    showTimeoutRef.current = setTimeout(() => {
      showTimeoutRef.current = null;
      updatePosition();
      setShow(true);
    }, SHOW_DELAY_MS);
  }, [updatePosition]);

  const scheduleHide = useCallback(() => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    hideTimeoutRef.current = setTimeout(() => {
      hideTimeoutRef.current = null;
      setShow(false);
    }, HIDE_DELAY_MS);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        onMouseEnter={() => {
          cancelHide();
          scheduleShow();
        }}
        onMouseLeave={scheduleHide}
        onFocus={() => {
          cancelHide();
          scheduleShow();
        }}
        onBlur={scheduleHide}
        tabIndex={0}
        role="img"
        aria-label={content}
      >
        <Info className={iconClassName} aria-hidden />
      </span>
      {show &&
        createPortal(
          <div
            className="fixed z-[9999] px-3 py-2 text-sm text-white bg-gray-900 rounded-lg shadow-lg max-w-xs text-left pointer-events-none"
            style={{
              left: position.x,
              top: position.y - 8,
              transform: "translate(-50%, -100%)",
            }}
            role="tooltip"
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
