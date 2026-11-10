import { memo, useMemo, type CSSProperties } from "react";
import { FACE, faceRows, inkOn, petTint, solidTint, type FaceFrame, type LeadPet } from "../nebula/leadChat";
import { coatFor, framePaths, type Px } from "../vendor/pixel-pets/frames.ts";
import { paletteOf } from "./Pet";

// A lead's face (S30): the pet it is, close up, in a circle of its tint,
// as a messaging app shows who you're talking to. One avatar wherever a
// lead stands for its project: its chat's header and replies, its chat
// row, its project's row in the sidebar, and its pet picker. Drawn from
// pixel-pets' `sit` frame at whole pixels (crispEdges), never smoothed.

/** What the header's dot says: quiet, working (it pulses), or something
 *  for you. */
export type AvatarStatus = "idle" | "working" | "calling";

const STATUS_LABEL: Record<AvatarStatus, string> = {
  idle: "Idle",
  working: "Working",
  calling: "Has something for you",
};

/** The `--t` a lead's tint is read from, with the solid fill and its ink. */
export const tintVars = (pet: LeadPet) => {
  const t = petTint(pet);
  const solid = solidTint(t);
  return { "--t": t, "--t-solid": solid, "--t-ink": inkOn(solid) } as CSSProperties;
};

export const LeadAvatar = memo(function LeadAvatar({
  pet,
  size,
  frame = "sit",
  status,
  className,
}: {
  pet: LeadPet;
  /** The circle's width and height, in CSS pixels. */
  size: number;
  frame?: FaceFrame;
  /** Shows a status dot on the circle's rim, for the chat header. */
  status?: AvatarStatus;
  className?: string;
}) {
  const colors = useMemo(() => paletteOf(coatFor(pet.kind, pet.coat)), [pet.kind, pet.coat]);
  const rows = faceRows(pet.kind, frame);
  const paths = useMemo(() => framePaths(rows), [rows]);
  const box = FACE[pet.kind];
  return (
    <span
      className={`avatar${status ? ` has-status is-${status}` : ""}${className ? ` ${className}` : ""}`}
      style={{ ...tintVars(pet), width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox={`${box.x} ${box.y} ${box.size} ${box.size}`} shapeRendering="crispEdges">
        {(Object.keys(paths) as Exclude<Px, ".">[]).map((c) => (
          <path key={c} d={paths[c]} fill={colors[c]} />
        ))}
      </svg>
      {status && <span className="avatar-dot" title={STATUS_LABEL[status]} />}
    </span>
  );
});

export const avatarStatusLabel = (s: AvatarStatus) => STATUS_LABEL[s];
