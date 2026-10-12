import { useBug } from "@/hooks/useBugs";

/** Type-owned adapters keep validation changes out of shared form helpers. */
export function useCheckoutValidationBugs() {
  const invalidEmailAccepted = useBug("V1");
  const emptyCityAccepted = useBug("V3");
  return {
    emailType: invalidEmailAccepted ? "text" : "email",
    cityRequired: !emptyCityAccepted,
  };
}

export function useResetValidationBug(): boolean {
  return useBug("V4");
}
