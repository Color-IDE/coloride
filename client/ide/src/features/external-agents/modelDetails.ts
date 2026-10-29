/** Standard API USD / 1M tokens, short context; verified 2026-10-29.
 * https://developers.openai.com/api/docs/pricing
 * https://developers.openai.com/api/docs/models
 * Coding/Visual are Coloride editorial comparisons, not benchmark scores.
 * More Price bars means a higher standard API cost.
 */
type ModelDetails = {
  input: number;
  output: number;
  price: number;
  coding: number;
  visual: number;
};

export const EXTERNAL_MODEL_DETAILS: Readonly<Record<string, ModelDetails>> = {
  "gpt-6-astra": { input: 10, output: 50, price: 4, coding: 4, visual: 4 },
  "gpt-6.1-sol": { input: 2, output: 10, price: 2, coding: 4, visual: 4 },
  "gpt-6.1-terra": { input: 1, output: 5, price: 2, coding: 3, visual: 4 },
  "gpt-6-sol": { input: 2, output: 10, price: 2, coding: 3, visual: 3 },
  "gpt-6-luna": { input: 0.1, output: 0.5, price: 1, coding: 2, visual: 2 },
  "gpt-5.6-sol": { input: 4, output: 20, price: 3, coding: 3, visual: 3 },
  "gpt-5.6-terra": { input: 2, output: 12, price: 3, coding: 2, visual: 3 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2, price: 1, coding: 2, visual: 2 },
};
