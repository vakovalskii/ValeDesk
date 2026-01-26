import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerEvent, ClientEvent } from "../types";
import { getPlatform } from "../platform";

export function useIPC(onEvent: (event: ServerEvent) => void) {
  const [connected, setConnected] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const platform = getPlatform();
    // Subscribe to server events
    const unsubscribe = platform.onServerEvent((event: ServerEvent) => {
      onEvent(event);
    });
    
    unsubscribeRef.current = unsubscribe;
    setConnected(true);

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      setConnected(false);
    };
  }, [onEvent]);

  const sendEvent = useCallback((event: ClientEvent) => {
    getPlatform().sendClientEvent(event);
  }, []);

  return { connected, sendEvent };
}
