import { Link } from 'react-router-dom'

export default function Pricing() {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-center">Pricing</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="text-xl font-semibold">Free</h2>
          <p className="text-3xl font-bold">€0</p>
          <ul className="muted text-sm space-y-1">
            <li>3 tries, no account needed</li>
            <li>Then 20 rewrites/month with a free account</li>
          </ul>
          <Link to="/signup" className="btn inline-block">
            Create free account
          </Link>
        </section>
        <section className="card space-y-3">
          <h2 className="text-xl font-semibold">Pro</h2>
          <p className="text-3xl font-bold">
            €9<span className="text-base muted font-normal">/month</span>
          </p>
          <ul className="muted text-sm space-y-1">
            <li>Unlimited rewrites</li>
          </ul>
          <button className="btn btn-primary" disabled>
            Coming soon
          </button>
        </section>
      </div>
    </div>
  )
}
