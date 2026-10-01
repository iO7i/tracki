import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, BackHandler, Linking, Platform } from "react-native";
import type { NativeBindings } from "./adapter";

/** Real React Native bindings. The native build typecheck uses installed peer
 *  types; the lightweight monorepo check also supports shims.d.ts. */
export function nativeBindings(): NativeBindings {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    throw new Error("Tracki native bindings require iOS or Android");
  }
  return {
    storage: {
      get: (k) => AsyncStorage.getItem(k),
      set: (k, v) => AsyncStorage.setItem(k, v),
      remove: (k) => AsyncStorage.removeItem(k),
    },
    platform: Platform.OS === "ios" ? "ios" : "android",
    osVersion: String(Platform.Version),
    appState: AppState.currentState === "active" ? "active" : "background",
    getInitialDeepLink: () => Linking.getInitialURL(),
    openUrl: (url) => {
      void Linking.openURL(url).catch(() => {});
    },
    onAppStateChange: (handler) => {
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") handler("active");
        else if (s === "background" || s === "inactive") handler("background");
      });
      return () => sub.remove();
    },
    onBackPress: (handler) => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        handler();
        return false; // observe only — never swallow the back press
      });
      return () => sub.remove();
    },
    // Audit-14 M2: this auto-wiring can only observe links that DID open the
    // app, so it reports ok=true. RN cannot see a failed resolution from here —
    // when your router fails to resolve a link, call `client.deepLink(url,
    // false)` yourself; that is what fires the `deep_link_failure` struggle.
    onDeepLink: (handler) => {
      const sub = Linking.addEventListener("url", (e) => handler(e.url));
      return () => sub.remove();
    },
  };
}
