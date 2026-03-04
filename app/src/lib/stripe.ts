import { loadStripe as loadStripePure } from "@stripe/stripe-js/pure";

let stripeLoadParamsApplied = false;

export const loadStripe: typeof loadStripePure = ((...args: Parameters<typeof loadStripePure>) => {
  if (!stripeLoadParamsApplied) {
    try {
      loadStripePure.setLoadParameters({ advancedFraudSignals: false });
    } catch {
      // Ignore if loader params are unavailable on the installed stripe-js build.
    }
    stripeLoadParamsApplied = true;
  }
  return loadStripePure(...args);
}) as typeof loadStripePure;
