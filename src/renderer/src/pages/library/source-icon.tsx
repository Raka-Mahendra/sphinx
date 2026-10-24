import EpicLogo from "@renderer/assets/epic-integration-logo.svg?react";
import SphinxIcon from "@renderer/assets/icons/sphinx.svg?react";
import { SteamIcon } from "@renderer/components/steam-library-badge/steam-library-badge";
import type { LibrarySource } from "./library-category";
import "./source-icon.scss";

// The Sphinx symbol already carries its own 16/256 clear space, so it needs no
// bleed or viewBox crop the way the old 55x49 Hydra glyph did.
const SPHINX_ICON_BLEED = 2;

interface SourceIconProps {
  source: LibrarySource;
  size?: number;
}

export function SourceIcon({ source, size = 14 }: Readonly<SourceIconProps>) {
  if (source === "epic")
    return (
      <EpicLogo
        width={size}
        height={size}
        className="library-source-icon"
        aria-hidden="true"
      />
    );
  if (source === "steam") {
    return <SteamIcon size={size} className="library-source-icon" />;
  }

  return (
    <SphinxIcon
      width={size + SPHINX_ICON_BLEED}
      height={size + SPHINX_ICON_BLEED}
      className="library-source-icon library-source-icon--hydra"
      aria-hidden="true"
    />
  );
}
