import {
  type DeviceInfo,
  type KeyValueStorage,
  type RenderIntent,
  type Renderer,
  type TrackiClient,
  type TrackiConfig,
  createTracki,
} from "@tracki/mobile-core";

/**
 * Platform seams, injected so the adapter is unit-testable without React
 * Native installed. `native.ts` provides the real implementations.
 */
export interface NativeBindings {
  storage: KeyValueStorage;
  platform: "ios" | "android";
  osVersion: string;
  openUrl: (url: string) => void;
  /** Subscribe to app active/background transitions; returns unsubscribe. */
  onAppStateChange?: (handler: (state: "active" | "background") => void) => () => void;
  /** Subscribe to hardware back presses (Android); returns unsubscribe. */
  onBackPress?: (handler: () => void) => () => void;
  /** Subscribe to incoming deep links; returns unsubscribe. */
  onDeepLink?: (handler: (url: string) => void) => () => void;
}

export interface ReactNativeTrackiOptions {
  key: string;
  endpoint: string;
  /** Your app's marketing version — drives revenue-by-app-version reporting. */
  appVersion?: string;
  locale?: "ar" | "en";
  renderer?: Renderer;
  transport?: TrackiConfig["transport"];
  clock?: TrackiConfig["clock"];
  idFactory?: TrackiConfig["idFactory"];
}

/**
 * Build a Tracki client wired to React Native: AsyncStorage persistence,
 * AppState foreground/background tracking, hardware-back tracking, deep-link
 * tracking, and Linking-based URL opening (wa.me handoffs, url CTAs).
 */
export async function createTrackiClient(
  options: ReactNativeTrackiOptions,
  native: NativeBindings,
): Promise<{ client: TrackiClient; dispose: () => void }> {
  const device: DeviceInfo = {
    platform: native.platform,
    osVersion: native.osVersion,
    appVersion: options.appVersion,
    sdk: "react-native",
  };

  const client = await createTracki({
    key: options.key,
    endpoint: options.endpoint,
    device,
    storage: native.storage,
    locale: options.locale,
    renderer: options.renderer,
    openUrl: native.openUrl,
    transport: options.transport,
    clock: options.clock,
    idFactory: options.idFactory,
  });

  const subs: Array<() => void> = [];
  if (native.onAppStateChange) {
    subs.push(
      native.onAppStateChange((state) => {
        if (state === "active") client.appForeground("warm");
        else if (state === "background") client.appBackground();
      }),
    );
  }
  if (native.onBackPress) {
    subs.push(native.onBackPress(() => client.backNav()));
  }
  if (native.onDeepLink) {
    subs.push(native.onDeepLink((url) => client.deepLink(url, true)));
  }

  return {
    client,
    dispose: () => {
      for (const off of subs) off();
    },
  };
}

/** A renderer that queues intents for React (the provider drains it). */
export function createIntentBus(): Renderer & {
  subscribe(listener: (intent: RenderIntent) => void): () => void;
} {
  const listeners = new Set<(intent: RenderIntent) => void>();
  const pending: RenderIntent[] = [];
  return {
    show(intent: RenderIntent) {
      if (listeners.size === 0) {
        pending.push(intent);
        return;
      }
      for (const l of listeners) l(intent);
    },
    subscribe(listener) {
      listeners.add(listener);
      while (pending.length > 0) {
        const i = pending.shift();
        if (i) listener(i);
      }
      return () => listeners.delete(listener);
    },
  };
}
