export type Rewrite = {
  id: 'benefit' | 'question' | 'punchy'
  label: string
  text: string
}

const STOPWORDS = new Set(
  'a an the and or but of to in on for with at by from is are was were be been it its this that these those your our my how what why when who will can just very more most so as into about than then'.split(
    ' ',
  ),
)

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const titleCase = (s: string) => s.split(' ').map(cap).join(' ')

function clean(input: string): string {
  return input.replace(/\s+/g, ' ').trim().replace(/[.!?:;,\s]+$/, '')
}

function keywords(headline: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of headline.toLowerCase().split(/[^a-z0-9À-ɏ'-]+/)) {
    const w = raw.replace(/^[-']+|[-']+$/g, '')
    if (w.length < 2 || STOPWORDS.has(w) || seen.has(w)) continue
    seen.add(w)
    out.push(w)
  }
  return out
}

/**
 * Pure, deterministic headline rewriter. Same input always yields the same 3 outputs.
 * Returns [] when the headline has no usable text.
 */
export function rewriteHeadline(headline: string, audience = ''): Rewrite[] {
  const base = clean(headline)
  if (!base) return []
  const who = clean(audience)
  const kws = keywords(base)
  const topic = (kws.length ? kws.slice(0, 3) : [base.toLowerCase()]).join(' ')

  const benefit = who
    ? `${cap(who)}: ${base}, made simple`
    : `${cap(base)}, without the guesswork`

  const question = who
    ? `Are you ${/^[aeiou]/i.test(who) ? 'an' : 'a'} ${who} who wants better ${topic}?`
    : `Want better ${topic}? Here's how.`

  const punchy = kws.length
    ? `${kws.slice(0, 3).map(titleCase).join('. ')}. Done.`
    : `${titleCase(base)}. Done.`

  return [
    { id: 'benefit', label: 'Benefit-first', text: benefit },
    { id: 'question', label: 'Question', text: question },
    { id: 'punchy', label: 'Short & punchy', text: punchy },
  ]
}
