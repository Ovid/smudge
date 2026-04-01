import { STRINGS } from "../strings";

interface LogoProps {
  as?: "h1" | "span";
}

export function Logo({ as: Tag = "span" }: LogoProps) {
  return (
    <Tag className="select-none leading-none">
      {/* SVG filter for charcoal smudge effect — hidden, referenced by the text */}
      <svg aria-hidden="true" className="absolute w-0 h-0 overflow-hidden">
        <defs>
          <filter id="smudge">
            {/* Rough, organic edge distortion like ink on textured paper */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.04"
              numOctaves="4"
              seed="2"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="3"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            {/* Slight roughen on edges */}
            <feGaussianBlur in="displaced" stdDeviation="0.4" result="blurred" />
            {/* Re-sharpen to keep text readable */}
            <feComponentTransfer result="sharpened">
              <feFuncA type="discrete" tableValues="0 1" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      <span
        className="text-xl font-serif font-semibold tracking-tight text-text-primary"
        style={{ filter: "url(#smudge)" }}
      >
        {STRINGS.app.name}
      </span>
    </Tag>
  );
}
