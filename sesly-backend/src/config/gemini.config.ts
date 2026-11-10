import { registerAs } from '@nestjs/config';

/**
 * Gemini connection config for the LLM segment preprocessor: the key and the
 * host only. Both stay in the environment on purpose (a secret and a URL a
 * keyed request is sent to).
 *
 * Model, temperature, thinking budget and timeout are runtime settings
 * (llm.gemini.* in src/modules/settings/settings.registry.ts). GEMINI_MODEL,
 * GEMINI_TEMPERATURE, GEMINI_THINKING_BUDGET and GEMINI_TIMEOUT_MS are still
 * honoured there as the fallback when the admin panel has no override.
 */
export default registerAs('gemini', () => ({
  apiKey: process.env.GEMINI_API_KEY,
  apiUrl: process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com',
}));
