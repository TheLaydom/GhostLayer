interface GhostLogoProps {
  size?: number;
}

/**
 * Custom iOS-squircle GhostLayer emblem: deep obsidian glass, electric cobalt
 * rim & visor, icy-white halftone-lined phantom mark.
 */
export function GhostLogo({ size = 32 }: GhostLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0 drop-shadow-[0_2px_10px_rgba(10,132,255,0.35)]"
    >
      <defs>
        <linearGradient id="gl-bg" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#122B5C" />
          <stop offset="48%" stopColor="#0A1020" />
          <stop offset="100%" stopColor="#05070C" />
        </linearGradient>
        <linearGradient id="gl-rim" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#0A84FF" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="gl-visor" x1="20" y1="29" x2="44" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="50%" stopColor="#0A84FF" />
          <stop offset="100%" stopColor="#60A5FA" />
        </linearGradient>
      </defs>

      {/* iOS squircle base */}
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#gl-bg)" stroke="url(#gl-rim)" strokeWidth="1.5" />

      {/* Subtle top-left glass specular highlight */}
      <ellipse cx="22" cy="14" rx="14" ry="6" fill="#38BDF8" fillOpacity="0.14" />

      {/* Layered phantom silhouette */}
      <path
        d="M32 14C22.6 14 16 20.8 16 30V47.5C16 48.6 17.3 49.2 18.2 48.5L22.5 45.2C23.2 44.6 24.2 44.6 24.9 45.2L29.1 48.5C30.8 49.8 33.2 49.8 34.9 48.5L39.1 45.2C39.8 44.6 40.8 44.6 41.5 45.2L45.8 48.5C46.7 49.2 48 48.6 48 47.5V30C48 20.8 41.4 14 32 14Z"
        fill="#F4F8FF"
      />

      {/* Electric cobalt privacy visor */}
      <rect x="21" y="25.5" width="22" height="7" rx="3.5" fill="url(#gl-visor)" />
      <rect x="24" y="27.5" width="7" height="2" rx="1" fill="#E0F2FE" fillOpacity="0.85" />
    </svg>
  );
}
