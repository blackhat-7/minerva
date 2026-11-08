import { lazy, Suspense, useState } from 'react'
import { Route, Switch } from 'wouter'
import Home from './Home'
import { useAsync } from './hooks'
import { loadProfiles } from './profile'
import Profiles from './Profiles'
import { ErrorNote } from './ui'

const LessonPage = lazy(() => import('./LessonPage'))
const Review = lazy(() => import('./Review'))
const Drill = lazy(() => import('./Drill'))
const Settings = lazy(() => import('./Settings'))
const Gallery = lazy(() => import('./widgets/Gallery'))

export default function App() {
  const loaded = useAsync(loadProfiles)
  const [picked, setPicked] = useState(false)
  if (loaded.error)
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorNote error={`Can't reach the Minerva server (${loaded.error}).`} onRetry={loaded.reload} />
      </div>
    )
  if (loaded.data === undefined) return null
  if (!loaded.data && !picked) return <Profiles onChosen={() => setPicked(true)} />
  return (
    <Suspense>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/lesson/:id">{({ id }) => <LessonPage key={id} id={id} />}</Route>
        <Route path="/review" component={Review} />
        <Route path="/drill" component={Drill} />
        <Route path="/settings" component={Settings} />
        <Route path="/gallery" component={Gallery} />
        <Route>
          <div className="p-6 text-muted">Not found.</div>
        </Route>
      </Switch>
    </Suspense>
  )
}
