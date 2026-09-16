type IconName =
  | "upload"
  | "arrow"
  | "copy"
  | "check"
  | "lock"
  | "unlock"
  | "download"
  | "link"
  | "image"
  | "cube"
  | "contrast"
  | "code"
  | "refresh"
  | "close"
  | "shield"
  | "swap";
const paths: Record<IconName, string> = {
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  copy: "M9 9h11v11H9zM15 9V4H4v11h5",
  check: "m5 12 4 4L19 6",
  lock: "M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3",
  unlock: "M6 10h12v10H6zM8 10V7a4 4 0 0 1 7-2",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4",
  link: "m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  image: "M3 3h18v18H3zM3 17l6-6 5 5 3-3 4 4M15 7h.01",
  cube: "m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10L3 7m9 5 9-5m-9 5v10",
  contrast: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18",
  refresh:
    "M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-1l1 6M4 12l1 6a8 8 0 0 0 14-1",
  close: "m6 6 12 12M6 18 18 6",
  shield: "m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5l8-3Zm-4 9 3 3 5-6",
  swap: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4",
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
