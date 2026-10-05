import { nina } from "./nina";
import { marcus } from "./marcus";
import { ravi } from "./ravi";
import { oscar } from "./oscar";

export const ONBOARDING_MENTORS = [nina, marcus, ravi, oscar] as const;
export type OnboardingMentor = (typeof ONBOARDING_MENTORS)[number];

export const mentorBySlug = Object.fromEntries(
  ONBOARDING_MENTORS.map((m) => [m.slug, m])
) as Record<string, OnboardingMentor>;

export { nina, marcus, ravi, oscar };
