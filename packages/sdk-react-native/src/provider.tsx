import type { RenderIntent, TrackiClient } from "@tracki/mobile-core";
import {
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type NativeBindings,
  type ReactNativeTrackiOptions,
  createIntentBus,
  createTrackiClient,
} from "./adapter";

/**
 * Headless React layer: TrackiProvider owns the client; useTracki() exposes
 * the tracking API; useTrackiIntent() surfaces the current render intent
 * (action/assist/faq/chat) for the app to draw with its own design system —
 * native UI stays fully in the host app's hands (and fully RTL-correct).
 */

interface TrackiContextValue {
  client: TrackiClient | null;
  intent: RenderIntent | null;
  clearIntent: () => void;
}

const TrackiContext = createContext<TrackiContextValue>({
  client: null,
  intent: null,
  clearIntent: () => {},
});

export interface TrackiProviderProps {
  options: ReactNativeTrackiOptions;
  /** Inject platform bindings (the app passes `nativeBindings()` from ./native). */
  bindings: NativeBindings;
  children?: ReactNode;
}

export function TrackiProvider({ options, bindings, children }: TrackiProviderProps) {
  const [client, setClient] = useState<TrackiClient | null>(null);
  const [intent, setIntent] = useState<RenderIntent | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  // The client is created exactly once for the provider's lifetime —
  // re-creating it on options identity changes would reset queue/session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional once-only init
  useEffect(() => {
    const bus = createIntentBus();
    const offBus = bus.subscribe(setIntent);
    let cancelled = false;
    void createTrackiClient({ ...options, renderer: bus }, bindings).then(
      ({ client: c, dispose }) => {
        if (cancelled) {
          dispose();
          return;
        }
        disposeRef.current = dispose;
        setClient(c);
      },
    );
    return () => {
      cancelled = true;
      offBus();
      disposeRef.current?.();
      disposeRef.current = null;
    };
  }, []);

  return createElement(
    TrackiContext.Provider,
    { value: { client, intent, clearIntent: () => setIntent(null) } },
    children,
  );
}

/** The Tracki tracking API (null until the client hydrates — calls are cheap to guard). */
export function useTracki(): TrackiClient | null {
  return useContext(TrackiContext).client;
}

/** The pending render intent + a clear function, for the app's own UI. */
export function useTrackiIntent(): { intent: RenderIntent | null; clear: () => void } {
  const { intent, clearIntent } = useContext(TrackiContext);
  return { intent, clear: clearIntent };
}

/** Render-prop convenience: draw the current intent anywhere in the tree. */
export function TrackiSurface({
  render,
}: {
  render: (intent: RenderIntent, clear: () => void) => ReactNode;
}) {
  const { intent, clear } = useTrackiIntent();
  if (!intent) return null;
  return createElement((() => render(intent, clear)) as unknown as React.FunctionComponent, null);
}
