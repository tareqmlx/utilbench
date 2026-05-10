export function Logo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 80 88"
      fill="currentColor"
      className={className}
      role="img"
      aria-label="Utilbench logo"
    >
      <path d="M0 0L0 62Q0 88 40 88Q80 88 80 62L80 0L58 0L58 58L42 32Q40 28 38 32L22 58L22 0Z" />
    </svg>
  );
}
