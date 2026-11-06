// While a list loads, each row's plate is loose sand that hasn't found its
// figure yet. When the data lands the real rows take their place, and their
// plates settle out of the same loose sand (Plate.tsx, landedAt).
import { Plate } from "./Plate";

export function LooseRows({ count = 3, size = 18, label = "Loading…" }: { count?: number; size?: number; label?: string }) {
  return (
    <ul className="loose-rows" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="loose-row">
          <Plate seed={`loading-${i}`} work={i} tone="sand" size={size} loose />
          <span className="loose-label">{i === 0 ? label : ""}</span>
        </li>
      ))}
    </ul>
  );
}
