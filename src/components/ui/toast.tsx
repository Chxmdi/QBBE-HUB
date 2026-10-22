"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";

type ToastTone = "success" | "warning" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  /** Errors never auto-dismiss — auto-dismiss only when safe (Part II §9). */
  sticky: boolean;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (
    message: string,
    options?: { tone?: ToastTone; action?: Toast["action"] },
  ) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

/**
 * Open modal dialogs and drawers, innermost last. A modal <dialog> sits in
 * the browser's top layer and makes the rest of the page inert, so toasts
 * drawn at the page level were hidden behind it and never announced. While
 * one is open the toast region is drawn inside it instead.
 */
interface ToastLayerValue {
  add: (element: HTMLElement) => void;
  remove: (element: HTMLElement) => void;
}

const ToastLayerContext = React.createContext<ToastLayerValue | null>(null);

/**
 * Called by Dialog and Drawer with their <dialog> while it is open. Outside a
 * ToastProvider (sign-in pages) it does nothing.
 */
export function useToastLayer(ref: React.RefObject<HTMLElement | null>, open: boolean) {
  const layer = React.useContext(ToastLayerContext);
  React.useEffect(() => {
    const element = ref.current;
    if (!layer || !open || !element) return;
    layer.add(element);
    return () => layer.remove(element);
  }, [layer, open, ref]);
}

/** Access the toast queue. Safe to call from any client component. */
export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}

const toneMeta: Record<
  ToastTone,
  { icon: React.ReactNode; classes: string; label: MessageKey }
> = {
  success: {
    icon: <CheckCircle2 className="size-4" aria-hidden />,
    classes: "border-success/30 text-success-fg",
    label: "ui.toast.success",
  },
  warning: {
    icon: <AlertTriangle className="size-4" aria-hidden />,
    classes: "border-warning/30 text-warning-fg",
    label: "ui.toast.warning",
  },
  error: {
    icon: <XCircle className="size-4" aria-hidden />,
    classes: "border-danger/30 text-danger-fg",
    label: "ui.toast.error",
  },
  info: {
    icon: <Info className="size-4" aria-hidden />,
    classes: "border-info/30 text-info-fg",
    label: "ui.toast.info",
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [layers, setLayers] = React.useState<HTMLElement[]>([]);
  const nextId = React.useRef(0);

  const layer = React.useMemo<ToastLayerValue>(
    () => ({
      add: (element) => setLayers((current) => [...current.filter((e) => e !== element), element]),
      remove: (element) => setLayers((current) => current.filter((e) => e !== element)),
    }),
    [],
  );
  const host = layers.at(-1) ?? null;

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue["toast"]>(
    (message, options) => {
      const tone = options?.tone ?? "success";
      const id = nextId.current++;
      // Errors stay until dismissed so a failure is never missed.
      const sticky = tone === "error";
      setToasts((current) => [
        ...current,
        { id, tone, message, sticky, action: options?.action },
      ]);
      if (!sticky) {
        setTimeout(() => dismiss(id), 5000);
      }
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toast }), [toast]);

  // Live region: assertive for errors, polite otherwise. Inside the open
  // dialog when there is one, so it is on top and not inert.
  const region = (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-(--z-toast) flex flex-col items-center gap-2 p-4 sm:items-end"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((item) => {
        const meta = toneMeta[item.tone];
        return (
          <div
            key={item.id}
            role={item.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-(--radius-md) border bg-surface px-3.5 py-3 shadow-(--shadow-pop)",
              "motion-safe:animate-[toast-in_160ms_var(--ease-app)]",
              meta.classes,
            )}
          >
            <span className="mt-0.5 shrink-0">{meta.icon}</span>
            <div className="min-w-0 flex-1">
              <span className="sr-only">{t(meta.label)}: </span>
              <p className="text-[13.5px] text-ink">{item.message}</p>
              {item.action ? (
                <button
                  type="button"
                  onClick={() => {
                    item.action!.onClick();
                    dismiss(item.id);
                  }}
                  className="mt-1 text-[12.5px] font-medium text-brand-fg hover:underline"
                >
                  {item.action.label}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label={t("ui.toast.dismiss")}
              className="shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-surface-soft hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastLayerContext.Provider value={layer}>
        {children}
        {host ? createPortal(region, host) : region}
      </ToastLayerContext.Provider>
    </ToastContext.Provider>
  );
}
