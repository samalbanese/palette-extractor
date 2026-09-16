import { useState } from "react";
import { type RGB, rgbToHex, labelColorFor } from "../lib/color";
import { suggestRoles } from "../lib/theme";
import { Icon } from "./Icon";
import { contrastRatio } from "../lib/contrast";

export function ThemePreview({
  palette,
  image,
}: {
  palette: RGB[];
  image: string | null;
}) {
  const [reversed, setReversed] = useState(false);
  const roles = suggestRoles(palette);
  if (!roles) return null;
  if (roles.ratio < 4.5)
    return (
      <section className="context-panel" aria-label="Palette in context">
        <div className="panel-intro">
          <span className="eyebrow">A LITTLE MORE CONTRAST</span>
          <h2>
            Beautiful colors.
            <br />
            They need a partner.
          </h2>
          <p>
            The strongest text pairing here is only {roles.ratio.toFixed(2)}:1.
            Try more colors or a different image to reach 4.5:1 for readable
            body text.
          </p>
        </div>
        <div
          className="low-contrast-art"
          aria-label="Your palette as an abstract composition"
          role="img"
        >
          {palette.map((c, i) => (
            <i key={i} style={{ background: rgbToHex(c) }} />
          ))}
        </div>
      </section>
    );
  const bg = reversed ? roles.foreground : roles.background;
  const fg = reversed ? roles.background : roles.foreground;
  return (
    <section className="context-panel" aria-label="Palette in context">
      <div className="panel-intro">
        <span className="eyebrow">FROM SWATCHES TO SOMETHING</span>
        <h2>See the possibilities.</h2>
        <p>
          A small identity, made entirely from your palette. Change the image
          and watch it take on a new character.
        </p>
        <button
          className="button secondary"
          onClick={() => setReversed((v) => !v)}
        >
          <Icon name="swap" /> Reverse light &amp; dark
        </button>
        <div className="role-list">
          {(
            [
              ["Surface", bg],
              ["Type", fg],
              ["Accent", roles.accent],
            ] as [string, RGB][]
          ).map(([label, color]) => (
            <div key={label}>
              <i style={{ background: rgbToHex(color) }} />
              <span>{label}</span>
              <code>{rgbToHex(color)}</code>
            </div>
          ))}
        </div>
        <p className="contrast-note">
          <Icon name="contrast" size={14} /> {contrastRatio(bg, fg).toFixed(2)}
          :1 text contrast ·{" "}
          {roles.ratio >= 7
            ? "AAA"
            : roles.ratio >= 4.5
              ? "AA"
              : "Below AA for body text"}
        </p>
      </div>
      <div
        className="brand-preview"
        style={{ background: rgbToHex(bg), color: rgbToHex(fg) }}
      >
        <div className="brand-nav">
          <strong>
            <span className="brand-symbol">✳</span> fieldnotes
          </strong>
          <span>Objects &amp; observations</span>
          <span>01 / 06</span>
        </div>
        <div className="brand-body">
          <div>
            <span className="brand-kicker">A STUDY IN EVERYDAY COLOR</span>
            <h3>
              A different
              <br />
              point of hue.
            </h3>
            <p>
              Find a little inspiration
              <br />
              in the things you almost missed.
            </p>
            <span
              className="brand-cta"
              style={{
                background: rgbToHex(roles.accent),
                color: labelColorFor(roles.accent),
              }}
            >
              Explore the collection <Icon name="arrow" size={16} />
            </span>
          </div>
          <div className="brand-art">
            {image ? (
              <img
                src={image}
                alt="Your source image applied to an editorial design"
              />
            ) : (
              <div className="abstract-art">
                {palette.map((c, i) => (
                  <i key={i} style={{ background: rgbToHex(c) }} />
                ))}
              </div>
            )}
            <span
              className="brand-sticker"
              style={{
                background: rgbToHex(roles.accent),
                color: labelColorFor(roles.accent),
              }}
            >
              Made of
              <br />
              small
              <br />
              moments.
            </span>
          </div>
        </div>
        <div className="brand-bottom">
          <span>COLLECTED, NOT CREATED.</span>
          <div>
            {palette.map((c, i) => (
              <i key={i} style={{ background: rgbToHex(c) }} />
            ))}
          </div>
          <span>PALETTE STUDY Nº 001</span>
        </div>
      </div>
    </section>
  );
}
