interface GhostLogoProps {
  size?: number;
}

export function GhostLogo({ size = 32 }: GhostLogoProps) {
  return (
    <img
      src="/icons/icon128.png"
      alt="GhostLayer"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-[9px] border border-[#38BDF8]/40 object-cover shadow-[0_2px_12px_rgba(10,132,255,0.4)]"
    />
  );
}
