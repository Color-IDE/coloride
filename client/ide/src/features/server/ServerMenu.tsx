export type ServerSubTab = 'health' | 'processes' | 'services' | 'ports' | 'logs' | 'settings';

interface ServerMenuProps {
  serverSubTab: ServerSubTab;
  onChange: (tab: ServerSubTab) => void;
}

const menuGroups: { id: string; label: string; items: { label: string; key: ServerSubTab }[] }[] = [
  {
    id: "monitoring",
    label: "Monitoring",
    items: [
      { label: 'Health', key: 'health' },
      { label: 'Processes', key: 'processes' },
      { label: 'Services', key: 'services' },
      { label: 'Ports', key: 'ports' },
      { label: 'Logs', key: 'logs' },
    ],
  },
  {
    id: "management",
    label: "Management",
    items: [{ label: 'Settings', key: 'settings' }],
  },
];

export function ServerMenu({ serverSubTab, onChange }: ServerMenuProps) {
  return (
    <div className="server-menu app-side-surface flex h-full min-h-0 flex-col overflow-hidden bg-[#212121] px-2 pb-2 pt-4 text-sm">
      <div className="server-menu-scroll min-h-0 flex-1 overflow-y-auto pr-0.5">
        {menuGroups.map((group, groupIndex) => (
          <section className={groupIndex === 0 ? "pb-3" : "py-3"} key={group.id}>
            <h2 className="server-menu-heading mb-1 px-2 text-xs font-medium text-[#77777c]">{group.label}</h2>
            {group.items.map(({ label, key }) => {
              const isActive = serverSubTab === key;
              return (
                <button
                  key={key}
                  onClick={() => onChange(key)}
                  className={`server-menu-item group mb-0.5 flex h-7 w-full items-center gap-2 rounded-lg px-2 text-[13px] transition-colors ${
                    isActive ? 'bg-[#333333]' : 'hover:bg-[#2a2a2a]'
                  }`}
                  data-active={isActive}
                >
            <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center transition-colors [&_svg]:h-4 [&_svg]:w-4 ${
              isActive ? 'text-[#f0f4f8]' : 'text-[#878888] group-hover:text-[#f0f4f8]'
            }`}>
              {key === 'health' && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.31802 19.682C3 18.364 3 16.2426 3 12C3 7.75736 3 5.63604 4.31802 4.31802C5.63604 3 7.75736 3 12 3C16.2426 3 18.364 3 19.682 4.31802C21 5.63604 21 7.75736 21 12C21 16.2426 21 18.364 19.682 19.682C18.364 21 16.2426 21 12 21C7.75736 21 5.63604 21 4.31802 19.682Z"></path>
                  <path d="M6 12H8.5L10.5 8L13.5 16L15.5 12H18"></path>
                </svg>
              )}
              {key === 'processes' && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                  <path d="M9.5 2V4" strokeLinecap="round"></path>
                  <path d="M14.5 2V4" strokeLinecap="round"></path>
                  <path d="M9.5 20V22" strokeLinecap="round"></path>
                  <path d="M14.5 20V22" strokeLinecap="round"></path>
                  <path d="M22 14.5L20 14.5" strokeLinecap="round"></path>
                  <path d="M4 9.5L2 9.5" strokeLinecap="round"></path>
                  <path d="M4 14.5L2 14.5" strokeLinecap="round"></path>
                  <path d="M22 9.5L20 9.5" strokeLinecap="round"></path>
                  <path d="M12.6939 8.5L10.6029 11.0373C10.3788 11.3092 10.5394 11.7005 10.9048 11.7729L13.0952 12.2068C13.4848 12.284 13.6334 12.7171 13.361 12.9815L10.7666 15.5" strokeLinecap="round"></path>
                  <path d="M4 12C4 8.22876 4 6.34315 5.17157 5.17157C6.34315 4 8.22876 4 12 4C15.7712 4 17.6569 4 18.8284 5.17157C20 6.34315 20 8.22876 20 12C20 15.7712 20 17.6569 18.8284 18.8284C17.6569 20 15.7712 20 12 20C8.22876 20 6.34315 20 5.17157 18.8284C4 17.6569 4 15.7712 4 12Z"></path>
                </svg>
              )}
              {key === 'services' && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15.365 9.72752C15.8998 10 16.5999 10 18 10C19.4001 10 20.1002 10 20.635 9.72752C21.1054 9.48783 21.4878 9.10538 21.7275 8.63498C22 8.1002 22 7.40013 22 6C22 4.59987 22 3.8998 21.7275 3.36502C21.4878 2.89462 21.1054 2.51217 20.635 2.27248C20.1002 2 19.4001 2 18 2C16.5999 2 15.8998 2 15.365 2.27248C14.8946 2.51217 14.5122 2.89462 14.2725 3.36502C14 3.8998 14 4.59987 14 6C14 7.40013 14 8.1002 14.2725 8.63498C14.5122 9.10538 14.8946 9.48783 15.365 9.72752Z"></path>
                  <path d="M10 14V10C10 8.59987 10 7.8998 9.72752 7.36502C9.48783 6.89462 9.10538 6.51217 8.63498 6.27248C8.1002 6 7.40013 6 6 6C4.59987 6 3.8998 6 3.36502 6.27248C2.89462 6.51217 2.51217 6.89462 2.27248 7.36502C2 7.8998 2 8.59987 2 10V14H10Z"></path>
                  <path d="M10 14H2V17C2 19.357 2 20.5355 2.73223 21.2678C3.46447 22 4.64298 22 7 22H10V14Z"></path>
                  <path d="M14 14H10V22H14C15.4001 22 16.1002 22 16.635 21.7275C17.1054 21.4878 17.4878 21.1054 17.7275 20.635C18 20.1002 18 19.4001 18 18C18 16.5999 18 15.8998 17.7275 15.365C17.4878 14.8946 17.1054 14.5122 16.635 14.2725C16.1002 14 15.4001 14 14 14Z"></path>
                </svg>
              )}
              {key === 'ports' && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <ellipse cx="11" cy="5" rx="8" ry="3"></ellipse>
                  <path d="M6 10.8418C6.60158 11.0226 7.27434 11.1716 8 11.2817" strokeLinecap="round"></path>
                  <path d="M11 15C6.58172 15 3 13.6569 3 12" strokeLinecap="round"></path>
                  <path d="M6 17.8418C6.60158 18.0226 7.27434 18.1716 8 18.2817" strokeLinecap="round"></path>
                  <path d="M11 22C6.58172 22 3 20.6569 3 19V5M19 5V12" strokeLinecap="round" strokeLinejoin="round"></path>
                  <path d="M19 16.6735L17.8258 15.1869C17.2008 14.3956 16.8883 14 16.5 14C16.1117 14 15.7992 14.3956 15.1742 15.1869L14 16.6735M16.5 14.0872V22" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              )}
              {key === 'logs' && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M9.99609 4H20.9961"></path>
                  <path d="M9.99609 12H20.9961"></path>
                  <path d="M9.99609 20H20.9961"></path>
                  <path d="M2.99609 4.5L5.99609 7.5L2.99609 10.5" strokeLinejoin="round"></path>
                  <path d="M2.99609 13.5L5.99609 16.5L2.99609 19.5" strokeLinejoin="round"></path>
                </svg>
              )}
              {key === 'settings' && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M15.5 12C15.5 13.933 13.933 15.5 12 15.5C10.067 15.5 8.5 13.933 8.5 12C8.5 10.067 10.067 8.5 12 8.5C13.933 8.5 15.5 10.067 15.5 12Z" />
                  <path d="M20.7906 9.15201C21.5969 10.5418 22 11.2366 22 12C22 12.7634 21.5969 13.4582 20.7906 14.848L18.8669 18.1638C18.0638 19.548 17.6623 20.2402 17.0019 20.6201C16.3416 21 15.5402 21 13.9373 21L10.0627 21C8.45982 21 7.6584 21 6.99807 20.6201C6.33774 20.2402 5.93619 19.548 5.13311 18.1638L3.20942 14.848C2.40314 13.4582 2 12.7634 2 12C2 11.2366 2.40314 10.5418 3.20942 9.152L5.13311 5.83621C5.93619 4.45196 6.33774 3.75984 6.99807 3.37992C7.6584 3 8.45982 3 10.0627 3L13.9373 3C15.5402 3 16.3416 3 17.0019 3.37992C17.6623 3.75984 18.0638 4.45197 18.8669 5.83622L20.7906 9.15201Z" />
                </svg>
              )}
            </span>
            <span className={`transition-colors ${isActive ? 'text-[#f0f4f8]' : 'text-[#878888] group-hover:text-[#f0f4f8]'}`}>
              {label}
            </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

