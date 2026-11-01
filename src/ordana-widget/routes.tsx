import { lazy, Suspense, type ReactNode } from 'react'
import { Route } from 'react-router-dom'

// Everything the Ordana widget adds is under src/ordana-widget/; see ORDANA_WIDGET.md.
const EmbedPage = lazy(() => import('./EmbedPage'))
const PreviewPage = lazy(() => import('./PreviewPage'))
const SignInStart = lazy(() => import('./SignInPages').then((m) => ({ default: m.SignInStart })))
const SignInCallback = lazy(() => import('./SignInPages').then((m) => ({ default: m.SignInCallback })))

const page = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>

export const ordanaWidgetRoutes = [
  <Route key="ow-embed" path="/ordana-widget/embed" element={page(<EmbedPage />)} />,
  <Route key="ow-signin" path="/ordana-widget/signin" element={page(<SignInStart />)} />,
  <Route key="ow-callback" path="/ordana-widget/callback" element={page(<SignInCallback />)} />,
  <Route key="ow-preview" path="/ordana-widget-preview" element={page(<PreviewPage />)} />,
]
