import type { ReactNode } from "react";

const S = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

export const Icon = {
  overview: () => <S><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></S>,
  projects: () => <S><path d="M3 7l9-4 9 4-9 4-9-4Z" /><path d="M3 12l9 4 9-4M3 17l9 4 9-4" /></S>,
  review: () => <S><path d="M20 6L9 17l-5-5" /></S>,
  library: () => <S><path d="M4 5v14M8 5v14" /><rect x="12" y="4" width="8" height="16" rx="1.5" /></S>,
  users: () => <S><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5M18 20a6 6 0 0 0-3-5" /></S>,
  settings: () => <S><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></S>,
  pursuit: () => <S><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>,
  docs: () => <S><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></S>,
  runs: () => <S><path d="M5 3l14 9-14 9V3Z" /></S>,
  graph: () => <S><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="12" cy="18" r="2.4" /><path d="M7.5 7.5l3.2 8.4M16.5 7.5l-3.2 8.4M8 6h8" /></S>,
  colleagues: () => <S><rect x="4" y="8" width="16" height="11" rx="2.5" /><path d="M9 8V6a3 3 0 0 1 6 0v2M9.5 13v.01M14.5 13v.01" /></S>,
  trace: () => <S><path d="M12 3l8 4v5c0 4.5-3.2 7.5-8 9-4.8-1.5-8-4.5-8-9V7l8-4Z" /><path d="M9 12l2 2 4-4" /></S>,
  upload: () => <S><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></S>,
  add: () => <S><path d="M12 5v14M5 12h14" /></S>,
  chevron: () => <S><path d="M9 6l6 6-6 6" /></S>,
  copilot: () => <S><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1 0 8 4 4 0 0 1-8 0 4 4 0 0 1 0-8V6a4 4 0 0 1 4-4Z" /></S>,
  search: () => <S><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></S>,
  bell: () => <S><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></S>,
  admin: () => <S><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a5 5 0 0 1 10 0v1" /><path d="M16 3.1a3 3 0 0 1 0 5.8M21 20v-1a5 5 0 0 0-3.5-4.8" /></S>,
  arrow: () => <S><path d="M5 12h14M13 6l6 6-6 6" /></S>,
  globe: () => <S><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" /></S>,
  alert: () => <S><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></S>,
  clock: () => <S><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></S>,
  // chain-stage glyphs
  tender: () => <S><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></S>,
  drawings: () => <S><path d="M4 4h16v16H4Z" /><path d="M4 10h16M10 4v16" /></S>,
  specs: () => <S><path d="M4 4h16v16H4Z" /><path d="M8 9h8M8 13h8M8 17h5" /></S>,
  boq: () => <S><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></S>,
  estimate: () => <S><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></S>,
  schedule: () => <S><path d="M3 5h18M3 10h12M3 15h16M3 20h9" /></S>,
  procurement: () => <S><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18M16 10a4 4 0 0 1-8 0" /></S>,
};

export type IconName = keyof typeof Icon;
