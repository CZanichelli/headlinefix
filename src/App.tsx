import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import AppPage from './pages/AppPage'
import Pricing from './pages/Pricing'
import { Login, Signup } from './pages/AuthPages'
import Account from './pages/Account'
import { ordanaWidgetRoutes } from './ordana-widget/routes'

export default function App() {
  return (
    <Routes>
      {ordanaWidgetRoutes}
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AppPage />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
