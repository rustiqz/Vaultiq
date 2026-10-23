import { useIsFocused } from '@react-navigation/native';
import { useEffect } from 'react';
import { onRemoteChange } from './lib/remoteChange';

/**
 * Re-reads whatever this screen shows when another device's changes arrive.
 *
 * Only while the screen is the one in front: a screen buried under another
 * already refreshes itself when it is returned to, so doing it early would be
 * work nobody sees.
 */
export default function useRefreshOnRemoteChange(refresh: () => void): void {
  const focused = useIsFocused();
  useEffect(() => (focused ? onRemoteChange(refresh) : undefined), [focused, refresh]);
}
