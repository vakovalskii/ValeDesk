import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerEvent, ClientEvent } from "../types";
import { getPlatform } from "../platform";

export function useIPC(onEvent: (event: ServerEvent) => void) {
  const [connected, setConnected] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const platform = getPlatform();
    const unsubscribe = platform.onServerEvent(
      (event: ServerEvent) => {
        onEventRef.current(event);
      },
      () => {
        setConnected(true);
      }
    );

    unsubscribeRef.current = unsubscribe;

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      setConnected(false);
    };
  }, []);

  const sendEvent = useCallback((event: ClientEvent) => {
    getPlatform().sendClientEvent(event);
  }, []);

  return { connected, sendEvent };
}
