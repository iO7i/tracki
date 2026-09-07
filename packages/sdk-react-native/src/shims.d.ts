/**
 * Minimal ambient declarations for the React Native peer dependencies — just
 * the surface this adapter touches. The host app's real react-native types
 * take precedence in consuming projects; these only keep the monorepo
 * typecheck green without installing React Native itself.
 */

declare module "react-native" {
  export const Platform: {
    OS: "ios" | "android" | string;
    Version: string | number;
  };
  export type AppStateStatus = "active" | "background" | "inactive" | string;
  export const AppState: {
    currentState: AppStateStatus;
    addEventListener(type: "change", handler: (state: AppStateStatus) => void): { remove(): void };
  };
  export const Linking: {
    openURL(url: string): Promise<unknown>;
    getInitialURL(): Promise<string | null>;
    addEventListener(type: "url", handler: (e: { url: string }) => void): { remove(): void };
  };
  export const BackHandler: {
    addEventListener(type: "hardwareBackPress", handler: () => boolean): { remove(): void };
  };
}

declare module "@react-native-async-storage/async-storage" {
  const AsyncStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
  };
  export default AsyncStorage;
}
