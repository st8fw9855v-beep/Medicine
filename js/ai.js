// Integrarea cu Claude API (direct din browser, cu cheia API a utilizatorului).
import Anthropic from '../vendor/anthropic-sdk.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recomandat)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (mai rapid/ieftin)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cel mai ieftin)' },
];

const SETTINGS_KEY = 'medstudy.settings';
const DEFAULTS = { apiKey: '', model: 'claude-opus-5-5', target: 100, batch: 15, podcastMinutes: 5, cardTarget: 60, newPerDay: 25 };

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function client() {
  const { apiKey } = getSettings();
  if (!apiKey) throw new Error('Lipsește cheia API Claude. Introdu-o în tabul „Setări".');
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
}

// Parametri comuni: model, efort, fallback la refuz (unde serverul îl suportă).
function baseParams(effort) {
  const { model } = getSettings();
  const p = { model, output_config: { effort } };
  if (model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5') {
    p.betas = ['server-side-fallback-2026-07-01'];
    p.fallbacks = 'default';
  }
  return p;
}

function textOf(msg) {
  if (msg.stop_reason === 'refusal') {
    throw new Error('Modelul a refuzat cererea' + (msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : '.'));
  }
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (msg.stop_reason === 'max_tokens') {
    const err = new Error('Răspunsul a fost trunchiat (limita de tokeni). Încearcă o bucată mai mică.');
    err.partial = text;
    throw err;
  }
  return text;
}

/**
 * Apel cu streaming. onText primește textul acumulat (pentru afișare live).
 * signal = AbortSignal pentru anulare.
 */
export async function callText({ system, content, effort = 'medium', maxTokens = 64000, onText, signal }) {
  const params = {
    ...baseParams(effort),
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
  };
  const stream = client().beta.messages.stream(params, { signal });
  if (onText) {
    let acc = '';
    stream.on('text', (delta) => { acc += delta; onText(acc); });
  }
  const msg = await stream.finalMessage();
  return textOf(msg);
}

/** Apel cu ieșire JSON garantată de schemă (structured outputs). */
export async function callJSON({ system, content, schema, effort = 'medium', maxTokens = 64000, onText, signal }) {
  const params = {
    ...baseParams(effort),
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
  };
  params.output_config.format = { type: 'json_schema', schema };
  const stream = client().beta.messages.stream(params, { signal });
  if (onText) {
    let n = 0;
    stream.on('text', (delta) => { n += delta.length; onText(n); });
  }
  const msg = await stream.finalMessage();
  return JSON.parse(textOf(msg));
}

export function estimateTokens(chars) {
  return Math.round(chars / 3.3);
}
