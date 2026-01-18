export function SpinnerIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-25"
      />
      <path
        d="M12 2A10 10 0 0 1 22 12"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-100"
      />
    </svg>
  );
}
