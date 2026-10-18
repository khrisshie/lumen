export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-serif text-[1.15rem] font-semibold tracking-tight text-ink">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="var(--accent)" />
        <path d="M12 2a10 10 0 0 0 0 20c-3.2-2.3-5-6-5-10s1.8-7.7 5-10Z" fill="#fff" opacity="0.9" />
      </svg>
      Lumen
    </span>
  );
}
