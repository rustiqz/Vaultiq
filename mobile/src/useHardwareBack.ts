import {useEffect, useRef} from 'react';
import {BackHandler} from 'react-native';

/** Registers the latest handler while mounted; true consumes Android Back. */
export function useHardwareBack(handler: () => boolean): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => handlerRef.current());
    return () => sub.remove();
  }, []);
}
