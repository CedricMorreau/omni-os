import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

/** For code outside a screen: the notification handler asks what is on screen, and a tap opens a route. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** The thread the person is looking at, or null on any other screen. */
export function threadOnScreen(): string | null {
  if (!navigationRef.isReady()) return null;
  const route = navigationRef.getCurrentRoute();
  const id = (route?.params as { id?: unknown } | undefined)?.id;
  return route?.name === 'Thread' && typeof id === 'string' ? id : null;
}

/** The session screens are mounted: the navigator is up and not showing Connect alone. */
export function sessionNavigatorReady(): boolean {
  return navigationRef.isReady() && (navigationRef.getRootState()?.routeNames ?? []).includes('Thread');
}
