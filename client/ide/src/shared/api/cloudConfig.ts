/** Desktop runtime configuration wins over Vite's build-time defaults. */
export const cloudConfig: ColorideCloudConfig =
  (typeof window !== "undefined" ? window.colorideDesktop?.cloudConfig : undefined)
  ?? (typeof __COLORIDE_CLOUD_CONFIG__ !== "undefined" ? __COLORIDE_CLOUD_CONFIG__ : {
    enabled: false, appBase: "", apiBase: "",
  });

export function requireCloudEnabled(): void {
  if (!cloudConfig.enabled) throw new Error("Cloud services are disabled in this distribution.");
}
