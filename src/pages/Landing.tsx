import { Link } from 'react-router-dom'

const steps = [
  ['Paste', 'Drop in your headline, and who it’s for if you like.'],
  ['Rewrite', 'Get three versions: benefit-first, a question, and short & punchy.'],
  ['Copy', 'Hit Copy on the one you like and use it.'],
]

export default function Landing() {
  return (
    <div className="space-y-12">
      <section className="text-center space-y-5">
        <h1 className="text-4xl font-bold">Better headlines in one click.</h1>
        <p className="muted text-lg">Paste a headline, get three sharper rewrites instantly.</p>
        <Link to="/app" className="btn btn-primary">
          Try it free
        </Link>
      </section>
      <section>
        <h2 className="text-xl font-semibold mb-4">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map(([title, text], i) => (
            <li key={title} className="card">
              <div className="muted text-sm">Step {i + 1}</div>
              <div className="font-semibold">{title}</div>
              <p className="muted text-sm mt-1">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
