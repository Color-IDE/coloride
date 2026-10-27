import { useEffect, useState, type ReactNode } from "react";
import aboutIconUrl from "../../../../desktop/resources/icon.png";
import { SettingsGroup, SettingsRow } from "./SettingsControls";

const links: Array<{ label: string; url: string }> = [];

export function AboutSettings() {
  const [appInfo, setAppInfo] = useState<ColorideAppInfo | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.colorideDesktop
      ?.getAppInfo?.()
      .then((info) => {
        if (active) setAppInfo(info);
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, []);

  const openLink = async (url: string) => {
    setLinkError(null);
    try {
      if (window.colorideDesktop?.openExternal) {
        await window.colorideDesktop.openExternal(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="settings-about mt-6 pb-8">
      <div className="about-product mb-7 flex items-center gap-4">
        <img
          className="about-mark block size-12 shrink-0 object-contain"
          src={aboutIconUrl}
          alt="Coloride"
          width={48}
          height={48}
        />
        <div>
          <div className="about-product-name text-lg font-semibold text-[#f2f2f3]">
            Coloride
          </div>
          <p className="about-product-copy mt-0.5 text-xs leading-5 text-[#85858a]">
            A focused desktop workspace for operating and developing on your
            VPS.
          </p>
        </div>
      </div>

      <SettingsGroup title="Application">
        <SettingsRow
          description="The version of Coloride currently installed on this device."
          label="Version"
        >
          <AboutValue>
            {appInfo && !/^v?43\./.test(appInfo.version)
              ? appInfo.version
              : appInfo
                ? "0.1.27"
                : "Unavailable"}
          </AboutValue>
        </SettingsRow>
        <SettingsRow
          description="Whether this is a packaged release or a development session."
          label="Build"
        >
          <AboutValue>
            {appInfo
              ? appInfo.packaged
                ? "Production"
                : "Development"
              : "Unavailable"}
          </AboutValue>
        </SettingsRow>
        <SettingsRow
          description="The target operating system and processor architecture."
          label="Platform"
        >
          <AboutValue>
            {appInfo
              ? `${formatPlatform(appInfo.platform)} · ${appInfo.arch}`
              : "Unavailable"}
          </AboutValue>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Resources">
        {links.map((link) => (
          <SettingsRow
            description={link.url.replace(/^https:\/\//, "").replace(/\/$/, "")}
            key={link.url}
            label={link.label}
          >
            <button
              className="settings-action-button h-7 rounded-lg bg-[#2c2c2c] px-2.5 text-xs font-medium text-[#d0d0d3] transition-colors hover:bg-[#353535] hover:text-white"
              onClick={() => void openLink(link.url)}
              type="button"
            >
              Open
            </button>
          </SettingsRow>
        ))}
        {linkError && (
          <p className="about-link-error pb-2 text-right text-xs text-[#e69a9f]">
            {linkError}
          </p>
        )}
      </SettingsGroup>

      <SettingsGroup title="Legal">
        <SettingsRow
          description="Product name and software distributed by Coloride."
          label="Copyright"
        >
          <AboutValue>Copyright {new Date().getFullYear()} Coloride</AboutValue>
        </SettingsRow>
        <SettingsRow
          description="Runtime components and third-party packages retain their respective licenses."
          label="Third-party software"
        >
          <AboutValue>License notices apply</AboutValue>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

function AboutValue({ children }: { children: ReactNode }) {
  return (
    <span className="about-value text-right text-xs font-medium text-[#d8d8db]">
      {children}
    </span>
  );
}

function formatPlatform(platform: string) {
  return (
    (
      { darwin: "macOS", linux: "Linux", win32: "Windows" } as Record<
        string,
        string
      >
    )[platform] ?? platform
  );
}
