import type { RedeId } from "@/lib/opi/redes";

/** Ícones monocromáticos simplificados (currentColor). Sem cores de marca. */
export function RedeIcone({ rede, className = "h-6 w-6" }: { rede: RedeId; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (rede) {
    case "instagram":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.3" cy="6.7" r="0.6" fill="currentColor" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common}>
          <path d="M14 21v-7.5h2.6l.4-3H14V8.6c0-.9.3-1.6 1.6-1.6H17V4.3A19 19 0 0 0 14.9 4C12.8 4 11 5.3 11 7.9v2.6H8.5v3H11V21" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <path d="M10.2 9.2v5.6l4.8-2.8z" fill="currentColor" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common}>
          <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
          <path d="M14 3c.4 2.6 2.1 4.3 5 4.6" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M8 10.5V17M8 7.5v.01M11.5 17v-6.5M11.5 13.2c0-1.6 1-2.7 2.4-2.7s2.1 1 2.1 2.6V17" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M4 4l16 16M20 4L4 20" />
        </svg>
      );
    case "threads":
      return (
        <svg {...common}>
          <path d="M16.5 11.2c-.4-2.4-2-3.7-4.3-3.7-2.6 0-4.2 1.8-4.2 4.5 0 3 1.9 4.8 4.4 4.8 2 0 3.4-1.1 3.4-2.8 0-1.9-1.9-2.6-4-2.4-1.6.2-2.4 1-2.3 2" />
          <path d="M19.5 12c0 5-3 8.5-7.5 8.5S4.5 17 4.5 12 7.5 3.5 12 3.5c3.3 0 5.6 1.7 6.6 4.5" />
        </svg>
      );
    case "meta_ads":
      return (
        <svg {...common}>
          <path d="M3 15.5c0-4 2-8 4.3-8 3.2 0 5.7 9 9.2 9 2 0 3.5-1.5 3.5-4.3 0-2.9-1.6-4.7-3.4-4.7-3 0-5.3 9-9.3 9C4.9 16.5 3 16.4 3 15.5z" />
        </svg>
      );
    case "google_ads":
      return (
        <svg {...common}>
          <path d="M9.5 4.5l-6 10.5a3 3 0 1 0 5.2 3l6-10.5" />
          <path d="M14.5 4.5l6 10.5a3 3 0 1 1-5.2 3l-6-10.5a3 3 0 1 1 5.2-3z" />
        </svg>
      );
  }
}
