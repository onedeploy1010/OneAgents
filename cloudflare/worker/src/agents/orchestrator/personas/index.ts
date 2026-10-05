import { avery } from "./avery";
import { sam } from "./sam";
import { kai } from "./kai";
import { mira } from "./mira";

export const CLIENT_AGENTS = [avery, sam, kai, mira] as const;
export type ClientAgent = (typeof CLIENT_AGENTS)[number];

export const clientAgentBySlug = Object.fromEntries(
  CLIENT_AGENTS.map((a) => [a.slug, a])
) as Record<string, ClientAgent>;

export { avery, sam, kai, mira };
