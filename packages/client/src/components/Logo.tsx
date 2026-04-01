import { STRINGS } from "../strings";

interface LogoProps {
  as?: "h1" | "span";
}

export function Logo({ as: Tag = "span" }: LogoProps) {
  return (
    <Tag className="text-xl font-serif font-semibold tracking-tight text-text-primary select-none">
      {STRINGS.app.name}
    </Tag>
  );
}
