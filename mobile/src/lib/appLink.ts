/**
 * How a login is tied to a native Android app rather than a website: the
 * `androidapp://<package>` form other password managers use, so a login saved
 * from an app (or imported from one of them) lines up with it. Only ever
 * compared for equality with the *actual* requesting package, which the OS
 * reports -- an app cannot claim another's.
 */
export function appUrl(packageName: string): string {
  return packageName.trim() === '' ? '' : `androidapp://${packageName.trim()}`;
}

export function matchesApp(itemUrl: string, packageName: string): boolean {
  const wanted = appUrl(packageName).toLowerCase();
  return wanted !== '' && itemUrl.trim().toLowerCase() === wanted;
}
