/** QBBE mark — abstract gold/crimson petal motif + wordmark. */
export function QbbeLogo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg
        viewBox="0 0 40 40"
        className="size-9 shrink-0"
        role="img"
        aria-label="QBBE Hub"
      >
        <g transform="translate(20 20)">
          {[0, 60, 120, 180, 240, 300].map((angle, i) => (
            <ellipse
              key={angle}
              rx="5.2"
              ry="10.5"
              transform={`rotate(${angle}) translate(0 -8.5)`}
              fill={i % 2 === 0 ? "#C8A64D" : "#8F1538"}
              opacity={i % 2 === 0 ? 0.95 : 0.9}
            />
          ))}
          <circle r="4.5" fill="#651128" />
        </g>
      </svg>
      {!collapsed ? (
        <span className="leading-none">
          <span className="block text-[17px] font-bold tracking-[0.02em] text-white">
            QBBE
          </span>
          <span className="block text-[11px] font-semibold tracking-[0.28em] text-accent">
            HUB
          </span>
        </span>
      ) : null}
    </span>
  );
}
