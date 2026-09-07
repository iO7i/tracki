import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, BackHandler, Linking, Platform } from "react-native";
import type { NativeBindings } from "./adapter";

/** Real React Native bindings (typechecked against shims.d.ts in-repo; the
 *  host app's actual react-native types apply when consumed). */
export function nativeBindings(): NativeBindings {
  return {
    storage: {
      get: (k) => AsyncStorage.getItem(k),
      set: (k, v) => AsyncStorage.setItem(k, v),
    },
    platform: Platform.OS === "ios" ? "ios" : "android",
    osVersion: String(Platform.Version),
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
