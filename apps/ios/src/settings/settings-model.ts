/** The route the push notification preferences screen registers. It lands in a separate change, so Settings looks for it. */
export const NOTIFICATIONS_ROUTE = 'NotificationSettings';

/** The Notifications route when this stack has it, else null and the row stays inert. */
export function notificationsRoute(routeNames: readonly string[]): typeof NOTIFICATIONS_ROUTE | null {
  return routeNames.includes(NOTIFICATIONS_ROUTE) ? NOTIFICATIONS_ROUTE : null;
}

/** The line under the Automations row: how many the server has, or why that is not known yet. */
export function automationsDetail(count: number | null, error: string | null, serverName: string | null): string {
  if (count === null) return error ? 'Could not load' : 'Loading';
  if (count === 0) return 'None yet';
  return serverName ? `${count} on ${serverName}` : String(count);
}

/** The footer text. The build number is left out when the app has none. */
export function versionLabel(version: string | null | undefined, build: string | null | undefined): string {
  if (!version) return 'Omni OS';
  return build ? `Omni OS ${version} (${build})` : `Omni OS ${version}`;
}
