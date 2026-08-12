import { useEffect } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { syncQueuedSubmissions } from "./sync";

/** Triggers a best-effort sync of queued offline submissions on mount, reconnect, and app foreground. */
export function useJobRecordSync(): void {
  useEffect(() => {
    void syncQueuedSubmissions();

    const netInfoSubscription = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        void syncQueuedSubmissions();
      }
    });

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void syncQueuedSubmissions();
      }
    });

    return () => {
      netInfoSubscription();
      appStateSubscription.remove();
    };
  }, []);
}
